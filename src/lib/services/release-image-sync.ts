import { legoOfficialImageUrl } from "../names/zh"
import type { PrismaClient } from "@prisma/client"
import { fetchOfficialImage, cacheOfficialImage, officialImagesDir } from "./official-image"
import { existsSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import { isHostedRuntime } from "../db-mode"

/**
 * 新品官方主图解析与补全（release-image-sync）：
 * - LEGO：按套装编号生成官方 CDN 标准地址（lego.com/cdn）——不让大模型猜图片地址；
 * - Bandai：请求已校验的 bandaihobbysite.cn 商品详情页，从主轮播容器
 *   （.pg-products__sliderMain）第一张 <img> 提取；只接受 exact host
 *   staticcdn.bandaihobbysite.cn、HTTPS、无用户名密码、无自定义端口——
 *   不取页面第一张图（那是 Logo），不从推荐商品/页脚/第三方页面取图；
 * - 页面请求带超时/状态码/Content-Type/体积上限；图片字节继续走
 *   fetchOfficialImage（HTTP 200 + image/* + 魔数 + 字节数 + 像素尺寸）+ SHA 校验；
 * - HOSTED 不落盘（保持降级：不下载，状态不伪装）。
 */

const PAGE_TIMEOUT_MS = 20_000
const PAGE_MAX_BYTES = 5 * 1024 * 1024
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 ModelBaseReleaseImage/1.0"

/** Bandai 中国官网详情页域名（已在 release-discovery 校验为官方） */
const BANDAI_CN_PAGE_HOST = "www.bandaihobbysite.cn"
/** Bandai 中国官网主轮播图片唯一允许的 CDN host（exact） */
export const BANDAI_CN_IMAGE_HOST = "staticcdn.bandaihobbysite.cn"

export interface MainImageResolution {
  status: "RESOLVED" | "FAILED"
  imageUrl: string | null
  reason: string | null
}

/** 校验 Bandai 中国官网图片 URL：HTTPS + exact host + 无凭据 + 无端口 */
export function isValidBandaiCnImageUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.port &&
    url.hostname.toLowerCase() === BANDAI_CN_IMAGE_HOST
  )
}

/**
 * 从 Bandai 中国官网详情页 HTML 提取主轮播首图（纯函数：单测覆盖真实页面快照）。
 * 只认 .pg-products__sliderMain 容器内第一个 swiper-slide 的 <img src>；
 * 页面第一张图（Logo 等）不在该容器内，天然排除。
 */
export function extractBandaiCnMainImage(html: string): string | null {
  const containerIdx = html.indexOf("pg-products__sliderMain")
  if (containerIdx < 0) return null
  // 容器范围：到主轮播结束（下一个 sliderThumb 或容器关闭前 8KB 足够覆盖首图）
  const scope = html.slice(containerIdx, containerIdx + 8000)
  const firstImg = scope.match(/<img\s[^>]*?src="(https:\/\/[^"]+)"[^>]*>/i)
  if (!firstImg) return null
  const url = firstImg[1]!
  return isValidBandaiCnImageUrl(url) ? url : null
}

/** 请求商品详情页并解析主图（带超时/状态码/Content-Type/体积上限） */
async function resolveBandaiCnMainImage(officialPageUrl: string): Promise<MainImageResolution> {
  let pageUrl: URL
  try {
    pageUrl = new URL(officialPageUrl)
  } catch {
    return { status: "FAILED", imageUrl: null, reason: "INVALID_PAGE_URL" }
  }
  if (pageUrl.hostname.toLowerCase() !== BANDAI_CN_PAGE_HOST) {
    return { status: "FAILED", imageUrl: null, reason: "NOT_BANDAI_CN_PAGE" }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS)
  try {
    const res = await fetch(pageUrl.toString(), {
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      signal: controller.signal,
      redirect: "follow",
    })
    if (res.status !== 200) {
      return { status: "FAILED", imageUrl: null, reason: `PAGE_HTTP_${res.status}` }
    }
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase()
    if (!contentType.includes("html") && !contentType.includes("text")) {
      return { status: "FAILED", imageUrl: null, reason: `PAGE_CONTENT_TYPE_${contentType || "EMPTY"}` }
    }
    const declaredLength = Number(res.headers.get("content-length") ?? "0")
    if (declaredLength > PAGE_MAX_BYTES) {
      return { status: "FAILED", imageUrl: null, reason: "PAGE_TOO_LARGE" }
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > PAGE_MAX_BYTES) {
      return { status: "FAILED", imageUrl: null, reason: "PAGE_TOO_LARGE" }
    }
    const imageUrl = extractBandaiCnMainImage(buf.toString("utf-8"))
    if (!imageUrl) {
      return { status: "FAILED", imageUrl: null, reason: "MAIN_IMAGE_NOT_FOUND" }
    }
    return { status: "RESOLVED", imageUrl, reason: null }
  } catch {
    return { status: "FAILED", imageUrl: null, reason: "PAGE_NETWORK_ERROR" }
  } finally {
    clearTimeout(timer)
  }
}

/** LEGO 主图：按套装编号生成官方 CDN 地址（无需请求页面） */
export function resolveLegoMainImage(setNumber: string): MainImageResolution {
  const set = setNumber.replace(/[^0-9]/g, "")
  if (!/^\d{4,7}$/.test(set)) {
    return { status: "FAILED", imageUrl: null, reason: "INVALID_SET_NUMBER" }
  }
  return { status: "RESOLVED", imageUrl: legoOfficialImageUrl(set), reason: null }
}

/**
 * 解析单个 CatalogProduct 的官方主图 URL（不下载）。
 * 已有 officialImageUrl 的直接复用（不重复解析）。
 */
export async function resolveReleaseMainImage(product: {
  brand: string
  modelNumber: string | null
  officialPageUrl: string | null
  officialImageUrl: string | null
}): Promise<MainImageResolution> {
  if (product.officialImageUrl) {
    return { status: "RESOLVED", imageUrl: product.officialImageUrl, reason: null }
  }
  if (product.brand === "LEGO") {
    if (!product.modelNumber) return { status: "FAILED", imageUrl: null, reason: "NO_SET_NUMBER" }
    return resolveLegoMainImage(product.modelNumber)
  }
  if (product.brand === "Bandai") {
    if (!product.officialPageUrl) return { status: "FAILED", imageUrl: null, reason: "NO_PAGE_URL" }
    return resolveBandaiCnMainImage(product.officialPageUrl)
  }
  return { status: "FAILED", imageUrl: null, reason: "UNSUPPORTED_BRAND" }
}

export interface ReleaseImageSyncResult {
  productId: string
  status: "OK" | "SKIPPED_OK" | "FAILED"
  reason: string | null
  imageUrl: string | null
}

/** 缓存 SHA 一致性检查（有效旧缓存跳过下载） */
function cacheShaMatches(cacheFile: string | null, expectedSha: string | null): boolean {
  if (!cacheFile || !expectedSha) return false
  const filePath = path.join(officialImagesDir(), cacheFile)
  if (!filePath.startsWith(officialImagesDir() + path.sep) || !existsSync(filePath)) return false
  try {
    const sha = createHash("sha256").update(readFileSync(filePath)).digest("hex")
    return sha === expectedSha
  } catch {
    return false
  }
}

/**
 * 为单个商品下载并缓存官方主图（元数据落库；远程请求在调用方——事务外执行）。
 * 成功：officialImageUrl/imageSourcePage/imageSourceUrl/imageCacheFile/imageSha256/
 *       imageFetchedAt/rightsBasis=personal-use/imageStatus=OK；
 * 失败：imageStatus=FAILED（不动旧缓存，绝不伪装 OK）；
 * 已 OK 且缓存 SHA 有效：跳过下载。
 */
export async function syncReleaseImage(
  db: PrismaClient,
  product: {
    id: string
    brand: string
    modelNumber: string | null
    officialPageUrl: string | null
    officialImageUrl: string | null
    imageStatus: string | null
    imageCacheFile: string | null
    imageSha256: string | null
  },
): Promise<ReleaseImageSyncResult> {
  if (product.imageStatus === "OK" && cacheShaMatches(product.imageCacheFile, product.imageSha256)) {
    return { productId: product.id, status: "SKIPPED_OK", reason: null, imageUrl: product.officialImageUrl }
  }
  // HOSTED：不落盘不下载（保持现有降级；状态保持原样，不伪装）
  if (isHostedRuntime()) {
    return { productId: product.id, status: "FAILED", reason: "HOSTED_NO_DOWNLOAD", imageUrl: null }
  }
  const resolved = await resolveReleaseMainImage(product)
  if (resolved.status !== "RESOLVED" || !resolved.imageUrl) {
    await db.catalogProduct.update({ where: { id: product.id }, data: { imageStatus: "FAILED" } })
    return { productId: product.id, status: "FAILED", reason: resolved.reason, imageUrl: null }
  }
  const image = await fetchOfficialImage(resolved.imageUrl)
  if (image.status !== "OK") {
    // 失败：状态如实 FAILED；不清除上次有效缓存字段
    await db.catalogProduct.update({ where: { id: product.id }, data: { imageStatus: "FAILED" } })
    return { productId: product.id, status: "FAILED", reason: image.reason, imageUrl: null }
  }
  const cached = cacheOfficialImage(product.id, image)
  await db.catalogProduct.update({
    where: { id: product.id },
    data: {
      officialImageUrl: resolved.imageUrl,
      imageSourcePage: product.officialPageUrl,
      imageSourceUrl: resolved.imageUrl,
      imageCacheFile: "skipped" in cached ? product.imageCacheFile : cached.fileName,
      imageSha256: image.sha256,
      imageFetchedAt: new Date(),
      rightsBasis: "personal-use",
      imageStatus: "OK",
    },
  })
  return { productId: product.id, status: "OK", reason: null, imageUrl: resolved.imageUrl }
}

/**
 * 扫描近期公布和未来发售窗口内 ReleaseEvent 关联商品中 PENDING/null 图片并补全；
 * 每次刷新新品时调用（即使 24h 缓存期内也执行——修复历史 PENDING 数据）。
 * 逐商品限速，远程请求全部在数据库事务之外。
 */
export async function backfillReleaseImages(
  db: PrismaClient,
  options: { windowDays?: number; futureDays?: number; now?: Date; limit?: number } = {},
): Promise<ReleaseImageSyncResult[]> {
  const now = options.now ?? new Date()
  const windowDays = options.windowDays ?? 90
  const futureDays = options.futureDays ?? 180
  const limit = options.limit ?? 40
  const since = new Date(now.getTime() - windowDays * 24 * 3600_000)
  const until = new Date(now.getTime() + futureDays * 24 * 3600_000)

  const products = await db.catalogProduct.findMany({
    where: {
      releaseEvents: { some: { announcedAt: { gte: since, lte: until } } },
      // OK 行也会被扫到：syncReleaseImage 内部按缓存 SHA 有效性跳过（缓存丢失的 OK 重下）
      OR: [{ imageStatus: null }, { imageStatus: "PENDING" }, { imageStatus: "FAILED" }, { imageStatus: "OK" }],
      brand: { in: ["LEGO", "Bandai"] },
    },
    orderBy: { id: "asc" },
    take: limit,
  })

  const results: ReleaseImageSyncResult[] = []
  for (const product of products) {
    // FAILED 也重试（页面/网络曾不可达；上次有效缓存如仍存在由 cacheSha 判定跳过）
    results.push(await syncReleaseImage(db, product))
  }
  return results
}
