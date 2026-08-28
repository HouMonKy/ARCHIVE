import type { PrismaClient, CollectionAsset, CatalogProduct, AssetCover } from "@prisma/client"
import { AppError } from "../errors"
import { demoNow } from "../clock"
import { isUniqueConstraintViolation } from "../db-errors"
import { bindCoverToAsset } from "./covers"
import { fetchOfficialImage, cacheOfficialImage, officialImageHostCheck } from "./official-image"
import { bandaiNameZh, legoThemeLabel, normalizeLegoOfficialPageUrl } from "../names/zh"
import { legoCanonicalNamePolicy, legoDisplayName, isGenericLegoPlaceholderName } from "../names/lego-naming"
import {
  assertBuildProgress,
  confirmAssetSchema,
  parseIsoDateToUtc,
  updateAssetSchema,
  type BuildState,
  type ConfirmAssetInput,
  type DispositionState,
  type OfficialCandidateInput,
  type UpdateAssetInput,
} from "../validation"

/**
 * 收藏实体服务：确认入库（幂等）、更新（状态约束）、查询。
 * 确认写入才设置 confirmedAt；任何识别结果都不会绕过用户确认。
 */

export interface AssetDTO {
  id: string
  displayName: string
  /** 原始日文/英文名（目录商品的官网原文名） */
  originalName: string | null
  /** 中文标准名（目录商品 nameZh） */
  nameZh: string | null
  catalogProductId: string | null
  customName: string | null
  customBrand: string | null
  brand: string
  grade: string | null
  line: string | null
  releaseYear: number | null
  modelNumber: string | null
  officialPageUrl: string | null
  /** 官网图抓取状态：OK 才在收藏柜展示官网目录图，否则回退上传照片 */
  catalogImageStatus: string | null
  dispositionState: DispositionState
  archivedAt: Date | null
  buildState: BuildState
  progress: number
  purchasePriceMinor: number | null
  currency: string | null
  purchasedAt: Date | null
  completedAt: Date | null
  note: string | null
  confirmedAt: Date
  lastActivityAt: Date
  recognitionCorrected: boolean | null
  /** 用户识别照片（详情页“我的识别照片”） */
  cover: { id: string; url: string } | null
}

/** 展示名：目录商品走品牌名称策略（LEGO 恒官网英文 canonicalName；Bandai 有效 nameZh 优先）；自定义实体用用户命名 */
export function assetDisplayName(asset: CollectionAsset & { product: CatalogProduct | null }): string {
  if (asset.product) {
    return legoDisplayName(asset.product.brand, asset.product.canonicalName, asset.product.nameZh, asset.product.modelNumber)
  }
  return asset.customName ?? "未命名实体"
}

/**
 * 柜格封面来源（官网资料闭环）：官网目录图（imageStatus=OK）优先；
 * 官网图失败/未抓取时回退用户上传照片；再回退占位图。
 * display=true：收藏柜与详情页主图使用展示衍生图（仅裁外围白边；不可用时路由自动回退原图）；
 * display=false：需要保留官网原图画布时使用。
 */
export function assetCoverSrc(asset: AssetDTO, options: { display?: boolean } = {}): string {
  const suffix = options.display ? "?display=1" : ""
  if (asset.catalogProductId && asset.catalogImageStatus === "OK") {
    return `/api/demo-images/${asset.catalogProductId}${suffix}`
  }
  if (asset.cover?.url) return asset.cover.url
  if (asset.catalogProductId) return `/api/demo-images/${asset.catalogProductId}${suffix}`
  return "/demo/fallback.svg"
}

/** 是否已有校验通过的官网目录图（详情页主图与“我的识别照片”分区依据） */
export function hasOfficialCatalogImage(asset: AssetDTO): boolean {
  return Boolean(asset.catalogProductId && asset.catalogImageStatus === "OK")
}

export function toAssetDTO(
  asset: CollectionAsset & { product: CatalogProduct | null; cover?: AssetCover | null },
): AssetDTO {
  return {
    id: asset.id,
    displayName: assetDisplayName(asset),
    originalName: asset.product?.canonicalName ?? null,
    nameZh: asset.product?.nameZh ?? null,
    catalogProductId: asset.catalogProductId,
    customName: asset.customName,
    customBrand: asset.customBrand,
    brand: asset.product?.brand ?? asset.customBrand ?? "其他",
    grade: asset.product?.grade ?? null,
    line: asset.product?.line ?? null,
    releaseYear: asset.product?.releaseYear ?? null,
    modelNumber: asset.product?.modelNumber ?? null,
    officialPageUrl: asset.product?.officialPageUrl ?? null,
    catalogImageStatus: asset.product?.imageStatus ?? null,
    dispositionState: asset.dispositionState as DispositionState,
    archivedAt: asset.archivedAt,
    buildState: asset.buildState as BuildState,
    progress: asset.progress,
    purchasePriceMinor: asset.purchasePriceMinor,
    currency: asset.currency,
    purchasedAt: asset.purchasedAt,
    completedAt: asset.completedAt,
    note: asset.note,
    confirmedAt: asset.confirmedAt,
    lastActivityAt: asset.lastActivityAt,
    recognitionCorrected: asset.recognitionCorrected,
    cover: asset.cover ? { id: asset.cover.id, url: `/api/covers/${asset.cover.id}` } : null,
  }
}

export interface ConfirmAssetResult {
  asset: AssetDTO
  created: boolean
}

/**
 * 官网候选确认入库（识别主链路重构）：
 * - 唯一标识：官方页面 ID（key）；官方产品编号精确去重（已存在同品番商品则复用该行）；
 * - 页面域名为软校验：本函数只在用户显式点击「确认」后调用——用户确认即放行
 *   （非官方页面也可录入，页面 URL 如实记录；官方域名列表不再硬拦截）；
 * - 官方商品图仍只接受官方图片域（Bandai/Bandai Hobby/LEGO 官方 CDN）：非官方图
 *   不作官方声明（imageStatus=FAILED，收藏柜回退用户实拍图），官方图下载校验
 *   （200+image/*+魔数+尺寸）缓存并设为收藏封面；
 * - 用户上传照片只作为实拍图绑定（详情页「我的识别照片」），绝不冒充官网封面；
 * - E2E/测试模式不联网（图片状态如实记 FAILED，柜格回退实拍图）。
 * 返回 catalogProductId。
 */
export async function upsertSearchedOfficialProduct(
  db: PrismaClient,
  candidate: OfficialCandidateInput,
): Promise<string> {
  // URL 形态校验（schema 已校验；防服务层直调传坏值）
  try {
    new URL(candidate.pageUrl)
  } catch {
    throw new AppError("官网候选页面 URL 不合法", { status: 422, code: "INVALID_INPUT" })
  }
  // 图片域名为硬校验：非官方图片域的 URL 不作为官网图来源（不下载、不声明）；
  // 页面域名不拦截——用户已确认（见函数注释）
  const imageUrlOfficial = candidate.imageUrl && officialImageHostCheck(candidate.imageUrl).ok ? candidate.imageUrl : null

  const brand = candidate.brand.toLowerCase() === "lego" ? "LEGO" : "Bandai"
  // 官方产品编号精确去重：同品番复用既有目录行（唯一标识优先级：页面 ID → 品番）
  let existing = await db.catalogProduct.findUnique({ where: { id: candidate.key } })
  if (!existing && candidate.productCode) {
    existing = await db.catalogProduct.findFirst({ where: { officialProductCode: candidate.productCode } })
  }

  const productId = existing?.id ?? candidate.key
  const isLego = brand === "LEGO"
  // LEGO 名称策略（R9）：nameZh/nameZhSource 恒 null（丢弃 AI/历史值）；
  // Bandai 原逻辑：候选中文名 → 既有中文名 → 词典
  const nameZh = isLego
    ? null
    : candidate.nameZh?.trim() || existing?.nameZh || bandaiNameZh(candidate.officialName)

  // 收藏地图改造：不再把 LEGO 硬编码为 Technic/SUPERCAR——series 保存 Kimi 提取的真实主题，
  // category 按品牌事实记录，line 仅在候选提供时使用
  const series = candidate.series?.trim() || null
  const legoTheme = brand === "LEGO" ? legoThemeLabel(series, candidate.grade) : null
  const officialPageUrl = brand === "LEGO"
    ? (normalizeLegoOfficialPageUrl(candidate.pageUrl, candidate.modelNumber ?? candidate.productCode ?? "") ?? candidate.pageUrl)
    : candidate.pageUrl
  const setNumberForPlaceholder = candidate.modelNumber ?? candidate.productCode ?? ""
  const isLegacyLegoName = existing?.canonicalName != null && isGenericLegoPlaceholderName(existing.canonicalName, setNumberForPlaceholder)
  const legoCanonicalName = isLego
    ? legoCanonicalNamePolicy(candidate.officialName, candidate.nameZh, setNumberForPlaceholder).canonicalName
    : candidate.officialName
  const normalizedExistingLegoName = isLego && existing
    ? legoCanonicalNamePolicy(existing.canonicalName, null, existing.modelNumber ?? setNumberForPlaceholder).canonicalName
    : existing?.canonicalName
  const product = await db.catalogProduct.upsert({
    where: { id: productId },
    create: {
      id: productId,
      brand,
      category: brand,
      line: brand === "LEGO" ? (legoTheme === "TECHNIC" ? candidate.line ?? null : null) : candidate.line ?? null,
      grade: legoTheme ?? candidate.grade ?? "OTHER",
      series,
      canonicalName: legoCanonicalName,
      nameZh,
      nameZhSource: nameZh ? "dict:bandai-official-ja" : null,
      modelNumber: candidate.modelNumber ?? null,
      scale: candidate.scale ?? null,
      officialProductCode: candidate.productCode ?? null,
      officialPageUrl,
      officialImageUrl: imageUrlOfficial,
      releaseYear: candidate.releaseYear ?? null,
      source: officialPageUrl,
      catalogVersion: "official-v1",
      // 提供了图片：官方域 → 待下载校验；非官方域 → 如实 FAILED（不作官方声明）
      imageStatus: candidate.imageUrl ? (imageUrlOfficial ? "PENDING" : "FAILED") : null,
      imageSourcePage: officialPageUrl,
      imageSourceUrl: imageUrlOfficial,
    },
    update: {
      // 幂等补齐：不回退已有事实（series 只补空）。
      // LEGO：canonicalName 更新为已验证官网英文（候选名来自官网元数据流程）；
      //       占位旧名（isLegacyLegoName 泛化为占位判定）也替换。Bandai：meaningful 旧名保留。
      canonicalName: isLego
        ? (!existing || isLegacyLegoName ? legoCanonicalName : normalizedExistingLegoName!)
        : (!existing || isLegacyLegoName ? candidate.officialName : existing.canonicalName),
      // LEGO：nameZh/nameZhSource 恒 null（清历史中文名）；Bandai：保留既有
      nameZh: isLego ? null : (existing?.nameZh ?? nameZh),
      nameZhSource: isLego ? null : (existing?.nameZhSource ?? (nameZh ? "dict:bandai-official-ja" : null)),
      category: brand === "LEGO" ? "LEGO" : existing?.category,
      line: brand === "LEGO" && legoTheme !== "TECHNIC" ? null : (existing?.line ?? candidate.line ?? null),
      grade: legoTheme ?? existing?.grade ?? candidate.grade ?? "OTHER",
      series: series ?? existing?.series ?? null,
      modelNumber: existing?.modelNumber ?? candidate.modelNumber ?? null,
      scale: existing?.scale ?? candidate.scale ?? null,
      officialProductCode: existing?.officialProductCode ?? candidate.productCode ?? null,
      officialPageUrl: brand === "LEGO" ? officialPageUrl : (existing?.officialPageUrl ?? candidate.pageUrl),
      officialImageUrl: imageUrlOfficial ?? existing?.officialImageUrl ?? null,
      releaseYear: existing?.releaseYear ?? candidate.releaseYear ?? null,
      imageSourcePage: brand === "LEGO" ? officialPageUrl : (existing?.imageSourcePage ?? candidate.pageUrl),
      imageSourceUrl: imageUrlOfficial ?? existing?.imageSourceUrl ?? null,
    },
  })

  // 已有校验缓存 → 跳过下载（官方图片允许缓存复用）
  const cacheOk = product.imageStatus === "OK" && product.imageCacheFile && product.imageSha256
  if (!cacheOk && product.officialImageUrl && process.env.E2E_MODE !== "1") {
    const image = await fetchOfficialImage(product.officialImageUrl)
    if (image.status === "OK") {
      const cached = cacheOfficialImage(product.id, image)
      await db.catalogProduct.update({
        where: { id: product.id },
        data: {
          imageStatus: "OK",
          imageCacheFile: "skipped" in cached ? product.imageCacheFile : cached.fileName,
          imageSha256: image.sha256,
          imageFetchedAt: new Date(),
          rightsBasis: "personal-use",
          imageSourceUrl: product.officialImageUrl,
        },
      })
    } else {
      await db.catalogProduct.update({ where: { id: product.id }, data: { imageStatus: "FAILED" } })
    }
  }
  return product.id
}


export async function confirmAsset(
  db: PrismaClient,
  userId: string,
  rawInput: unknown,
): Promise<ConfirmAssetResult> {
  const parsed = confirmAssetSchema.safeParse(rawInput)
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? "参数不合法", { status: 422, code: "INVALID_INPUT" })
  }
  const input: ConfirmAssetInput = parsed.data
  const now = demoNow()

  // 幂等确认：同一 idempotency key 只创建一件实体（重复提交/重试安全）
  const existing = await db.collectionAsset.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { product: true, cover: true } })
  if (existing) {
    if (existing.userId !== userId) throw new AppError("无权访问该记录", { status: 403, code: "FORBIDDEN" })
    return { asset: toAssetDTO(existing), created: false }
  }

  assertBuildProgress(input.buildState, input.progress)

  // 识别主链路重构后的语义：无自动 Top-1 推荐——用户显式选择候选=未修正；
  // 未选候选而按编辑结果建立自定义收藏=用户修正了识别结果
  const recognitionCorrected: boolean | null = input.custom != null ? true : null
  let job: { id: string; userId: string; resultJson: string | null } | null = null
  if (input.jobId) {
    job = await db.recognitionJob.findUnique({ where: { id: input.jobId } })
    if (!job || job.userId !== userId) {
      throw new AppError("识别任务不存在或已失效，请重新上传", { status: 404, code: "JOB_NOT_FOUND" })
    }
    const linked = await db.collectionAsset.findUnique({ where: { recognitionJobId: job.id } })
    if (linked) {
      const dto = toAssetDTO(await db.collectionAsset.findUniqueOrThrow({ where: { id: linked.id }, include: { product: true, cover: true } }))
      return { asset: dto, created: false }
    }
  }

  // —— 官网候选确认：按官方页面 ID/产品编号精确建档（唯一标识），下载官网图设为收藏封面 —— //
  let officialProductId: string | null = input.productId ?? null
  if (input.officialCandidate) {
    officialProductId = await upsertSearchedOfficialProduct(db, input.officialCandidate)
  } else if (input.productId) {
    const product = await db.catalogProduct.findUnique({ where: { id: input.productId } })
    if (!product) throw new AppError("目录中不存在该商品", { status: 404, code: "PRODUCT_NOT_FOUND" })
  }

  // 封面归属预校验（确认创建后绑定；他人/失效封面不得阻断建档——忽略即可）
  if (input.coverId) {
    const cover = await db.assetCover.findUnique({ where: { id: input.coverId } })
    if (cover && cover.userId !== userId) {
      throw new AppError("无权访问该封面", { status: 403, code: "FORBIDDEN" })
    }
  }

  const completedAt = input.buildState === "COMPLETED" ? now : null

  let asset: CollectionAsset & { product: CatalogProduct | null }
  try {
    asset = await db.collectionAsset.create({
      data: {
        userId,
        catalogProductId: officialProductId,
        customName: input.custom?.name ?? null,
        customBrand: input.custom?.brand ?? null,
        recognitionJobId: job?.id ?? null,
        recognitionCorrected,
        dispositionState: input.dispositionState,
        buildState: input.buildState,
        progress: input.progress,
        purchasePriceMinor: input.purchasePriceMinor ?? null,
        currency: input.purchasePriceMinor != null ? "CNY" : null,
        purchasedAt: parseIsoDateToUtc(input.purchasedAt),
        completedAt,
        note: input.note ?? null,
        confirmedAt: now,
        lastActivityAt: now,
        idempotencyKey: input.idempotencyKey,
      },
      include: { product: true, cover: true },
    })
  } catch (e) {
    // 并发幂等：同 idempotencyKey（或同一识别任务）的另一请求已创建实体——
    // 唯一键竞争不得变成 500，重读已存在的实体并按幂等语义返回
    if (isUniqueConstraintViolation(e)) {
      const winner =
        (await db.collectionAsset.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { product: true, cover: true } })) ??
        (job
          ? await db.collectionAsset.findUnique({ where: { recognitionJobId: job.id }, include: { product: true, cover: true } })
          : null)
      if (winner && winner.userId === userId) {
        return { asset: toAssetDTO(winner), created: false }
      }
    }
    throw e
  }

  if (job) {
    await db.recognitionJob.update({ where: { id: job.id }, data: { state: "CONFIRMED", confirmedAt: now } })
  }

  // 上传照片绑定为实体默认封面（识别→确认后；幂等：重复绑定同一封面无害）
  if (input.coverId) {
    await bindCoverToAsset(db, userId, input.coverId, asset.id)
  }

  return { asset: toAssetDTO(asset), created: true }
}

export async function updateAsset(
  db: PrismaClient,
  userId: string,
  assetId: string,
  rawInput: unknown,
): Promise<AssetDTO> {
  const parsed = updateAssetSchema.safeParse(rawInput)
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? "参数不合法", { status: 422, code: "INVALID_INPUT" })
  }
  const input: UpdateAssetInput = parsed.data

  const asset = await db.collectionAsset.findUnique({ where: { id: assetId }, include: { product: true, cover: true } })
  if (!asset || asset.userId !== userId) throw new AppError("实体不存在", { status: 404, code: "ASSET_NOT_FOUND" })

  const nextBuildState = (input.buildState ?? asset.buildState) as BuildState
  const nextProgress = input.progress ?? asset.progress
  assertBuildProgress(nextBuildState, nextProgress)

  const now = demoNow()
  const buildChanged = nextBuildState !== asset.buildState || nextProgress !== asset.progress

  const data: Record<string, unknown> = {}
  if (input.dispositionState != null && input.dispositionState !== asset.dispositionState) {
    data.dispositionState = input.dispositionState
  }
  if (input.archived != null) {
    data.archivedAt = input.archived ? now : null
  }
  if (input.buildState != null && input.buildState !== asset.buildState) {
    data.buildState = input.buildState
  }
  if (input.progress != null && input.progress !== asset.progress) {
    data.progress = input.progress
  }
  if (input.purchasePriceMinor !== undefined) {
    data.purchasePriceMinor = input.purchasePriceMinor
    data.currency = input.purchasePriceMinor != null ? "CNY" : null
  }
  if (input.purchasedAt !== undefined) {
    data.purchasedAt = parseIsoDateToUtc(input.purchasedAt)
  }
  if (input.note !== undefined) {
    data.note = input.note
  }
  if (nextBuildState === "COMPLETED" && (input.buildState != null || input.progress != null)) {
    data.completedAt = asset.completedAt ?? now
  }
  if (buildChanged) {
    data.lastActivityAt = now
  }
  if (Object.keys(data).length === 0) {
    return toAssetDTO(asset)
  }

  const updated = await db.collectionAsset.update({ where: { id: assetId }, data, include: { product: true, cover: true } })
  return toAssetDTO(updated)
}

export async function getAsset(db: PrismaClient, userId: string, assetId: string): Promise<AssetDTO> {
  const asset = await db.collectionAsset.findUnique({ where: { id: assetId }, include: { product: true, cover: true } })
  if (!asset || asset.userId !== userId) throw new AppError("实体不存在", { status: 404, code: "ASSET_NOT_FOUND" })
  return toAssetDTO(asset)
}

export interface AssetListFilters {
  q?: string
  status?: string
  brand?: string
  grade?: string
  line?: string
  disposition?: string
  product?: string
  archived?: "include" | "exclude" | "only"
  sort?: "purchase" | "recent" | "price" | "name"
}

const ASSET_NAME_COLLATOR = new Intl.Collator("zh-CN-u-co-pinyin", {
  sensitivity: "base",
  numeric: true,
})

function compareAssetNames(a: AssetDTO, b: AssetDTO): number {
  return ASSET_NAME_COLLATOR.compare(a.displayName, b.displayName) || a.id.localeCompare(b.id)
}

/**
 * 收藏柜稳定排序：默认购入日期新→旧；同一日期按展示名首字母/拼音排序；未填写日期放最后。
 * 其他显式排序同样以展示名作为稳定次序，避免刷新后同值项目随机跳动。
 */
export function sortAssetDTOs(
  assets: AssetDTO[],
  sort: NonNullable<AssetListFilters["sort"]> = "purchase",
): AssetDTO[] {
  return [...assets].sort((a, b) => {
    if (sort === "purchase") {
      const aTime = a.purchasedAt?.getTime() ?? null
      const bTime = b.purchasedAt?.getTime() ?? null
      if (aTime == null && bTime != null) return 1
      if (aTime != null && bTime == null) return -1
      if (aTime != null && bTime != null && aTime !== bTime) return bTime - aTime
      return compareAssetNames(a, b)
    }
    if (sort === "recent") {
      const timeOrder = b.lastActivityAt.getTime() - a.lastActivityAt.getTime()
      return timeOrder || compareAssetNames(a, b)
    }
    if (sort === "price") {
      if (a.purchasePriceMinor == null && b.purchasePriceMinor != null) return 1
      if (a.purchasePriceMinor != null && b.purchasePriceMinor == null) return -1
      const priceOrder = (b.purchasePriceMinor ?? 0) - (a.purchasePriceMinor ?? 0)
      return priceOrder || compareAssetNames(a, b)
    }
    return compareAssetNames(a, b)
  })
}

export async function listAssets(
  db: PrismaClient,
  userId: string,
  filters: AssetListFilters = {},
): Promise<AssetDTO[]> {
  const conditions: Record<string, unknown>[] = [{ userId }]
  if (filters.q) {
    conditions.push({
      OR: [{ customName: { contains: filters.q } }, { product: { canonicalName: { contains: filters.q } } }],
    })
  }
  if (filters.status) conditions.push({ buildState: filters.status })
  if (filters.brand) {
    conditions.push({ OR: [{ product: { brand: filters.brand } }, { customBrand: filters.brand }] })
  }
  if (filters.grade) {
    conditions.push(filters.grade === "其他" ? { product: null } : { product: { grade: filters.grade } })
  }
  if (filters.line) {
    conditions.push(filters.line === "自定义" ? { product: null } : { product: { line: filters.line } })
  }
  if (filters.product) conditions.push({ catalogProductId: filters.product })
  // 默认范围与 Dashboard 统计口径一致（当前收藏 = ACTIVE 未归档）；显式传 disposition（含 ALL）时按其过滤
  const disposition = filters.disposition ?? "ACTIVE"
  if (disposition !== "ALL") conditions.push({ dispositionState: disposition })
  const archived = filters.archived ?? "exclude"
  if (archived === "exclude") conditions.push({ archivedAt: null })
  else if (archived === "only") conditions.push({ archivedAt: { not: null } })
  const where = conditions.length === 1 ? conditions[0]! : { AND: conditions }

  const assets = await db.collectionAsset.findMany({
    where,
    orderBy: { id: "asc" },
    include: { product: true, cover: true },
  })
  return sortAssetDTOs(assets.map(toAssetDTO), filters.sort ?? "purchase")
}
