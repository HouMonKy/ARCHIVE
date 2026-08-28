import { createHash } from "node:crypto"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import sharp from "sharp"
import { isHostedRuntime } from "../db-mode"

/**
 * 官网原图抓取与缓存（官网资料闭环）：
 * - 只接受 Bandai / Bandai Hobby / LEGO 官方域名与官方 CDN——绝不把 Rebrickable、
 *   电商、HobbySearch 等第三方图片当作官网图；
 * - 校验 HTTP 200 + Content-Type image/* + 魔数（JPEG/PNG/WebP）+ 字节数 + 像素尺寸，
 *   任何一步失败都记为 FAILED——不得把 HTML/403/占位图写成成功；
 * - 文件只落本机 private-assets/product-images/（gitignored；HOSTED 模式不落盘）；
 * - 数据库只记录 URL、SHA-256、缓存文件名与状态。
 */

export const OFFICIAL_IMAGE_MIN_BYTES = 1024
export const OFFICIAL_IMAGE_MAX_BYTES = 12 * 1024 * 1024
/** 合理尺寸：宽 ≥300px 且高 ≥120px（LEGO 官方横幅图约 500×184；过小视为占位图拒绝） */
export const OFFICIAL_IMAGE_MIN_WIDTH = 300
export const OFFICIAL_IMAGE_MIN_HEIGHT = 120

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 ModelBaseOfficialImage/1.0"
const FETCH_TIMEOUT_MS = 30_000

/** 官方图片域名白名单（Bandai Hobby 官网/官方 CDN 与 LEGO 官网 CDN） */
const ALLOWED_OFFICIAL_IMAGE_HOSTS = new Set([
  "bandai-hobby.net",
  "www.bandai-hobby.net",
  "manual.bandai-hobby.net",
  "global.bandai-hobby.net",
  // Bandai Hobby 官网商品图的官方 CDN（bandai-hobby.net 商品页直引）
  "d3bk8pkqsprcvh.cloudfront.net",
  // Bandai 官方 Akamai 图片 CDN（bandai-hobby.net 商品页 og/主图直引）
  "bandai-a.akamaihd.net",
  // Bandai 中国官网（bandaihobbysite.cn）商品详情页主轮播直引的官方静态 CDN
  "staticcdn.bandaihobbysite.cn",
  "www.lego.com",
  "lego.com",
])

/** 官方商品页面域名白名单（Bandai/Bandai Hobby/P-Bandai/LEGO 官方站） */
const ALLOWED_OFFICIAL_PAGE_HOSTS = new Set([
  "bandai-hobby.net",
  "www.bandai-hobby.net",
  "manual.bandai-hobby.net",
  "global.bandai-hobby.net",
  "p-bandai.jp",
  "www.p-bandai.jp",
  "www.lego.com",
  "lego.com",
])

/** 页面域名校验（官网搜索候选验证用） */
export function officialPageHostCheck(url: string): { ok: true } | { ok: false; reason: string } {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, reason: "INVALID_URL" }
  }
  if (parsed.protocol !== "https:") return { ok: false, reason: "NOT_HTTPS" }
  if (!ALLOWED_OFFICIAL_PAGE_HOSTS.has(parsed.hostname.toLowerCase())) return { ok: false, reason: "NOT_OFFICIAL_HOST" }
  return { ok: true }
}

/** 明确禁止的第三方图床（历史脏数据来源；命中即拒绝并返回原因） */
const BANNED_IMAGE_HOST_PATTERNS = [/rebrickable\.com$/i, /hobbysearch\.(co\.jp|com)$/i, /1999\.co\.jp$/i, /amazonaws\.com$/i, /hlj\.com$/i, /amiami\.(com|jp)$/i, /aliyun\.com$/i]

export function officialImageHostCheck(url: string): { ok: true } | { ok: false; reason: string } {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, reason: "INVALID_URL" }
  }
  if (parsed.protocol !== "https:") return { ok: false, reason: "NOT_HTTPS" }
  const host = parsed.hostname.toLowerCase()
  if (BANNED_IMAGE_HOST_PATTERNS.some((p) => p.test(host))) return { ok: false, reason: "BANNED_THIRD_PARTY_HOST" }
  if (!ALLOWED_OFFICIAL_IMAGE_HOSTS.has(host)) return { ok: false, reason: "NOT_OFFICIAL_HOST" }
  return { ok: true }
}

export type SniffResult = "jpeg" | "png" | "webp" | "unknown"

/** 魔数探测：绝不信任 Content-Type 单独判断（HTML/403 页面也可能带错误头） */
export function sniffImageBytes(bytes: Uint8Array): SniffResult {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg"
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "webp"
  }
  return "unknown"
}

export interface OfficialImageResult {
  status: "OK" | "FAILED"
  url: string
  bytes: Uint8Array | null
  mime: string | null
  ext: string | null
  sha256: string | null
  width: number | null
  height: number | null
  reason: string | null
}

/**
 * 抓取并校验官网原图（只读网络；落盘由 cacheOfficialImage 负责）。
 * 任何校验失败返回 FAILED + 原因码，绝不抛出（调用方记 imageStatus）。
 */
export async function fetchOfficialImage(url: string): Promise<OfficialImageResult> {
  const host = officialImageHostCheck(url)
  if (!host.ok) {
    return { status: "FAILED", url, bytes: null, mime: null, ext: null, sha256: null, width: null, height: null, reason: host.reason }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "image/*" },
      signal: controller.signal,
      redirect: "follow",
    })
    if (res.status !== 200) {
      return { status: "FAILED", url, bytes: null, mime: null, ext: null, sha256: null, width: null, height: null, reason: `HTTP_${res.status}` }
    }
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase()
    if (!contentType.startsWith("image/")) {
      return { status: "FAILED", url, bytes: null, mime: null, ext: null, sha256: null, width: null, height: null, reason: `CONTENT_TYPE_${contentType || "EMPTY"}` }
    }
    const buf = Buffer.from(await res.arrayBuffer())
    const sniff = sniffImageBytes(buf)
    if (sniff === "unknown") {
      return { status: "FAILED", url, bytes: null, mime: null, ext: null, sha256: null, width: null, height: null, reason: "NOT_IMAGE_MAGIC_BYTES" }
    }
    if (buf.byteLength < OFFICIAL_IMAGE_MIN_BYTES) {
      return { status: "FAILED", url, bytes: null, mime: null, ext: null, sha256: null, width: null, height: null, reason: "TOO_SMALL" }
    }
    if (buf.byteLength > OFFICIAL_IMAGE_MAX_BYTES) {
      return { status: "FAILED", url, bytes: null, mime: null, ext: null, sha256: null, width: null, height: null, reason: "TOO_LARGE" }
    }
    // 像素尺寸校验 + 方向转正元数据（不重编码）
    let width: number | null = null
    let height: number | null = null
    try {
      const meta = await sharp(buf).metadata()
      width = meta.width ?? null
      height = meta.height ?? null
    } catch {
      return { status: "FAILED", url, bytes: null, mime: null, ext: null, sha256: null, width: null, height: null, reason: "DECODE_FAILED" }
    }
    if (width == null || height == null || width < OFFICIAL_IMAGE_MIN_WIDTH || height < OFFICIAL_IMAGE_MIN_HEIGHT) {
      return { status: "FAILED", url, bytes: null, mime: null, ext: null, sha256: null, width, height, reason: "DIMENSION_TOO_SMALL" }
    }
    const sha256 = createHash("sha256").update(buf).digest("hex")
    return {
      status: "OK",
      url,
      bytes: buf,
      mime: sniff === "jpeg" ? "image/jpeg" : sniff === "png" ? "image/png" : "image/webp",
      ext: sniff === "jpeg" ? "jpg" : sniff === "png" ? "png" : "webp",
      sha256,
      width,
      height,
      reason: null,
    }
  } catch {
    return { status: "FAILED", url, bytes: null, mime: null, ext: null, sha256: null, width: null, height: null, reason: "NETWORK_ERROR" }
  } finally {
    clearTimeout(timer)
  }
}

/** 官网图缓存目录（gitignored；测试可覆盖） */
export function officialImagesDir(): string {
  return process.env.OFFICIAL_IMAGES_DIR
    ? path.resolve(process.env.OFFICIAL_IMAGES_DIR)
    : path.resolve(process.cwd(), "private-assets", "product-images")
}

/**
 * 缓存官网图（LOCAL 模式落盘；HOSTED 模式不落盘，返回 skipped）。
 * 写入 {productId}.{ext}；同 productId 旧扩展名文件被清理，保证一物一图。
 */
export function cacheOfficialImage(productId: string, image: OfficialImageResult): { fileName: string } | { skipped: true } {
  if (image.status !== "OK" || !image.bytes || !image.ext) throw new Error("只有校验 OK 的官网图才能缓存")
  if (isHostedRuntime()) return { skipped: true }
  const dir = officialImagesDir()
  mkdirSync(dir, { recursive: true })
  const fileName = `${productId}.${image.ext}`
  writeFileSync(path.join(dir, fileName), image.bytes)
  // 清掉其他扩展名的旧缓存（如 Rebrickable 时代的 .jpg 被 .png 取代）
  for (const old of ["jpg", "jpeg", "png", "webp"]) {
    if (old === image.ext) continue
    const oldPath = path.join(dir, `${productId}.${old}`)
    if (existsSync(oldPath)) rmSync(oldPath, { force: true })
  }
  return { fileName }
}
