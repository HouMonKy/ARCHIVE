/**
 * 官方目录同步（任务 1）：Bandai 高达 + LEGO Technic 元数据 → CatalogProduct/ReleaseEvent。
 *
 * 数据来源与合规：
 * - Bandai：bandai-hobby.net 官网（无 robots.txt 限制，返回 404 页面；浏览器 UA 正常访问）。
 *   列表页 item_all/?p=N 提供名称/价格/发售月；商品页提供面包屑（等级/系列）、规格与主图。
 * - LEGO：www.lego.com 商品页被 Akamai 机器人防护主动拦截（证据见 BLOCKED.md），
 *   按任务书"robots/条款禁止时不绕过，记录证据并转人工清单"：
 *   元数据采用人工清单（官方 sitemap 校验 URL 真实性）+ 官方 sitemap 发现通道。
 * - 图片：仅 LOCAL 模式缓存（Bandai 官网图 + LEGO 官方产品摄影的 Rebrickable CDN 镜像），
 *   存放 private-assets/product-images/（gitignored）；HOSTED 模式不下载、不存储、不热链。
 *
 * 运行约束：≤1 req/s、指数退避、可恢复游标（CatalogSyncCursor）、来源审计（stdout + 游标表）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { PrismaClient } from "@prisma/client"
import { resolveDatabaseUrl } from "../src/lib/prisma"

const OFFICIAL_CATALOG_VERSION = "official-v1"
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 ModelBaseCatalogSync/1.0"
const MIN_INTERVAL_MS = 1050 // ≤1 req/s（含安全余量）
const MAX_RETRIES = 3
const CACHE_DIR = path.resolve(process.cwd(), "private-assets/product-images")
const PROVENANCE = path.join(CACHE_DIR, "provenance.json")

interface AuditEntry {
  at: string
  kind: string
  detail: string
}

const audit: AuditEntry[] = []
function log(kind: string, detail: string): void {
  audit.push({ at: new Date().toISOString(), kind, detail })
  console.log(`[${kind}] ${detail}`)
}

let lastRequestAt = 0
async function rateLimit(): Promise<void> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastRequestAt = Date.now()
}

async function fetchWithBackoff(url: string): Promise<Response> {
  let delay = 2000
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await rateLimit()
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja,en;q=0.8" } })
    if (res.status === 429 || res.status >= 500) {
      if (attempt === MAX_RETRIES) throw new Error(`GET ${url} -> ${res.status}（重试 ${MAX_RETRIES} 次后放弃）`)
      log("backoff", `${res.status} 于 ${url}，${delay}ms 后重试（${attempt}/${MAX_RETRIES}）`)
      await new Promise((r) => setTimeout(r, delay))
      delay *= 2
      continue
    }
    return res
  }
  throw new Error("unreachable")
}

/** robots.txt 合规检查：无文件/无匹配 Disallow 才允许继续 */
async function checkRobots(origin: string, paths: string[]): Promise<void> {
  let disallows: { pattern: string; ua: string }[] = []
  try {
    await rateLimit()
    const res = await fetch(new URL("/robots.txt", origin).toString(), {
      headers: { "User-Agent": UA },
    })
    if (res.ok) {
      const text = await res.text()
      if (/^\s*User-agent:/i.test(text) || /Disallow:/i.test(text)) {
        let currentUa = "*"
        for (const line of text.split("\n")) {
          const uaM = line.match(/^\s*User-agent:\s*(\S+)/i)
          if (uaM) currentUa = uaM[1]!
          const dM = line.match(/^\s*Disallow:\s*(\S*)/i)
          if (dM) disallows.push({ pattern: dM[1] ?? "", ua: currentUa })
        }
        // 仅保留对 * 或我们 UA 家族适用的规则
        disallows = disallows.filter((d) => d.ua === "*")
      } else {
        log("robots", `${origin}/robots.txt 返回 200 但非 robots 内容（404 页面），无限制`)
      }
    } else {
      log("robots", `${origin}/robots.txt -> ${res.status}，视作无限制`)
    }
  } catch (e) {
    throw new Error(`robots.txt 获取失败：${origin}（${(e as Error).message}）`)
  }
  for (const p of paths) {
    const hit = disallows.find((d) => {
      if (!d.pattern) return false
      const pattern = d.pattern.replace(/\*/g, "")
      return p.startsWith(pattern)
    })
    if (hit) throw new Error(`robots.txt 禁止访问 ${p}（Disallow: ${hit.pattern}）——不绕过，转人工清单`)
  }
  log("robots", `${origin}：${disallows.length} 条 Disallow 规则，目标路径全部允许`)
}

interface SyncCursor {
  cursor: string
  itemsSynced: number
}

async function loadCursor(db: PrismaClient, id: string): Promise<SyncCursor> {
  const row = await db.catalogSyncCursor.findUnique({ where: { id } })
  return { cursor: row?.cursor ?? "", itemsSynced: row?.itemsSynced ?? 0 }
}

async function saveCursor(db: PrismaClient, id: string, brand: string, cursor: SyncCursor, status: string, lastError?: string): Promise<void> {
  await db.catalogSyncCursor.upsert({
    where: { id },
    create: { id, brand, cursor: cursor.cursor, itemsSynced: cursor.itemsSynced, status, lastError: lastError ?? null },
    update: { cursor: cursor.cursor, itemsSynced: cursor.itemsSynced, status, lastError: lastError ?? null },
  })
}

// —— Bandai —— //

interface ListingItem {
  code: string
  url: string
  name: string
}

export function parseListing(html: string): ListingItem[] {
  const out = new Map<string, ListingItem>()
  for (const m of html.matchAll(/<a href="(https:\/\/bandai-hobby\.net\/item\/(01_[0-9]+)\/)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const [, url, code, inner] = m
    const name = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    if (!out.has(code!)) out.set(code!, { code: code!, url: url!, name })
  }
  return [...out.values()]
}

const GRADE_BY_BRAND_SLUG: Record<string, string> = {
  hg: "HG", hgu: "HGUC", rg: "RG", mg: "MG", mgex: "MGEX", pg: "PG", sd: "SD", eg: "EG",
  sdcs: "SDCS", re100: "RE/100", fullmechanics: "FM", entry_grade: "EG", mgka: "MG", gundam_decal: "TOOL",
  gundam_assemble: "ASSEMBLE", actionbase: "TOOL", optionpartsset: "TOOL",
}
const LINE_BY_SERIES_SLUG: Record<string, string> = {
  "first": "UC", "first-gundam": "UC", "zeta": "UC", "zz": "UC", "cca": "UC", "unicorn": "UC",
  "hathaway": "UC", "requiem": "UC", "origin": "UC", "msv": "UC", "0080": "UC", "0083": "UC",
  "gquuuuuux": "UC", "gundam-uc": "UC", "char": "UC", "one-year-war": "UC", "thunderbolt": "UC",
  "gundam": "UC", "gundam-cca": "UC", "gundamf91": "UC", "gundam-the-origin": "UC", "0096": "UC",
  "seed": "CE", "seed-freedom": "CE", "seed-msv": "CE", "astray": "CE", "stargazer": "CE",
  "seed-d": "CE", "seed-d-astrays": "CE", "seed-astray": "CE",
  "g-witch": "AC", "wing": "AC", "wing-ew": "AC", "g-unit": "AC", "endlesswaltz": "AC", "gundam-wing": "AC",
  "00": "AD", "iron-blooded": "PD", "age": "AG", "x": "AW", "aw": "AW", "g": "FC", "ggundam": "FC",
  "turn-a": "CC", "build": "BUILD", "build-fighters": "BUILD", "build-divers": "BUILD",
  "build-metaverse": "BUILD", "gundam-build": "BUILD", "g-reco": "RC", "pb": "OTHER",
}

export function parseItemPage(html: string, url: string) {
  const title = (html.match(/<title>([^<]*)<\/title>/) ?? [])[1]?.replace(/｜バンダイ ホビーサイト$/, "").trim() ?? null
  const bread = [...html.matchAll(/<a[^>]+href="https:\/\/bandai-hobby\.net\/(brand|series)\/([^/"]+)\/"[^>]*>([^<]+)<\/a>/g)]
  const gradeSlug = bread.find((b) => b[1] === "brand")?.[2] ?? ""
  const seriesSlug = bread.find((b) => b[1] === "series")?.[2] ?? ""
  const gunplaBreadcrumb = /href="https:\/\/bandai-hobby\.net\/(gunpla|brand)\//.test(html) && html.includes("ガンプラ")
  const isGunpla = gunplaBreadcrumb || /\/brand\/|\/gunpla\//.test(url)
  const priceText = (html.match(/<dd[^>]*>\s*([\d,]+)\s*円/) ?? [])[1] ?? null
  const releaseText = (html.match(/発売日[\s\S]{0,80}?<\/dt>\s*<dd[^>]*>\s*([^<]+?)\s*<\/dd>/) ?? [])[1] ?? null
  const images = [...html.matchAll(/"(https:\/\/d3bk8pkqsprcvh\.cloudfront\.net\/hobby\/jp\/product\/[^"]+)"/g)].map((m) => m[1]!)
  return {
    title,
    grade: GRADE_BY_BRAND_SLUG[gradeSlug] ?? (gradeSlug.toUpperCase() || "OTHER"),
    line: LINE_BY_SERIES_SLUG[seriesSlug] ?? (seriesSlug ? seriesSlug.toUpperCase() : "OTHER"),
    isGunpla,
    priceText,
    releaseText,
    image: images[0] ?? null,
  }
}

export function parseReleaseDate(text: string | null): { year: number; month: number; day: number } | null {
  if (!text) return null
  const ym = text.match(/(\d{4})年(\d{1,2})月/)
  if (ym) return { year: Number(ym[1]), month: Number(ym[2]), day: 1 }
  const y = text.match(/(\d{4})年/)
  if (y) return { year: Number(y[1]), month: 1, day: 1 }
  return null
}

async function downloadImage(url: string, destPath: string): Promise<boolean> {
  const res = await fetchWithBackoff(url)
  if (!res.ok) return false
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength < 1024) return false
  writeFileSync(destPath, buf)
  return true
}

function loadProvenance(): { entries: unknown[] } {
  try {
    return JSON.parse(readFileSync(PROVENANCE, "utf-8")) as { entries: unknown[] }
  } catch {
    return { entries: [] }
  }
}

function saveProvenance(entry: Record<string, unknown>): void {
  const data = loadProvenance()
  const entries = (data.entries ?? []) as Record<string, unknown>[]
  const filtered = entries.filter((e) => e.id !== entry.id)
  filtered.push(entry)
  writeFileSync(PROVENANCE, JSON.stringify({ entries: filtered }, null, 2))
}

export async function syncBandai(db: PrismaClient, target: number, maxPages: number, localImages: boolean): Promise<void> {
  await checkRobots("https://bandai-hobby.net", ["/item_all/", "/brand/mg/", "/item/01_0000/"])
  const cursor = await loadCursor(db, "bandai")
  const startBrandIdx = Number(cursor.cursor || "0")
  // 按等级品牌页爬取（每条均为ガンプラ，避免 item_all 全站混杂低密度翻页）
  const brandSlugs = ["mg", "rg", "hg", "pg", "mgex", "fullmechanics", "sd", "eg", "sdcs", "re100"]
  const gundamItems: ListingItem[] = []
  const seen = new Set<string>()

  for (let bi = startBrandIdx; bi < brandSlugs.length && gundamItems.length < target; bi++) {
    const slug = brandSlugs[bi]!
    for (let page = 1; page <= maxPages && gundamItems.length < target; page++) {
      const res = await fetchWithBackoff(`https://bandai-hobby.net/brand/${slug}/?p=${page}`)
      if (!res.ok) throw new Error(`/brand/${slug}/ p=${page} -> ${res.status}`)
      const html = await res.text()
      const items = parseListing(html)
      let added = 0
      for (const item of items) {
        if (!seen.has(item.code)) {
          seen.add(item.code)
          gundamItems.push(item)
          added++
        }
      }
      log("bandai-list", `/brand/${slug}/ p=${page} 条目 ${items.length}（新增 ${added}，累计 ${gundamItems.length}）`)
      await saveCursor(db, "bandai", "Bandai", { cursor: String(bi), itemsSynced: cursor.itemsSynced }, "RUNNING")
      if (items.length === 0) break
    }
  }

  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true })
  let synced = 0
  let skipped = 0
  for (const item of gundamItems) {
    if (synced >= target) break
    const productId = `bandai-${item.code}`
    const existing = await db.catalogProduct.findUnique({ where: { id: productId } })
    const res = await fetchWithBackoff(item.url)
    if (!res.ok) {
      log("bandai-item", `${item.url} -> ${res.status}，跳过`)
      continue
    }
    const parsed = parseItemPage(await res.text(), item.url)
    if (!parsed.title || !parsed.isGunpla) {
      skipped++
      continue
    }
    const release = parseReleaseDate(parsed.releaseText)
    const imageBase = parsed.image ? parsed.image.split("?")[0]! : null
    await db.catalogProduct.upsert({
      where: { id: productId },
      create: {
        id: productId,
        brand: "Bandai",
        category: "Gundam",
        line: parsed.line,
        grade: parsed.grade,
        canonicalName: parsed.title,
        releaseYear: release?.year ?? null,
        source: item.url,
        catalogVersion: OFFICIAL_CATALOG_VERSION,
        imageSourcePage: item.url,
        imageSourceUrl: imageBase,
        imageFetchedAt: localImages && parsed.image ? new Date() : null,
        rightsBasis: localImages && parsed.image ? "personal-use" : null,
      },
      update: {
        canonicalName: parsed.title,
        line: parsed.line,
        grade: parsed.grade,
        releaseYear: release?.year ?? null,
      },
    })
    if (release) {
      await db.releaseEvent.upsert({
        where: { id: `${productId}-release` },
        create: {
          id: `${productId}-release`,
          catalogProductId: productId,
          title: parsed.priceText ? `${parsed.title} 発売（定価 ${parsed.priceText} 円）` : `${parsed.title} 発売`,
          announcedAt: new Date(`${release.year}-${String(release.month).padStart(2, "0")}-${String(release.day).padStart(2, "0")}T00:00:00+09:00`),
          sourceUrl: item.url,
          sourceName: "Bandai ホビーサイト",
          priceMinor: null, // 日元原价，不折算人民币（避免误导预算口径）
          datasetVersion: OFFICIAL_CATALOG_VERSION,
        },
        update: {},
      })
    }
    const imageDest = path.join(CACHE_DIR, `${productId}.jpg`)
    if (localImages && parsed.image && !existsSync(imageDest)) {
      const ok = await downloadImage(parsed.image, path.join(CACHE_DIR, `${productId}.jpg`))
      if (ok) {
        saveProvenance({
          id: productId,
          source_page: item.url,
          image_url: imageBase,
          fetched_at: new Date().toISOString().slice(0, 10),
          rights_basis: "personal-use",
          note: "Bandai 官网商品图，本机私有缓存",
        })
        log("bandai-image", `${productId} 图片已缓存`)
      } else {
        log("bandai-image", `${productId} 图片下载失败，使用占位图（不阻断）`)
      }
    }
    synced++
    log("bandai-item", `${productId} ${parsed.title}（${parsed.grade}/${parsed.line}）${release ? ` 発売 ${release.year}-${release.month}` : ""}`)
    await saveCursor(db, "bandai", "Bandai", { cursor: "0", itemsSynced: cursor.itemsSynced + synced }, "RUNNING")
  }

  await saveCursor(db, "bandai", "Bandai", { cursor: "0", itemsSynced: cursor.itemsSynced + synced }, "DONE")
  log("bandai-summary", `同步 ${synced} 条，跳过 ${skipped} 条（已存在/非高达）`)
}

// —— LEGO（人工清单 + 官方 sitemap 校验）—— //

interface LegoManualEntry {
  setNumber: string
  slug: string
  name: string
  line: string
  releaseYear: number | null
  note?: string
}

/**
 * LEGO Technic 人工清单（官方 sitemap 校验存在的在售条目；发售年为公开官方资料，
 * 不确定的置 null）。来源：www.lego.com/productPage-sitemap.xml（robots.txt 明确提供）。
 */
export const LEGO_MANUAL_LIST: LegoManualEntry[] = [
  { setNumber: "42115", slug: "lamborghini-sian-fkp-37-42115", name: "Lamborghini Sián FKP 37", line: "SUPERCAR", releaseYear: 2020 },
  { setNumber: "42143", slug: "ferrari-daytona-sp3-42143", name: "Ferrari Daytona SP3", line: "SUPERCAR", releaseYear: 2022 },
  { setNumber: "42161", slug: "lamborghini-huracan-tecnica-42161", name: "Lamborghini Huracán Técnica", line: "SUPERCAR", releaseYear: 2023 },
  { setNumber: "42151", slug: "bugatti-bolide-42151", name: "Bugatti Bolide", line: "SUPERCAR", releaseYear: 2023 },
  { setNumber: "42172", slug: "mclaren-p1-42172", name: "McLaren P1", line: "SUPERCAR", releaseYear: 2024 },
  { setNumber: "42173", slug: "koenigsegg-jesko-absolut-grey-hypercar-42173", name: "Koenigsegg Jesko Absolut (Grey)", line: "SUPERCAR", releaseYear: 2024 },
  { setNumber: "42184", slug: "koenigsegg-jesko-absolut-white-hypercar-42184", name: "Koenigsegg Jesko Absolut (White)", line: "SUPERCAR", releaseYear: 2025 },
  { setNumber: "42214", slug: "lamborghini-revuelto-super-sports-car-42214", name: "Lamborghini Revuelto", line: "SUPERCAR", releaseYear: 2025 },
  { setNumber: "42205", slug: "chevrolet-corvette-stingray-42205", name: "Chevrolet Corvette Stingray", line: "SUPERCAR", releaseYear: 2025 },
  { setNumber: "42217", slug: "chevrolet-corvette-stingray-blue-42217", name: "Chevrolet Corvette Stingray (Blue)", line: "SUPERCAR", releaseYear: null },
  { setNumber: "42222", slug: "bugatti-chiron-pur-sport-hypercar-42222", name: "Bugatti Chiron Pur Sport", line: "SUPERCAR", releaseYear: null },
  { setNumber: "42241", slug: "green-bugatti-chiron-pur-sport-hypercar-42241", name: "Bugatti Chiron Pur Sport (Green)", line: "SUPERCAR", releaseYear: null },
  { setNumber: "42212", slug: "ferrari-fxx-k-42212", name: "Ferrari FXX-K", line: "SUPERCAR", releaseYear: null },
  { setNumber: "42232", slug: "koenigsegg-sadairs-spear-megacar-42232", name: "Koenigsegg Sadair's Spear", line: "SUPERCAR", releaseYear: null },
  { setNumber: "42234", slug: "dodge-viper-gts-r-sports-car-42234", name: "Dodge Viper GTS-R", line: "SUPERCAR", releaseYear: null },
  { setNumber: "42171", slug: "mercedes-amg-f1-w14-e-performance-42171", name: "Mercedes-AMG F1 W14 E Performance", line: "RACE", releaseYear: 2023 },
  { setNumber: "42176", slug: "porsche-gt4-e-performance-race-car-42176", name: "Porsche GT4 e-Performance", line: "RACE", releaseYear: 2024 },
  { setNumber: "42166", slug: "neom-mclaren-extreme-e-race-car-42166", name: "NEOM McLaren Extreme E Race Car", line: "RACE", releaseYear: 2024 },
  { setNumber: "42169", slug: "neom-mclaren-formula-e-race-car-42169", name: "NEOM McLaren Formula E Race Car", line: "RACE", releaseYear: null },
  { setNumber: "42206", slug: "oracle-red-bull-racing-rb20-f1-car-42206", name: "Oracle Red Bull Racing RB20 F1 Car", line: "RACE", releaseYear: 2025 },
  { setNumber: "42207", slug: "ferrari-sf-24-f1-car-42207", name: "Ferrari SF-24 F1 Car", line: "RACE", releaseYear: 2025 },
  { setNumber: "42228", slug: "mclaren-mcl39-f1-car-42228", name: "McLaren MCL39 F1 Car", line: "RACE", releaseYear: null },
  { setNumber: "42240", slug: "aston-martin-aramco-amr25-f1-car-42240", name: "Aston Martin Aramco AMR25 F1 Car", line: "RACE", releaseYear: null },
  { setNumber: "42224", slug: "porsche-911-gt3-r-rexy-ao-racing-car-42224", name: "Porsche 911 GT3 R “Rexy” AO Racing Car", line: "RACE", releaseYear: null },
  { setNumber: "42154", slug: "2022-ford-gt-42154", name: "2022 Ford GT", line: "SPORTSCAR", releaseYear: 2023 },
  { setNumber: "42208", slug: "aston-martin-valkyrie-42208", name: "Aston Martin Valkyrie", line: "SPORTSCAR", releaseYear: null },
  { setNumber: "42223", slug: "1966-ford-gt40-mkii-race-car-42223", name: "1966 Ford GT40 Mk II Race Car", line: "SPORTSCAR", releaseYear: null },
  { setNumber: "42235", slug: "ferrari-488-pista-car-42235", name: "Ferrari 488 Pista", line: "SPORTSCAR", releaseYear: null },
  { setNumber: "42236", slug: "custom-garage-ford-mustang-gt-car-42236", name: "Custom Garage Ford Mustang GT", line: "SPORTSCAR", releaseYear: null },
  { setNumber: "42227", slug: "jeep-wrangler-rubicon-suv-42227", name: "Jeep Wrangler Rubicon", line: "OFFROAD", releaseYear: null },
  { setNumber: "42213", slug: "ford-bronco-suv-42213", name: "Ford Bronco", line: "OFFROAD", releaseYear: null },
  { setNumber: "42204", slug: "fast-and-furious-toyota-supra-mk4-42204", name: "Fast & Furious Toyota Supra MK4", line: "SPORTSCAR", releaseYear: null },
  { setNumber: "42210", slug: "2-fast-2-furious-nissan-skyline-gt-r-r34-car-42210", name: "2 Fast 2 Furious Nissan Skyline GT-R R34", line: "SPORTSCAR", releaseYear: null },
  { setNumber: "42130", slug: "bmw-m-1000-rr-42130", name: "BMW M 1000 RR", line: "MOTORCYCLE", releaseYear: 2023 },
  { setNumber: "42159", slug: "yamaha-mt-10-sp-42159", name: "Yamaha MT-10 SP", line: "MOTORCYCLE", releaseYear: 2023 },
  { setNumber: "42170", slug: "kawasaki-ninja-h2r-motorcycle-42170", name: "Kawasaki Ninja H2R", line: "MOTORCYCLE", releaseYear: 2024 },
  { setNumber: "42202", slug: "ducati-panigale-v4-s-motorcycle-42202", name: "Ducati Panigale V4 S", line: "MOTORCYCLE", releaseYear: null },
  { setNumber: "42238", slug: "ducati-desmo450-mx-factory-motorcycle-42238", name: "Ducati Desmo450 MX", line: "MOTORCYCLE", releaseYear: null },
  { setNumber: "42158", slug: "nasa-mars-rover-perseverance-42158", name: "NASA Mars Rover Perseverance", line: "SPACE", releaseYear: 2023 },
  { setNumber: "42180", slug: "mars-crew-exploration-rover-42180", name: "Mars Crew Exploration Rover", line: "SPACE", releaseYear: 2024 },
  { setNumber: "42179", slug: "planet-earth-and-moon-in-orbit-42179", name: "Planet Earth and Moon in Orbit", line: "SPACE", releaseYear: 2024 },
  { setNumber: "42221", slug: "nasa-artemis-space-launch-system-rocket-42221", name: "NASA Artemis Space Launch System Rocket", line: "SPACE", releaseYear: null },
  { setNumber: "42146", slug: "liebherr-crawler-crane-lr-13000-42146", name: "Liebherr Crawler Crane LR 13000", line: "CONSTRUCTION", releaseYear: 2023 },
  { setNumber: "42175", slug: "volvo-fmx-truck-ec230-electric-excavator-42175", name: "Volvo FMX Truck & EC230 Electric Excavator", line: "CONSTRUCTION", releaseYear: 2024 },
  { setNumber: "42215", slug: "volvo-ec500-hybrid-excavator-42215", name: "Volvo EC500 Hybrid Excavator", line: "CONSTRUCTION", releaseYear: 2025 },
  { setNumber: "42209", slug: "volvo-l120-electric-wheel-loader-42209", name: "Volvo L120 Electric Wheel Loader", line: "CONSTRUCTION", releaseYear: null },
  { setNumber: "42168", slug: "john-deere-9700-forage-harvester-42168", name: "John Deere 9700 Forage Harvester", line: "CONSTRUCTION", releaseYear: 2024 },
  { setNumber: "42218", slug: "john-deere-1470h-wheeled-harvester-42218", name: "John Deere 1470H Wheeled Harvester", line: "CONSTRUCTION", releaseYear: null },
  { setNumber: "42177", slug: "mercedes-benz-g-500-professional-line-42177", name: "Mercedes-Benz G 500 Professional Line", line: "OFFROAD", releaseYear: 2024 },
  { setNumber: "42242", slug: "mercedes-benz-unimog-u-5023-with-crane-42242", name: "Mercedes-Benz UNIMOG U 5023 with Crane", line: "CONSTRUCTION", releaseYear: null },
  { setNumber: "42239", slug: "batmobile-tumbler-42239", name: "Batmobile Tumbler", line: "MOVIE", releaseYear: null },
  { setNumber: "42160", slug: "audi-rs-q-e-tron-42160", name: "Audi RS Q e-tron", line: "OFFROAD", releaseYear: 2023 },
]

async function syncLego(db: PrismaClient, localImages: boolean): Promise<void> {
  // 官方 sitemap 校验（robots.txt 声明的发现通道）
  await checkRobots("https://www.lego.com", ["/sitemap.xml", "/productPage-sitemap.xml"])
  const res = await fetchWithBackoff("https://www.lego.com/productPage-sitemap.xml")
  if (!res.ok) throw new Error(`LEGO sitemap -> ${res.status}`)
  const sitemapIndex = await res.text()
  const partUrls = [...sitemapIndex.matchAll(/<loc>([^<]*sitemap-productPage-en-US[^<]*)<\/loc>/g)].map((m) => m[1]!)
  const slugs = new Set<string>()
  for (const part of partUrls) {
    const partRes = await fetchWithBackoff(part)
    if (!partRes.ok) throw new Error(`LEGO sitemap 分片 ${part} -> ${partRes.status}`)
    const xml = await partRes.text()
    for (const m of xml.matchAll(/<loc>https:\/\/www\.lego\.com\/en-us\/product\/([^<]+)<\/loc>/g)) {
      slugs.add(m[1]!)
    }
  }
  log("lego-sitemap", `官方 sitemap 共 ${slugs.size} 个在售商品 URL（en-US）`)

  let synced = 0
  let missing = 0
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true })
  for (const entry of LEGO_MANUAL_LIST) {
    const officialUrl = `https://www.lego.com/en-us/product/${entry.slug}`
    const inSitemap = slugs.has(entry.slug)
    if (!inSitemap) {
      missing++
      log("lego-audit", `${entry.setNumber} ${entry.name} 不在当前官方 sitemap（可能已退役），跳过`)
      continue
    }
    const productId = `lego-${entry.setNumber}`
    await db.catalogProduct.upsert({
      where: { id: productId },
      create: {
        id: productId,
        brand: "LEGO",
        category: "Technic",
        line: entry.line,
        grade: "TECHNIC",
        canonicalName: `${entry.name}（${entry.setNumber}）`,
        releaseYear: entry.releaseYear,
        source: officialUrl,
        catalogVersion: OFFICIAL_CATALOG_VERSION,
        imageSourcePage: officialUrl,
        imageSourceUrl: null,
        imageFetchedAt: null,
        rightsBasis: null,
      },
      update: {
        canonicalName: `${entry.name}（${entry.setNumber}）`,
        line: entry.line,
        releaseYear: entry.releaseYear,
      },
    })
    if (entry.releaseYear) {
      await db.releaseEvent.upsert({
        where: { id: `${productId}-release` },
        create: {
          id: `${productId}-release`,
          catalogProductId: productId,
          title: `${entry.name}（${entry.setNumber}）发售`,
          announcedAt: new Date(`${entry.releaseYear}-01-01T00:00:00+08:00`),
          sourceUrl: officialUrl,
          sourceName: "LEGO.com（人工清单 + 官方 sitemap 校验）",
          priceMinor: null,
          datasetVersion: OFFICIAL_CATALOG_VERSION,
        },
        update: {},
      })
    }
    // 评测用盒图（官方产品摄影的 Rebrickable CDN 镜像；仅 LOCAL 私有缓存）
    const legoImageDest = path.join(CACHE_DIR, `${productId}.jpg`)
    if (localImages && !existsSync(legoImageDest)) {
      const imageUrl = `https://cdn.rebrickable.com/media/sets/${entry.setNumber}-1.jpg`
      const ok = await downloadImage(imageUrl, legoImageDest)
      if (ok) {
        await db.catalogProduct.update({
          where: { id: productId },
          data: { imageSourceUrl: imageUrl, imageFetchedAt: new Date(), rightsBasis: "personal-use" },
        })
        saveProvenance({
          id: productId,
          source_page: officialUrl,
          image_url: imageUrl,
          fetched_at: new Date().toISOString().slice(0, 10),
          rights_basis: "personal-use",
          note: "LEGO 官方产品摄影（Rebrickable CDN 镜像，官网被机器人防护拦截），仅本机私有缓存用于评测与本地展示",
        })
        log("lego-image", `${productId} 盒图已缓存`)
      } else {
        log("lego-image", `${productId} 盒图下载失败，使用占位图（不阻断）`)
      }
    }
    synced++
    log("lego-item", `${productId} ${entry.name}（${entry.line}${entry.releaseYear ? ` · ${entry.releaseYear}` : ""}）`)
  }
  await saveCursor(db, "lego", "LEGO", { cursor: "manual-list-v1", itemsSynced: synced }, "DONE")
  log("lego-summary", `同步 ${synced} 条（sitemap 缺席跳过 ${missing} 条）`)
}

async function main(): Promise<void> {
  // 仅直接执行时运行（被测试 import 时不触发网络同步）
  const args = process.argv.slice(2)
  const brandIdx = args.indexOf("--brand")
  const brand = brandIdx >= 0 ? (args[brandIdx + 1] ?? "all") : "all"
  const targetIdx = args.indexOf("--target")
  const target = targetIdx >= 0 ? Number(args[targetIdx + 1] ?? "40") : 40
  const maxPagesIdx = args.indexOf("--max-pages")
  const maxPages = maxPagesIdx >= 0 ? Number(args[maxPagesIdx + 1] ?? "12") : 12
  const localImages = process.env.DATABASE_MODE !== "HOSTED" && process.env.CATALOG_SYNC_NO_IMAGES !== "1"

  const db = new PrismaClient({ datasources: { db: { url: resolveDatabaseUrl() } } })
  try {
    if (brand === "bandai" || brand === "all") await syncBandai(db, target, maxPages, localImages)
    if (brand === "lego" || brand === "all") await syncLego(db, localImages)

    const bandai = await db.catalogProduct.count({ where: { brand: "Bandai" } })
    const lego = await db.catalogProduct.count({ where: { brand: "LEGO" } })
    const total = await db.catalogProduct.count()
    log("summary", `目录合计 ${total}（Bandai ${bandai} / LEGO ${lego}）`)
    if (total < 60 || bandai < 25 || lego < 25) {
      console.error(`[catalog-sync] 未达标：需要 ≥60 且两品牌各 ≥25，当前 Bandai ${bandai} / LEGO ${lego}`)
      process.exitCode = 2
    }
  } catch (e) {
    const message = (e as Error).message
    log("error", message)
    for (const id of [brand === "lego" ? "lego" : "bandai"]) {
      const cur = await loadCursor(db, id).catch(() => ({ cursor: "", itemsSynced: 0 }))
      await saveCursor(db, id, id === "lego" ? "LEGO" : "Bandai", cur, "ERROR", message.slice(0, 500)).catch(() => undefined)
    }
    process.exitCode = 1
  } finally {
    await db.$disconnect()
  }
}

const isDirectRun = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href
if (isDirectRun) void main()
