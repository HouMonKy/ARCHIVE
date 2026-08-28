import type { PrismaClient, CatalogProduct } from "@prisma/client"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { fetchOfficialImage, cacheOfficialImage, officialImagesDir } from "./official-image"
import type { OfficialProductDraft } from "./official-lookup"
import { legoCanonicalNamePolicy } from "../names/lego-naming"
import { OFFICIAL_CATALOG_VERSION } from "./catalog"

/**
 * 官方目录商品落库（官网资料闭环）：
 * - 幂等 upsert（同 id 只补空字段/更新官网资料，不动用户数据）；
 * - 官网图抓取：HTTP 200 + image/* + 魔数 + 尺寸校验通过才写 imageStatus=OK
 *   与缓存文件/SHA-256；失败记 FAILED + 原因（数据库不存原图字节）；
 * - HOSTED 模式不落盘（imageStatus 保持 PENDING，不阻断建档）。
 */

export interface UpsertOfficialProductResult {
  product: CatalogProduct
  imageStatus: "OK" | "FAILED" | "PENDING" | "SKIPPED_EXISTING"
  imageReason: string | null
}

/** 已有缓存且 SHA 一致时跳过重新下载（幂等：重跑不重复打官网） */
function existingCacheMatches(product: CatalogProduct): boolean {
  if (!product.imageCacheFile || !product.imageSha256 || product.imageStatus !== "OK") return false
  const filePath = path.join(officialImagesDir(), product.imageCacheFile)
  if (!filePath.startsWith(officialImagesDir() + path.sep) || !existsSync(filePath)) return false
  const sha = createHash("sha256").update(readFileSync(filePath)).digest("hex")
  return sha === product.imageSha256
}

export async function upsertOfficialProduct(
  db: PrismaClient,
  draft: OfficialProductDraft,
  options: { fetchImage?: boolean } = {},
): Promise<UpsertOfficialProductResult> {
  const fetchImage = options.fetchImage !== false
  const existing = await db.catalogProduct.findUnique({ where: { id: draft.id } })
  const isLego = draft.brand === "LEGO"
  // LEGO 名称策略（R9）：nameZh/nameZhSource 恒 null（即使 draft 带值也丢弃——上游已保证为 null）；
  // canonicalName 用官网英文标题口径写入（draft.canonicalName 由官网元数据流程产生）
  const namePolicy = isLego
    ? legoCanonicalNamePolicy(draft.canonicalName, draft.nameZh, draft.modelNumber)
    : { canonicalName: draft.canonicalName, nameZh: draft.nameZh, nameZhSource: draft.nameZhSource }

  let product = await db.catalogProduct.upsert({
    where: { id: draft.id },
    create: {
      id: draft.id,
      brand: draft.brand,
      category: draft.category,
      line: draft.line,
      grade: draft.grade,
      series: draft.series,
      canonicalName: namePolicy.canonicalName,
      nameZh: namePolicy.nameZh,
      modelNumber: draft.modelNumber,
      officialProductCode: draft.officialProductCode,
      nameZhSource: namePolicy.nameZhSource,
      officialPageUrl: draft.officialPageUrl,
      officialImageUrl: draft.officialImageUrl,
      releaseYear: draft.releaseYear,
      source: draft.source,
      catalogVersion: OFFICIAL_CATALOG_VERSION,
      imageStatus: draft.officialImageUrl ? "PENDING" : null,
    },
    update: {
      // 用户核对后的 LEGO 主题可修正历史 TECHNIC/SUPERCAR 误标；Bandai 仍只补空字段。
      category: isLego ? "LEGO" : existing?.category,
      line: isLego ? draft.line : (existing?.line ?? draft.line),
      grade: isLego ? draft.grade : (existing?.grade ?? draft.grade),
      series: draft.series ?? existing?.series ?? null,
      // LEGO：nameZh/nameZhSource 恒 null（清历史值）；canonicalName 只被已验证官网标题更新
      //（draft.canonicalName 即官网口径——占位名不会被传入，回填/识别路径已过滤）
      canonicalName: isLego ? namePolicy.canonicalName : (existing?.canonicalName ?? draft.canonicalName),
      nameZh: isLego ? null : (existing?.nameZh ?? draft.nameZh),
      nameZhSource: isLego ? null : (existing?.nameZhSource ?? draft.nameZhSource),
      modelNumber: existing?.modelNumber ?? draft.modelNumber,
      officialProductCode: existing?.officialProductCode ?? draft.officialProductCode,
      officialPageUrl: isLego ? draft.officialPageUrl : (existing?.officialPageUrl ?? draft.officialPageUrl),
      officialImageUrl: draft.officialImageUrl ?? existing?.officialImageUrl ?? null,
      releaseYear: existing?.releaseYear ?? draft.releaseYear,
    },
  })

  if (!fetchImage) {
    return { product, imageStatus: (product.imageStatus as "OK" | "FAILED" | "PENDING" | null) ?? "PENDING", imageReason: null }
  }

  // 官网图：已缓存且 SHA 一致 → 跳过
  if (existingCacheMatches(product)) {
    return { product, imageStatus: "SKIPPED_EXISTING", imageReason: null }
  }

  const imageUrl = product.officialImageUrl
  if (!imageUrl) {
    if (product.imageStatus == null || product.imageStatus === "PENDING") {
      product = await db.catalogProduct.update({
        where: { id: product.id },
        data: { imageStatus: "FAILED" },
      })
    }
    return { product, imageStatus: "FAILED", imageReason: "NO_OFFICIAL_IMAGE_URL" }
  }

  const image = await fetchOfficialImage(imageUrl)
  if (image.status !== "OK") {
    product = await db.catalogProduct.update({
      where: { id: product.id },
      data: { imageStatus: "FAILED" },
    })
    return { product, imageStatus: "FAILED", imageReason: image.reason }
  }

  const cached = cacheOfficialImage(product.id, image)
  product = await db.catalogProduct.update({
    where: { id: product.id },
    data: {
      imageStatus: "OK",
      imageCacheFile: "skipped" in cached ? product.imageCacheFile : cached.fileName,
      imageSha256: image.sha256,
      imageFetchedAt: new Date(),
      rightsBasis: "personal-use",
      // 官网原图 URL 以实际校验通过的地址为准
      imageSourceUrl: imageUrl,
      imageSourcePage: product.officialPageUrl ?? product.imageSourcePage,
    },
  })
  return { product, imageStatus: "OK", imageReason: null }
}
