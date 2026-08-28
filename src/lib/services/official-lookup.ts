import { bandaiNameZh, BANDAI_NAME_ZH_SOURCE, legoOfficialImageUrl, legoOfficialPageUrl, legoThemeLabel } from "../names/zh"
import { legoCanonicalNamePolicy } from "../names/lego-naming"
import type { VisionExtraction } from "../ai/vision"

/**
 * 按需官网查询（目录无匹配时补录正式 CatalogProduct，绝不降级为永久自定义收藏）：
 *
 * Bandai 优先级（任务书）：
 *   1. bandai-hobby.net 商品页（item_all 已收录的常规在售品已由 catalog-sync 同步；
 *      按需场景多为限定/停售品 → 官网无 item 页）；
 *   2. manual.bandai-hobby.net 商品详情（WEB 取扱説明書：品番/発売日/ブランド/作品/商品图）；
 *   3. 官网图片元素（详情页 bl_detail_img 的 bandai-hobby.net 官方图）；
 *   5. 说明书 PDF（记录 viewer.php 的 PDF URL 与页码备查）。
 *
 * LEGO：套装编号为强匹配键——标准主图 URL 可验证
 *   https://www.lego.com/cdn/product-assets/product.img.pri/{setNo}_Prod.png
 *   官网商品页取美国官网（en-us）slug（人工清单）；不绕过验证码，
 *   不使用第三方图片兜底并标记为官方。
 */

const MANUAL_BASE = "https://manual.bandai-hobby.net"
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 ModelBaseOfficialLookup/1.0"
const FETCH_TIMEOUT_MS = 20_000

export interface ManualSearchRow {
  detailId: string
  name: string
  nameEn: string
  releaseDate: string | null
}

export interface ManualDetail {
  detailId: string
  name: string
  productCode: string | null
  releaseDate: string | null
  brand: string | null
  series: string | null
  imageUrl: string | null
  manualPdfUrl: string | null
}

/** 解析 manual.bandai-hobby.net 搜索结果行（纯函数，单测覆盖） */
export function parseManualSearch(html: string): ManualSearchRow[] {
  const rows = new Map<string, ManualSearchRow>()
  for (const m of html.matchAll(/<a[^>]*href="\/menus\/detail\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const [, detailId, inner] = m
    const text = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    if (!text) continue
    // 行文本：日文名 英文名 発売日 YYYY年M月[D日]発売（如 “MGEX 1/100 ストライクフリーダムガンダム MGEX 1/100 STRIKE FREEDOM GUNDAM 発売日 2022年11月19日発売”）
    const releaseM = text.match(/発売日\s*(\d{4}年\d{1,2}月(?:\d{1,2}日)?)/)
    let name = text
    let nameEn = ""
    if (releaseM) name = name.slice(0, releaseM.index).trim()
    // 英文段（含大写字母/数字比例高的后半段）切分
    const enM = name.match(/\s([A-Za-z0-9][A-Za-z0-9\s'"&.,\-()/:[\]]{6,})$/)
    if (enM && /[A-Za-z]/.test(enM[1]!)) {
      nameEn = enM[1]!.trim()
      name = name.slice(0, enM.index).trim()
    }
    const row: ManualSearchRow = {
      detailId: detailId!,
      name,
      nameEn,
      releaseDate: releaseM?.[1] ?? null,
    }
    if (!rows.has(row.detailId)) rows.set(row.detailId, row)
  }
  return [...rows.values()]
}

/** 解析 manual.bandai-hobby.net 商品详情页（纯函数，单测覆盖） */
export function parseManualDetail(html: string, detailId: string): ManualDetail {
  const titleM = html.match(/<h2 class="el_title"><span>([^<]+)<\/span><\/h2>/)
  const name = titleM?.[1]?.trim() ?? ""
  const pick = (label: string): string | null => {
    const m = html.match(new RegExp(`<dt[^>]*>\\s*${label}\\s*<span[\\s\\S]*?</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`))
    if (!m) return null
    return m[1]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null
  }
  const productCode = pick("品番")
  const releaseDate = pick("発売日")
  const brand = pick("ブランド")
  const series = pick("作品")
  const imgM = html.match(/<div class="bl_detail_img">\s*<img src="([^"]+)"[^>]*>/)
  const imageUrl = imgM?.[1]?.startsWith("http") ? imgM[1] : imgM?.[1] ? new URL(imgM[1]!, MANUAL_BASE).toString() : null
  // 说明书 PDF（viewer.php 内嵌 iframe；数据源第 5 级备查）
  const pdfM = html.match(/(?:href|src)="(\/viewer\.php\?file=[^"]+)"/)
  const manualPdfUrl = pdfM ? new URL(pdfM[1]!, MANUAL_BASE).toString() : null
  return { detailId, name, productCode, releaseDate, brand, series, imageUrl, manualPdfUrl }
}

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja,en;q=0.8" }, signal: controller.signal })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function parseReleaseYear(releaseDate: string | null): number | null {
  if (!releaseDate) return null
  const m = releaseDate.match(/(\d{4})年/)
  return m ? Number(m[1]) : null
}

/** Bandai 系列名（作品）→ 目录 line 归一 */
const SERIES_TO_LINE: { pattern: RegExp; line: string }[] = [
  { pattern: /SEED DESTINY/i, line: "CE" },
  { pattern: /SEED/i, line: "CE" },
  { pattern: /宇宙世紀|逆襲|ユニコーン|Zガンダム|閃光|UC/i, line: "UC" },
  { pattern: /ウイング|Wing/i, line: "AC" },
  { pattern: /鉄血|ORPHANS/i, line: "PD" },
  { pattern: /水星の魔女|WITCH/i, line: "AC" },
  { pattern: /00|ダブルオー/i, line: "AD" },
  { pattern: /G-RECO/i, line: "RC" },
  { pattern: /ビルド|BUILD/i, line: "BUILD" },
]

export function seriesToLine(series: string | null): string {
  if (!series) return "OTHER"
  for (const { pattern, line } of SERIES_TO_LINE) {
    if (pattern.test(series)) return line
  }
  return "OTHER"
}

/** 从日文商品名提取机体型号（如 ZGMF-X20A / RX-93 / MSN-04FF） */
export function extractModelNumber(name: string): string | null {
  const m = name.match(/\b((?:[A-Z]{1,4}-)?[A-Z]{1,5}-?\d{2,4}[A-Z]*(?:-[A-Z0-9]+)?)\b/)
  return m?.[1] ?? null
}

export interface OfficialProductDraft {
  id: string
  brand: "Bandai" | "LEGO"
  category: string
  line: string | null
  grade: string
  series: string | null
  canonicalName: string
  nameZh: string | null
  nameZhSource: string | null
  modelNumber: string | null
  officialProductCode: string | null
  officialPageUrl: string | null
  officialImageUrl: string | null
  releaseYear: number | null
  source: string
  /** 说明书 PDF（Bandai 数据源第 5 级备查） */
  manualPdfUrl: string | null
}

/**
 * Bandai 按需查询：manual.bandai-hobby.net 搜索（freeword=商品名）→ 行打分
 * （等级一致 + 名称相似）→ 拉取详情页（品番/発売日/ブランド/作品/官网图）。
 * 找不到返回 null（调用方保留用户上传图 + 内部失败状态，不冒充官网资料）。
 */
export async function lookupBandai(
  extraction: Pick<VisionExtraction, "name" | "grade"> & { modelNumber?: string },
): Promise<OfficialProductDraft | null> {
  const keyword = extraction.name.replace(/\[([^\]]+)\]/g, "").trim()
  if (!keyword) return null
  const searchHtml = await fetchHtml(`${MANUAL_BASE}/?freeword=${encodeURIComponent(keyword)}`)
  if (!searchHtml) return null
  const rows = parseManualSearch(searchHtml)
  if (rows.length === 0) return null

  // 打分：等级一致 + 名称精确度（完全一致 > 前缀一致（基础款，变体在后）> 包含 > 词元重叠）
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase()
  const key = norm(keyword)
  const gradePrefix = extraction.grade ? `${extraction.grade.toLowerCase()}1/` : ""
  const scored = rows
    .map((row) => {
      const rn = norm(row.name)
      let score = 0
      if (extraction.grade && row.name.toUpperCase().startsWith(extraction.grade.toUpperCase())) score += 3
      else if (gradePrefix && rn.startsWith(gradePrefix)) score += 2
      // 名称精确度：完全一致是基础款强信号；变体（[クリアカラー] 等）降权
      if (rn === key) score += 8
      else if (rn.startsWith(key)) score += 5
      else if (rn.includes(key) || key.includes(rn)) score += 3
      else {
        // 词元重叠率
        const tokens = keyword.split(/[\s/]+/).filter((t) => t.length >= 2)
        const hit = tokens.filter((t) => rn.includes(norm(t))).length
        score += tokens.length > 0 ? (hit / tokens.length) * 4 : 0
      }
      return { row, score }
    })
    .sort((a, b) => b.score - a.score)
  const best = scored[0]
  if (!best || best.score < 4) return null

  const detailHtml = await fetchHtml(`${MANUAL_BASE}/menus/detail/${best.row.detailId}`)
  if (!detailHtml) return null
  const detail = parseManualDetail(detailHtml, best.row.detailId)
  if (!detail.name) return null
  const grade = detail.brand ?? extraction.grade ?? "OTHER"
  // 机体型号优先取包装可见的 Kimi 提取（详情页不印型号；ZGMF-X20A 等从盒面读取）
  const modelNumber = extraction.modelNumber?.trim() || extractModelNumber(detail.name)
  return {
    id: `bandai-manual-${detail.detailId}`,
    brand: "Bandai",
    category: "Gundam",
    line: seriesToLine(detail.series),
    grade,
    series: detail.series,
    canonicalName: detail.name,
    nameZh: bandaiNameZh(detail.name),
    nameZhSource: BANDAI_NAME_ZH_SOURCE,
    modelNumber,
    officialProductCode: detail.productCode,
    officialPageUrl: `${MANUAL_BASE}/menus/detail/${detail.detailId}`,
    officialImageUrl: detail.imageUrl,
    releaseYear: parseReleaseYear(detail.releaseDate),
    source: `${MANUAL_BASE}/menus/detail/${detail.detailId}`,
    manualPdfUrl: detail.manualPdfUrl,
  }
}

export interface LegoLookupInput {
  setNumber: string
  name: string
  series?: string | null
  grade?: string | null
}

/**
 * LEGO 按需查询：套装编号为强匹配键。标准主图 URL 直接可验证（官方 CDN）。
 * 名称策略（R9）：canonicalName = en-us 官网英文标题口径（Kimi 提取的英文名去编号后缀；
 * 上层 catalog-official/回填会用已验证官网标题覆盖）；nameZh/nameZhSource 恒 null。
 */
export function lookupLegoDraft(input: LegoLookupInput): OfficialProductDraft {
  const setNumber = input.setNumber.trim()
  // 只移除与 setNumber 完全一致的末尾括号编号，避免误删正式名称中的数字
  const policy = legoCanonicalNamePolicy(input.name.trim() || `LEGO ${setNumber}`, null, setNumber)
  const series = input.series?.trim() || null
  const theme = legoThemeLabel(series, input.grade)
  return {
    id: `lego-${setNumber}`,
    brand: "LEGO",
    category: "LEGO",
    line: null,
    grade: theme,
    series,
    canonicalName: policy.canonicalName,
    nameZh: policy.nameZh,
    nameZhSource: policy.nameZhSource,
    modelNumber: setNumber,
    officialProductCode: setNumber,
    officialPageUrl: legoOfficialPageUrl(setNumber),
    officialImageUrl: legoOfficialImageUrl(setNumber),
    releaseYear: null,
    source: legoOfficialPageUrl(setNumber) ?? `https://www.lego.com/cdn/product-assets/product.img.pri/${setNumber}_Prod.png`,
    manualPdfUrl: null,
  }
}
