/**
 * LEGO 官网英文名统一策略（R9）——所有 LEGO 名称读写必须经过本模块，不得散落多套判断：
 * - 写入：canonicalName = en-us 官网英文标题；nameZh/nameZhSource 恒 null（即使上游给中文名也丢弃）；
 * - 展示：LEGO 恒用 canonicalName（历史 nameZh 存在也不读）；Bandai 保持原逻辑（有效 nameZh 优先）；
 * - 官网元数据：en-us 商品页 og:title / JSON-LD / <title>（服务端校验 lego.com + /en-us/product/ +
 *   slug 编号与 setNumber 完全一致）；页面 Cloudflare 403 时用 Kimi $web_search 官方候选兜底；
 * - 占位名（LEGO Technic <编号> 等）可被已验证官网标题替换；meaningful canonicalName 只被已验证官网标题更新；
 * - 不通过"编号→英文名"硬编码表完成——名称一律来自通用官网元数据流程。
 */

const FETCH_TIMEOUT_MS = 20_000
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 ModelBaseLegoNaming/1.0"

export interface LegoNameWritePolicy {
  canonicalName: string
  nameZh: null
  nameZhSource: null
}

/**
 * 去掉名称末尾重复的 LEGO Set Number。
 * 只在括号编号与独立 modelNumber 完全一致时处理，避免误删 BMW M 1000 RR、Porsche 911 等名称数字。
 */
export function stripLegoTrailingSetNumber(canonicalName: string, setNumber?: string | null): string {
  const name = canonicalName.trim()
  const set = (setNumber ?? "").replace(/\D/g, "")
  if (!set) return name
  return name.replace(new RegExp(`\\s*[（(]\\s*${set}\\s*[）)]\\s*$`), "").trim()
}

/** 写入策略：LEGO canonicalName 去掉与 modelNumber 重复的末尾括号编号；中文名恒丢弃 */
export function legoCanonicalNamePolicy(
  canonicalName: string,
  _nameZhFromUpstream?: string | null,
  setNumber?: string | null,
): LegoNameWritePolicy {
  void _nameZhFromUpstream
  return {
    canonicalName: stripLegoTrailingSetNumber(canonicalName, setNumber),
    nameZh: null,
    nameZhSource: null,
  }
}

/** 展示策略：LEGO 恒用 canonicalName，并防御旧库中的重复末尾编号；Bandai 走原逻辑 */
export function legoDisplayName(
  brand: string,
  canonicalName: string,
  nameZh: string | null | undefined,
  setNumber?: string | null,
): string {
  if (brand === "LEGO") return stripLegoTrailingSetNumber(canonicalName, setNumber)
  return nameZh ?? canonicalName
}

/**
 * 声明名清理：web search 候选/新闻稿可能带 "LEGO® Icons " / "LEGO® " 系列前缀——
 * en-us 商品页 og:title 口径不含这些前缀（形如 "Stranger Things: The Creel House | LEGO"），
 * 统一去除；™ ® 冒号等正常标点保留。
 */
export function stripLegoBrandPrefix(name: string): string {
  return name
    .replace(/^LEGO\s*[®\u00AE]?\s*(Icons|Technic|City|Star\s*Wars|Friends|Creator|Duplo|Ideas|Architecture|Marvel|DC|Harry\s*Potter|Stranger\s*Things|Speed\s*Champions)?\s*/i, "")
    .trim()
}

/** SEO 后缀清理：去掉 " | LEGO" / " | LEGO® Official" / " | LEGO® Harry Potter™" 等结尾；
 * 保留标题主体的 ™ ® 冒号等正常标点（后缀里的系列名是 SEO 分隔尾巴，不属于商品名） */
export function cleanLegoSeoSuffix(title: string): string {
  return title
    .replace(/\s*\|\s*LEGO(®|\u00AE)?([A-Za-z\u2122\u00AE\s]*?)?\s*$/i, "")
    .replace(/\s*\|\s*LEGO\.com\s*$/i, "")
    .replace(/\s*\|\s*LEGO(®|\u00AE)?\s*$/i, "")
    .trim()
}

/** 占位名识别：LEGO Technic <编号> / LEGO <编号> / LEGO Icons <编号> 等无实义名称 */
export function isGenericLegoPlaceholderName(canonicalName: string, setNumber: string): boolean {
  const name = canonicalName.trim()
  if (!name) return true
  // 纯 "LEGO [系列词]? <编号>" 形态
  const set = setNumber.replace(/[^0-9]/g, "")
  if (!set) return false
  const placeholder = new RegExp(`^LEGO\\s*(Technic|Icons|City|Star\\s*Wars|Friends|Creator|Duplo|System)?\\s*${set}$`, "i")
  if (placeholder.test(name)) return true
  // 只有编号本身
  if (name === set) return true
  return false
}

/**
 * 从 LEGO en-us 商品页 HTML 提取标题：og:title 优先 → JSON-LD Product name → <title>；
 * 均清理 SEO 后缀。
 */
export function extractLegoTitleFromHtml(html: string): string | null {
  // og:title
  const ogTitle =
    html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i) ??
    html.match(/content=["']([^"']+)["']\s+property=["']og:title["']/i)
  if (ogTitle?.[1]) {
    const cleaned = cleanLegoSeoSuffix(ogTitle[1])
    if (cleaned) return cleaned
  }
  // JSON-LD Product name
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      type JsonLdNode = { "@type"?: string; name?: unknown }
      const parsed = JSON.parse(m[1]!.trim()) as JsonLdNode | JsonLdNode[]
      const name = Array.isArray(parsed)
        ? parsed.find((p) => p?.["@type"] === "Product")?.name
        : parsed?.["@type"] === "Product"
          ? parsed?.name
          : undefined
      if (name) {
        const cleaned = cleanLegoSeoSuffix(String(name))
        if (cleaned) return cleaned
      }
    } catch {
      // 非 JSON 跳过
    }
  }
  // <title>
  const titleTag = html.match(/<title>([^<]*)<\/title>/i)
  if (titleTag?.[1]) {
    const cleaned = cleanLegoSeoSuffix(titleTag[1].trim())
    if (cleaned) return cleaned
  }
  return null
}

/** 服务端校验 en-us 商品页 URL：lego.com 域 + /en-us/product/ 路径 + slug 尾编号与 setNumber 一致 */
export function isValidLegoEnUsProductUrl(raw: string, setNumber: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false
  const host = url.hostname.toLowerCase()
  if (host !== "www.lego.com" && host !== "lego.com") return false
  const slugMatch = url.pathname.match(/^\/en-us\/product\/[a-z0-9-]*?-(\d{4,7})\/?$/i)
  if (!slugMatch) return false
  return slugMatch[1] === setNumber.replace(/[^0-9]/g, "")
}

/**
 * 请求 LEGO en-us 商品页并提取官方标题（服务端直连；Cloudflare 403 等失败返回 null，
 * 由上层走 web search 兜底）。带超时与体积上限。
 */
export async function fetchLegoOfficialTitle(pageUrl: string, setNumber: string): Promise<string | null> {
  if (!isValidLegoEnUsProductUrl(pageUrl, setNumber)) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(pageUrl, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      signal: controller.signal,
      redirect: "follow",
    })
    if (res.status !== 200) return null
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase()
    if (!contentType.includes("html") && !contentType.includes("text")) return null
    const declared = Number(res.headers.get("content-length") ?? "0")
    if (declared > 5 * 1024 * 1024) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > 5 * 1024 * 1024) return null
    return extractLegoTitleFromHtml(buf.toString("utf-8"))
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export interface LegoEnUsNameResult {
  status: "RESOLVED" | "FAILED"
  officialName: string | null
  /** 已验证的 en-us 商品页 URL（可能修正了旧 URL 的 slug 错误） */
  pageUrl: string | null
  source: "lego-page" | "web-search" | null
}

export interface LegoEnUsNameOptions {
  /** Kimi $web_search 兜底（页面直连失败时） */
  webSearch?: { apiKey: string; model: string; baseUrl: string }
}

interface WebSearchCandidateShape {
  officialName?: string
  pageUrl?: string
}

/**
 * 通用官网元数据流程解析 LEGO en-us 英文名：
 * 1) 直连 en-us 商品页（og:title/JSON-LD/title）；
 * 2) Cloudflare 403/失败 → Kimi $web_search 查官方候选，逐条校验（lego.com + /en-us/product/ + 编号一致）
 *    后提取标题；
 * 3) 均失败返回 FAILED（不编造）。
 */
export async function resolveLegoEnUsName(
  setNumber: string,
  options: LegoEnUsNameOptions = {},
  knownPageUrl?: string | null,
): Promise<LegoEnUsNameResult> {
  const set = setNumber.replace(/[^0-9]/g, "")
  if (!/^\d{4,7}$/.test(set)) return { status: "FAILED", officialName: null, pageUrl: null, source: null }

  // 1) 直连已知页面
  if (knownPageUrl) {
    const title = await fetchLegoOfficialTitle(knownPageUrl, set)
    if (title) return { status: "RESOLVED", officialName: title, pageUrl: knownPageUrl, source: "lego-page" }
  }

  // 2) web search 兜底（编号已知，不调用视觉模型）
  if (options.webSearch?.apiKey) {
    const { kimiWebSearch } = await import("../ai/kimi")
    const search = await kimiWebSearch(
      options.webSearch.apiKey,
      options.webSearch.model,
      {
        brand: "LEGO",
        name: `LEGO set ${set}`,
        series: "",
        grade: "",
        scale: "",
        modelNumber: set,
      },
      options.webSearch.baseUrl,
    ).catch(() => null)
    if (search?.state === "SUCCEEDED") {
      for (const raw of search.candidates as unknown as WebSearchCandidateShape[]) {
        const pageUrl = raw.pageUrl ?? null
        if (!pageUrl || !isValidLegoEnUsProductUrl(pageUrl, set)) continue // 外部域名/编号不一致拒绝
        const title = await fetchLegoOfficialTitle(pageUrl, set)
        if (title) return { status: "RESOLVED", officialName: title, pageUrl, source: "web-search" }
        // 页面被拦截时接受官网候选声明名（已通过 URL 编号强校验）——
        // 清 SEO 后缀与 "LEGO® Icons" 系列前缀（og:title 口径不含前缀）
        const declared = raw.officialName ? stripLegoBrandPrefix(cleanLegoSeoSuffix(raw.officialName)) : null
        if (declared && !isGenericLegoPlaceholderName(declared, set)) {
          return { status: "RESOLVED", officialName: declared, pageUrl, source: "web-search" }
        }
      }
    }
  }
  return { status: "FAILED", officialName: null, pageUrl: null, source: null }
}

/**
 * 现有 canonicalName 是否保留（不被新结果覆盖）：
 * - meaningful（非占位）名称只被已验证官网标题更新——本函数在"新结果已验证"的前提下，
 *   判断旧名是否为占位（占位 → 允许替换）；
 * - meaningful canonicalName 若与新官网标题相同则无需更新；不同时由调用方决定
 *   （确认入库路径只在官网标题已验证时才写 canonicalName）。
 */
resolveLegoEnUsName.shouldKeepExistingName = function shouldKeepExistingName(existingCanonicalName: string, setNumber: string): boolean {
  return !isGenericLegoPlaceholderName(existingCanonicalName, setNumber)
}

export { resolveLegoEnUsName as resolveLegoEnUsNameFn }
