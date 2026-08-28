import type { PrismaClient } from "@prisma/client"
import { officialPageHostCheck, officialImageHostCheck } from "./official-image"
import {
  bandaiNameZh,
  legoOfficialImageUrl,
  legoOfficialPageUrl,
  legoThemeLabel,
  normalizeLegoOfficialPageUrl,
  BANDAI_NAME_ZH_SOURCE,
} from "../names/zh"
import { legoCanonicalNamePolicy } from "../names/lego-naming"
import { seriesToLine, parseReleaseYear, extractModelNumber, parseManualSearch, parseManualDetail } from "./official-lookup"
import { kimiWebSearch, type WebSearchCandidate } from "../ai/kimi"

/**
 * 官网搜索服务（识别主链路重构）：Kimi $web_search 真实联网搜索官方商品页 → 逐条验证。
 *
 * 边界（任务书）：
 * - 只展示真实抓取验证过的官方页面候选；模型声明的 URL 一律重新抓页验证，
 *   404/跳转到无关页/非官方域名全部丢弃——绝不拿本地目录"最像的"商品顶替；
 * - 模糊名称匹配/自动 Top-1 推荐已从识别主链路移除；本地目录仅允许：
 *   官方页面 ID 精确缓存读取、官方产品编号精确去重、LEGO Set Number 精确去重；
 * - 候选唯一标识 = 官方页面 ID（bandai-manual-949 / bandai-item-01_15）或官方产品编号。
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 ModelBaseOfficialSearch/1.0"
const FETCH_TIMEOUT_MS = 20_000
/** 逐页验证的礼貌间隔 */
const VERIFY_INTERVAL_MS = 400

export interface SearchExtractionInput {
  brand: string
  name: string
  series: string
  grade: string
  scale: string
  modelNumber: string
  visibleText?: string
}

/** 验证后的官方候选（页面真实存在 + 域名官方 + 名称取自页面本身） */
export interface VerifiedOfficialCandidate {
  /** 唯一标识：官方页面 ID 派生（确认入库作为 catalog id） */
  key: string
  origin: "web_search" | "lego_set_exact"
  officialName: string
  nameZh: string | null
  productCode: string | null
  pageUrl: string
  imageUrl: string | null
  sourceDomain: string
  snippet: string | null
  brand: string
  grade: string | null
  scale: string | null
  modelNumber: string | null
  series: string | null
  releaseYear: number | null
  line: string | null
}

export interface OfficialSearchResult {
  state: "SUCCEEDED" | "FAILED"
  candidates: VerifiedOfficialCandidate[]
  searchQueries: string[]
  errorCode: string | null
  message: string
  /** 联网搜索 token 用量（台账记录） */
  promptTokens: number
  completionTokens: number
  latencyMs: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 官方页面 ID 派生唯一标识（CatalogProduct.id 格式 ^[A-Za-z0-9_-]{1,64}$） */
export function officialPageKey(pageUrl: string, productCode: string | null): string | null {
  let parsed: URL
  try {
    parsed = new URL(pageUrl)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  const path = parsed.pathname.replace(/\/+$/, "")
  // manual.bandai-hobby.net/menus/detail/949 → bandai-manual-949
  const manual = path.match(/^\/menus\/detail\/(\d+)$/)
  if (manual && (host === "manual.bandai-hobby.net")) return `bandai-manual-${manual[1]!}`
  // bandai-hobby.net(/地域)/item/01_15 → bandai-item-01_15（global 站与日本站同商品 ID）
  const item = path.match(/\/item\/([A-Za-z0-9_]+)$/)
  if (item && host.endsWith("bandai-hobby.net")) return `bandai-item-${item[1]!}`
  // p-bandai.jp(/地域)/item/12345 → pbandai-12345
  const pb = path.match(/\/item\/(\d+)/)
  if (pb && host.endsWith("p-bandai.jp")) return `pbandai-${pb[1]!}`
  // lego.com/<locale>/product/<slug>-42172 → lego-42172
  const lego = path.match(/\/product\/(?:[^/]*-)?(\d{4,7})$/)
  if (lego && host.endsWith("lego.com")) return `lego-${lego[1]!}`
  // 无法派生页面 ID：退回产品编号（官方产品编号作为唯一标识）
  if (productCode && /^[A-Za-z0-9_-]{1,40}$/.test(productCode)) return `code-${productCode}`
  return null
}

interface ParsedOfficialPage {
  officialName: string | null
  productCode: string | null
  imageUrl: string | null
  releaseYear: number | null
  brand: string | null
  series: string | null
  scale: string | null
  /** 页面重定向到无关地址（如 p-bandai 全球提示页） */
  redirectedAway: boolean
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
}

/**
 * Bandai 商品页主轮播图：新版页面会把商品图直接放在 bandai-hobby.net/images/，
 * 旧版则使用 Akamai。只读取 data-fancybox="images" 的商品相册链接，避免误取
 * ogp、Logo、Banner 或相关推荐图片；最终仍经过官方图片域名白名单校验。
 */
function extractBandaiGalleryImage(html: string, pageUrl: string): string | null {
  const galleryAnchors = html.matchAll(/<a\b[^>]*\bdata-fancybox\s*=\s*(["'])images\1[^>]*>/gi)
  for (const match of galleryAnchors) {
    const href = match[0].match(/\bhref\s*=\s*(["'])([^"']+)\1/i)?.[2]
    if (!href) continue

    let candidate: string
    try {
      candidate = new URL(decodeEntities(href.trim()), pageUrl).toString()
    } catch {
      continue
    }
    if (!officialImageHostCheck(candidate).ok) continue

    const pathname = new URL(candidate).pathname
    if (!/\.(?:jpe?g|png|webp)$/i.test(pathname)) continue
    if (/\/(?:common|bnr)\//i.test(pathname) || /\/(?:ogp|webclip|favicon)(?:[._-]|$)/i.test(pathname)) continue
    return candidate
  }
  return null
}

/** 解析 Bandai/LEGO 官方商品页（纯函数：单测覆盖真实页面快照） */
export function parseOfficialPage(html: string, url: string): ParsedOfficialPage {
  const out: ParsedOfficialPage = {
    officialName: null,
    productCode: null,
    imageUrl: null,
    releaseYear: null,
    brand: null,
    series: null,
    scale: null,
    redirectedAway: false,
  }
  let host = ""
  let path = ""
  try {
    const u = new URL(url)
    host = u.hostname.toLowerCase()
    path = u.pathname
  } catch {
    return out
  }

  // —— manual.bandai-hobby.net/menus/detail/N：品番/発売日/ブランド/作品/商品图 —— //
  if (host === "manual.bandai-hobby.net") {
    const titleM = html.match(/<h2 class="el_title"><span>([^<]+)<\/span><\/h2>/)
    if (titleM) out.officialName = decodeEntities(titleM[1]!.trim())
    const pick = (label: string): string | null => {
      const m = html.match(new RegExp(`<dt[^>]*>\\s*${label}\\s*<span[\\s\\S]*?</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`))
      if (!m) return null
      return decodeEntities(m[1]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()) || null
    }
    out.productCode = pick("品番")
    out.brand = pick("ブランド")
    out.series = pick("作品")
    out.releaseYear = parseReleaseYear(pick("発売日"))
    const imgM = html.match(/<div class="bl_detail_img">\s*<img src="([^"]+)"[^>]*>/)
    if (imgM) out.imageUrl = imgM[1]!.startsWith("http") ? imgM[1]! : `https://manual.bandai-hobby.net${imgM[1]!}`
    return out
  }

  // —— bandai-hobby.net/item/XX_YYYY：标题 + 商品相册/Akamai/CloudFront 商品图 + 発売日 —— //
  if (host.endsWith("bandai-hobby.net")) {
    const titleM = html.match(/<title>([^<]*)<\/title>/)
    if (titleM) out.officialName = decodeEntities(titleM[1]!.replace(/｜[^｜]*$/, "").trim())
    // 商品图：主轮播优先；旧页再回退官方 CDN 直链。忽略 ogp/bnr/ico 等非商品图。
    const galleryImage = extractBandaiGalleryImage(html, url)
    const imgs = [...html.matchAll(/"(https:\/\/bandai-a\.akamaihd\.net\/bc\/img\/model\/xl\/[^"]+)"/g)].map((m) => m[1]!)
    const cf = [...html.matchAll(/"(https:\/\/d3bk8pkqsprcvh\.cloudfront\.net\/hobby\/jp\/product\/[^"]+)"/g)].map((m) => m[1]!)
    out.imageUrl = galleryImage ?? imgs[0] ?? cf[0] ?? null
    const relM = html.match(/発売日[\s\S]{0,200}?<dd[^>]*>\s*(\d{4})年(\d{1,2})月/)
    if (relM) out.releaseYear = Number(relM[1])
    return out
  }

  // —— p-bandai.jp：og:title/og:image（SPA/重定向时 redirectedAway 由调用方判定） —— //
  if (host.endsWith("p-bandai.jp")) {
    const titleM = html.match(/<title>([^<]*)<\/title>/)
    const ogTitle = html.match(/property="og:title"\s+content="([^"]+)"/) ?? html.match(/content="([^"]+)"\s+property="og:title"/)
    out.officialName = decodeEntities((ogTitle?.[1] ?? titleM?.[1] ?? "").trim()) || null
    const ogImg = html.match(/property="og:image"\s+content="([^"]+)"/) ?? html.match(/content="([^"]+)"\s+property="og:image"/)
    if (ogImg && /^https:\/\//.test(ogImg[1]!)) out.imageUrl = ogImg[1]!
    const codeM = html.match(/品番[：:]?\s*([A-Z0-9]{5,12})/)
    if (codeM) out.productCode = codeM[1]!
    return out
  }

  // —— lego.com：og:title/og:image（Akamai 拦截时页面验证会失败，走套装编号路径） —— //
  if (host.endsWith("lego.com")) {
    const ogTitle = html.match(/property="og:title"\s+content="([^"]+)"/)
    if (ogTitle) out.officialName = decodeEntities(ogTitle[1]!.trim())
    const ogImg = html.match(/property="og:image"\s+content="([^"]+)"/)
    if (ogImg) out.imageUrl = ogImg[1]!
    return out
  }
  return out
}

/** 从商品名提取比例（1/100 等） */
export function extractScale(name: string): string | null {
  const m = name.match(/1\/\d{2,3}/)
  return m?.[0] ?? null
}

async function fetchPage(url: string): Promise<{ html: string | null; finalUrl: string; redirectedAway: boolean }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "ja,en;q=0.8" },
      signal: controller.signal,
      redirect: "follow",
    })
    if (res.status !== 200) return { html: null, finalUrl: res.url || url, redirectedAway: false }
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase()
    if (!contentType.includes("html") && !contentType.includes("text")) {
      return { html: null, finalUrl: res.url || url, redirectedAway: false }
    }
    const finalUrl = res.url || url
    // 重定向到无关页面（如 p-bandai 全球提示页 global_newpc.html）
    let redirectedAway = false
    try {
      const a = new URL(url)
      const b = new URL(finalUrl)
      redirectedAway = a.host !== b.host || a.pathname.replace(/\/+$/, "") !== b.pathname.replace(/\/+$/, "")
    } catch {
      redirectedAway = true
    }
    const html = await res.text()
    // 跳转提示页/质询页特征
    if (/Just a moment|global_newpc|挑战|challenge/i.test(html.slice(0, 3000))) redirectedAway = true
    return { html, finalUrl, redirectedAway }
  } catch {
    return { html: null, finalUrl: url, redirectedAway: false }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 验证单个模型声明候选：抓取页面 → 官方域名 + 页面真实存在 + 名称取自页面本身。
 * 任何一步失败返回 null（丢弃，不用目录商品顶替）。
 * 例外：LEGO 商品页被 Akamai 拦截时，按 URL 套装编号走官方标准主图（无需页面可达）。
 */
async function verifyCandidate(
  raw: WebSearchCandidate,
  brand: string,
  extraction: SearchExtractionInput,
): Promise<VerifiedOfficialCandidate | null> {
  const host = officialPageHostCheck(raw.pageUrl)
  if (!host.ok) return null
  // 图片直链（模型声明）：必须官方域名（仅作展示候选，最终入库前仍走字节校验）
  const modelImage = raw.imageUrl && officialImageHostCheck(raw.imageUrl).ok ? raw.imageUrl : null

  const page = await fetchPage(raw.pageUrl)
  const pageVerified = Boolean(page.html && !page.redirectedAway)

  if (!pageVerified) {
    // LEGO：URL 套装编号 + 可验证的官方标准主图构成可信候选（页面被拦截不等于商品不存在）
    const lego = raw.pageUrl.match(/lego\.com\/[^/]*\/product\/(?:[^/]*-)?(\d{4,7})/)
    if (!lego) return null // Bandai 页面不可达/被拦截 → 丢弃
    const setNumber = lego[1]!
    const theme = legoThemeLabel(extraction.series, extraction.grade)
    const officialName = legoCanonicalNamePolicy(
      raw.officialName || extraction.name.trim() || `LEGO ${setNumber}`,
      null,
      setNumber,
    ).canonicalName
    return {
      key: `lego-${setNumber}`,
      origin: "lego_set_exact",
      officialName,
      nameZh: null,
      productCode: raw.productCode ?? setNumber,
      pageUrl: normalizeLegoOfficialPageUrl(raw.pageUrl, setNumber) ?? raw.pageUrl,
      imageUrl: legoOfficialImageUrl(setNumber),
      sourceDomain: "www.lego.com",
      snippet: raw.snippet,
      brand: "LEGO",
      grade: theme,
      scale: extraction.scale || null,
      modelNumber: setNumber,
      series: extraction.series.trim() || null,
      releaseYear: null,
      line: null,
    }
  }

  const parsed = parseOfficialPage(page.html!, raw.pageUrl)
  // 名称取自页面实际标题（验证过的真实名称），而非模型声明
  const officialName = parsed.officialName ?? raw.officialName
  if (!officialName) return null

  const productCode = parsed.productCode ?? raw.productCode ?? null
  const key = officialPageKey(raw.pageUrl, productCode)
  if (!key) return null

  let imageUrl: string | null = null
  for (const img of [parsed.imageUrl, modelImage]) {
    if (img && officialImageHostCheck(img).ok) {
      imageUrl = img
      break
    }
  }
  // LEGO 候选：标准主图 URL（可验证）优先
  const legoSet = key.match(/^lego-(\d{4,7})$/)
  if (legoSet) {
    imageUrl = legoOfficialImageUrl(legoSet[1]!)
  }
  const isLego = Boolean(legoSet) || brand.toLowerCase() === "lego" || /lego\.com/.test(raw.pageUrl)
  const legoTheme = isLego ? legoThemeLabel(extraction.series, extraction.grade) : null
  const normalizedOfficialName = isLego
    ? legoCanonicalNamePolicy(officialName, null, legoSet?.[1] ?? extraction.modelNumber).canonicalName
    : officialName
  // LEGO 名称策略：nameZh 恒 null（官网英文 canonicalName 即展示名）；Bandai 原逻辑
  const nameZh = isLego ? null : bandaiNameZh(officialName) || null

  return {
    key,
    origin: legoSet && brand.toLowerCase() === "lego" ? "lego_set_exact" : "web_search",
    officialName: normalizedOfficialName,
    nameZh,
    productCode,
    pageUrl: legoSet ? (normalizeLegoOfficialPageUrl(raw.pageUrl, legoSet[1]!) ?? raw.pageUrl) : raw.pageUrl,
    imageUrl,
    sourceDomain: (() => {
      try {
        return new URL(raw.pageUrl).hostname
      } catch {
        return raw.sourceDomain
      }
    })(),
    snippet: raw.snippet,
    brand: isLego ? "LEGO" : "Bandai",
    grade: isLego ? legoTheme : (parsed.brand ?? (extraction.grade || null)),
    scale: parsed.scale ?? extractScale(normalizedOfficialName) ?? (extraction.scale || null),
    modelNumber: legoSet?.[1] ?? (extraction.modelNumber || extractModelNumber(normalizedOfficialName)),
    series: parsed.series ?? (extraction.series || null),
    releaseYear: parsed.releaseYear,
    line: isLego ? null : seriesToLine(parsed.series ?? extraction.series),
  }
}

/**
 * 说明书页补充（manual.bandai-hobby.net 站内检索）：
 * 联网搜索结果不稳定时，直接用官网自身的 freeword 检索补齐带品番的说明书页候选
 * （Bandai 官方域名，页面真实抓取验证；非本地目录匹配）。
 */
async function manualSiteCandidate(extraction: SearchExtractionInput): Promise<VerifiedOfficialCandidate | null> {
  if (extraction.brand.toLowerCase() === "lego") return null
  const name = extraction.name.replace(/\[([^\]]+)\]/g, "").trim()
  if (!name) return null
  // 站内检索只接受单词：依次尝试机体型号 → 名称中最长的日文段 → 完整名
  const cjkSegments = name.match(/[\u3040-\u30ff\u4e00-\u9fff]+/g) ?? []
  const longestCjk = cjkSegments.sort((a, b) => b.length - a.length)[0] ?? null
  const keywords = [...new Set([extraction.modelNumber.trim(), longestCjk, name].filter((k): k is string => Boolean(k && k.length >= 2)))]
  let rows: ReturnType<typeof parseManualSearch> = []
  for (const keyword of keywords) {
    let res = await fetchPage(`https://manual.bandai-hobby.net/?freeword=${encodeURIComponent(keyword)}`)
    if (!res.html || res.redirectedAway) {
      // 站内检索偶发限流：退避重试一次
      await sleep(1500)
      res = await fetchPage(`https://manual.bandai-hobby.net/?freeword=${encodeURIComponent(keyword)}`)
    }
    if (!res.html || res.redirectedAway) continue
    const found = parseManualSearch(res.html)
    if (found.length > 0) {
      rows = found
      break
    }
    await sleep(VERIFY_INTERVAL_MS)
  }
  if (rows.length === 0) return null
  // 行打分：等级前缀 + 名称精确度（与官网查询一致的确定性规则；对完整名打分）
  const norm = (x: string) => x.replace(/\s+/g, "").toLowerCase()
  const key = norm(name)
  const best = rows
    .map((row) => {
      const rn = norm(row.name)
      let score = 0
      if (extraction.grade && row.name.toUpperCase().startsWith(extraction.grade.toUpperCase())) score += 3
      if (rn === key) score += 8
      else if (rn.startsWith(key) || key.startsWith(rn)) score += 5
      else if (rn.includes(key) || key.includes(rn)) score += 3
      else {
        const tokens = name.split(/[\s/]+/).filter((t) => t.length >= 2)
        const hit = tokens.filter((t) => rn.includes(norm(t))).length
        score += tokens.length > 0 ? (hit / tokens.length) * 4 : 0
      }
      if (extraction.modelNumber && rn.includes(norm(extraction.modelNumber))) score += 4
      // 变体降权：候选名含限定/涂层/透明等变体标记而检索名没有 → 大概率是衍生款
      const variantMarkers = ["限定", "[", "スペシャル", "コーティング", "クリア", "メタリック", "メカニカル", "チタニウム", "ライトニング", "チタニウムフィニッシュ"]
      const nameHasVariant = variantMarkers.some((m) => key.includes(norm(m)))
      if (!nameHasVariant && variantMarkers.some((m) => rn.includes(norm(m)))) score -= 6
      return { row, score }
    })
    .sort((a, b) => b.score - a.score)[0]
  if (!best || best.score < 4) return null

  const detailRes = await fetchPage(`https://manual.bandai-hobby.net/menus/detail/${best.row.detailId}`)
  if (!detailRes.html || detailRes.redirectedAway) return null
  const detail = parseManualDetail(detailRes.html, best.row.detailId)
  if (!detail.name) return null
  return {
    key: `bandai-manual-${detail.detailId}`,
    origin: "web_search",
    officialName: detail.name,
    nameZh: bandaiNameZh(detail.name) || null,
    productCode: detail.productCode,
    pageUrl: `https://manual.bandai-hobby.net/menus/detail/${detail.detailId}`,
    imageUrl: detail.imageUrl,
    sourceDomain: "manual.bandai-hobby.net",
    snippet: "WEB 取扱説明書（站内检索，含品番/発売日）",
    brand: "Bandai",
    grade: detail.brand ?? (extraction.grade || null),
    scale: extractScale(detail.name) ?? (extraction.scale || null),
    modelNumber: extraction.modelNumber || extractModelNumber(detail.name),
    series: detail.series ?? (extraction.series || null),
    releaseYear: parseReleaseYear(detail.releaseDate),
    line: seriesToLine(detail.series ?? extraction.series),
  }
}

/** LEGO Set Number 精确候选（唯一允许的本地目录参与：精确键匹配，非模糊） */
async function legoExactCandidate(
  db: PrismaClient,
  extraction: SearchExtractionInput,
): Promise<VerifiedOfficialCandidate | null> {
  const setNumber = extraction.modelNumber.replace(/[^0-9]/g, "")
  if (!/^\d{4,7}$/.test(setNumber)) return null
  if (extraction.brand.toLowerCase() !== "lego") return null
  const id = `lego-${setNumber}`
  const existing = await db.catalogProduct.findUnique({ where: { id } })
  const extractedSeries = extraction.series.trim() || null
  const theme = legoThemeLabel(extractedSeries, extraction.grade)
  const pageUrl = normalizeLegoOfficialPageUrl(existing?.officialPageUrl, setNumber)
    ?? legoOfficialPageUrl(setNumber)
    ?? `https://www.lego.com/en-us/product/${setNumber}`
  if (existing) {
    // 目录已有（精确键命中）：直接读缓存（允许的本地目录用法）
    return {
      key: id,
      origin: "lego_set_exact",
      officialName: legoCanonicalNamePolicy(
        extraction.name.trim() || existing.canonicalName,
        null,
        setNumber,
      ).canonicalName,
      nameZh: null,
      productCode: existing.officialProductCode,
      pageUrl,
      imageUrl: existing.officialImageUrl ?? legoOfficialImageUrl(setNumber),
      sourceDomain: "www.lego.com",
      snippet: "LEGO Set Number 精确匹配（本地目录缓存）",
      brand: "LEGO",
      grade: theme,
      scale: null,
      modelNumber: setNumber,
      series: extractedSeries ?? existing.series,
      releaseYear: existing.releaseYear,
      line: theme === "TECHNIC" ? existing.line : null,
    }
  }
  // 标准主图地址可验证 → 构成可信候选（无需本地目录）
  return {
    key: id,
    origin: "lego_set_exact",
    officialName: legoCanonicalNamePolicy(extraction.name.trim() || `LEGO ${setNumber}`, null, setNumber).canonicalName,
    nameZh: null,
    productCode: setNumber,
    pageUrl,
    imageUrl: legoOfficialImageUrl(setNumber),
    sourceDomain: "www.lego.com",
    snippet: "按 LEGO Set Number 构造官方标准地址",
    brand: "LEGO",
    grade: theme,
    scale: null,
    modelNumber: setNumber,
    series: extractedSeries,
    releaseYear: null,
    line: null,
  }
}

export interface OfficialSearchOptions {
  /** 真实联网搜索（$web_search 工具）；E2E/演示模式必须为 false */
  liveSearch: boolean
  apiKey: string
  model: string
  /** OpenAI 兼容端点（用户可配任意厂商） */
  baseUrl: string
}

/**
 * 官网搜索主入口：Kimi $web_search → 候选逐条验证（页面真实抓取）→ 去重排序。
 * 失败/无结果时返回空候选（绝不从本地目录找"最像的"顶替）。
 */
export async function searchOfficialProducts(
  db: PrismaClient,
  extraction: SearchExtractionInput,
  options: OfficialSearchOptions,
): Promise<OfficialSearchResult> {
  const candidates: VerifiedOfficialCandidate[] = []
  const seenKeys = new Set<string>()
  let searchQueries: string[] = []
  let usage = { promptTokens: 0, completionTokens: 0, latencyMs: 0 }

  const push = (c: VerifiedOfficialCandidate | null) => {
    if (!c) return
    if (seenKeys.has(c.key)) return
    seenKeys.add(c.key)
    candidates.push(c)
  }

  // LEGO：Set Number 精确键（允许的本地目录唯一参与方式）
  push(await legoExactCandidate(db, extraction))

  // Kimi $web_search 真实联网搜索（Bandai 官方域名优先）
  if (options.liveSearch) {
    const result = await kimiWebSearch(options.apiKey, options.model, {
      brand: extraction.brand,
      name: extraction.name,
      series: extraction.series,
      grade: extraction.grade,
      scale: extraction.scale,
      modelNumber: extraction.modelNumber,
      visibleText: extraction.visibleText,
    }, options.baseUrl)
    usage = {
      promptTokens: result.promptTokens ?? 0,
      completionTokens: result.completionTokens ?? 0,
      latencyMs: result.latencyMs,
    }
    searchQueries = result.searchQueries
    if (result.state === "SUCCEEDED") {
      let verified = 0
      for (const raw of result.candidates.slice(0, 5)) {
        const v = await verifyCandidate(raw, extraction.brand, extraction)
        push(v)
        if (v) verified++
        await sleep(VERIFY_INTERVAL_MS)
      }
      if (verified === 0 && result.candidates.length > 0) {
        return {
          state: "SUCCEEDED",
          candidates: candidates.filter((c) => c.origin === "lego_set_exact"),
          searchQueries,
          errorCode: null,
          message: `搜索到 ${result.candidates.length} 个页面但均未通过官方验证（页面不可达或非官方域名），未找到官网商品`,
          ...usage,
        }
      }
    }
    // 搜索失败不阻断：保留 LEGO 精确候选（如有），其余显示搜索失败提示
    if (result.state === "FAILED" && candidates.length === 0) {
      return {
        state: "FAILED",
        candidates: [],
        searchQueries,
        errorCode: result.errorCode ?? "SEARCH_FAILED",
        message: "官网搜索失败，可修改名称后重试",
        ...usage,
      }
    }
    // 说明书页补充：官网站内检索保证带品番的说明书页候选在场
    // （联网搜索结果不稳定；补充按 key 去重——已有同页候选时无副作用）
    await sleep(VERIFY_INTERVAL_MS)
    push(await manualSiteCandidate(extraction))
  }

  return {
    state: "SUCCEEDED",
    candidates: candidates.slice(0, 5),
    searchQueries,
    errorCode: null,
    message: candidates.length === 0 ? "未找到官网商品：可修改名称后点击「重新搜索官网」" : `找到 ${candidates.length} 个官网候选，请核对后选择`,
    ...usage,
  }
}

/** 中文名默认值（编辑表单预填：Bandai 词典转写 / LEGO 官方清单） */
export function defaultNameZh(extraction: SearchExtractionInput): string {
  // LEGO 名称策略：不提供中文名（展示恒用官网英文 canonicalName）
  if (extraction.brand.toLowerCase() === "lego") return ""
  return bandaiNameZh(extraction.name)
}

export { BANDAI_NAME_ZH_SOURCE }
