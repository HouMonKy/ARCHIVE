import type { PrismaClient, AssetCover } from "@prisma/client"
import { AppError } from "../errors"
import { getRecognitionProvider, resolveVisionRecognitionProvider, getRecognitionMode } from "../ai/provider"
import { getKnownDemoSampleHashes } from "../ai/fixture"
import { getMonthlyBudgetStatus, recordAiUsage } from "../ai/usage"
import { validateUploadFile, type UploadFileInput } from "../validation"
import { storePendingCover, sweepPendingCovers, toCoverDTO } from "./covers"
import { processUserImage, normalizeUserRotation } from "../image-process"
import { searchOfficialProducts, type SearchExtractionInput, type VerifiedOfficialCandidate } from "./official-search"
import { resolveRecognitionConfig } from "./ai-settings"
import { demoNow } from "../clock"
import type { VisionRecognitionProvider } from "../ai/kimi"

/**
 * 识别任务服务（识别主链路重构）：
 * 上传校验 → 照片处理（EXIF 修正/压缩/封面存储）→ Kimi 视觉识别（结构化提取）
 * → Kimi $web_search 官网搜索 + 候选逐条验证 → 审计落库。确认之前绝不写 CollectionAsset。
 *
 * 边界（任务书）：
 * - 本地目录模糊匹配（matchCatalogTop3/置信度阈值自动命中）已从识别主链路移除：
 *   Kimi 原始提取结果原样返回给用户核对编辑，绝不被目录覆盖；
 * - 官网候选 = Kimi 联网搜索 + 页面真实抓取验证（仅官方域名）；
 *   本地目录只允许官方页面 ID 精确缓存读取 / 官方产品编号与 LEGO Set Number 精确去重；
 * - 不同图片必须重新调用 Kimi（识别结果不跨图片缓存；只有官网图片与官方元数据可缓存）。
 *
 * 照片处理：栅格图先经 EXIF 方向修正 + 用户旋转 + 压缩再存待确认封面；
 * Kimi 收到的是处理后的图。SVG 仅存在于 E2E 演示样例（不处理）。
 */

/** 官网候选来源：联网搜索验证 / LEGO 编号精确键 / Provider（E2E 演示候选） */
export type CandidateOrigin = "web_search" | "lego_set_exact" | "provider"

export interface ExtractionDTO {
  brand: string
  name: string
  series: string
  grade: string
  scale: string
  modelNumber: string
}

export interface CandidateDTO {
  /** 官网候选唯一标识（官方页面 ID/产品编号派生；确认入库用）。Provider 候选为 null */
  key: string | null
  /** Provider（演示/HTTP 适配器）候选引用的目录商品 id */
  productId: string | null
  origin: CandidateOrigin
  /** 展示名（官网候选为页面实际标题；Provider 候选为目录商品名） */
  officialName: string
  nameZh: string | null
  productCode: string | null
  pageUrl: string | null
  imageUrl: string | null
  sourceDomain: string | null
  snippet: string | null
  brand: string
  grade: string | null
  scale: string | null
  modelNumber: string | null
  series: string | null
  releaseYear: number | null
  line: string | null
  /** Provider 候选的置信度（官网候选无自动置信推荐） */
  confidence: number | null
  confidencePercent: string | null
  fieldConfidences: Record<string, number> | null
  uncertainFields: string[]
  /** 已拥有同款数量（重复提示，FR-04；精确键查询，非模糊匹配） */
  ownedCount: number
}

export interface RecognitionJobDTO {
  jobId: string
  state: "SUCCEEDED" | "FAILED"
  provider: string
  providerVersion: string
  isFixture: boolean
  demoMode: boolean
  /** Kimi 原始结构化识别结果（原样可见、可编辑；绝不被目录覆盖） */
  extraction: ExtractionDTO | null
  /** 官网搜索验证候选 / Provider 演示候选 */
  candidates: CandidateDTO[]
  searchQueries: string[]
  /** 官网搜索状态：OK | FAILED | SKIPPED（E2E/无 Key） */
  searchState: "OK" | "FAILED" | "SKIPPED" | null
  searchMessage: string | null
  /** 中文名默认值（编辑表单预填） */
  nameZhDefault: string | null
  /** 本次识别上传的封面（HOSTED/演示样例为 null） */
  cover: { id: string; url: string } | null
  errorCode: string | null
  message: string
}

interface PersistedResult {
  candidates: CandidateDTO[]
  searchQueries: string[]
  searchState: "OK" | "FAILED" | "SKIPPED" | null
  searchMessage: string | null
  nameZhDefault: string | null
}

const FIELD_LABELS: Record<string, string> = {
  name: "商品名",
  grade: "等级",
  line: "系列",
  releaseYear: "发售年",
}

const CONFIDENCE_FLOOR = 0.6

export function uncertainFieldLabels(fieldConfidences: Record<string, number> | null | undefined): string[] {
  if (!fieldConfidences) return []
  return Object.entries(fieldConfidences)
    .filter(([, v]) => v < CONFIDENCE_FLOOR)
    .map(([k]) => FIELD_LABELS[k] ?? k)
}

export async function createRecognitionJob(
  db: PrismaClient,
  userId: string,
  file: UploadFileInput,
  options: { role?: "OWNER" | "DEMO"; userRotation?: unknown } = {},
): Promise<RecognitionJobDTO> {
  const role = options.role ?? "OWNER"
  const startedAt = Date.now()
  const validation = validateUploadFile(file, getKnownDemoSampleHashes())

  if (!validation.ok) {
    await db.agentRun.create({
      data: {
        runType: "RECOGNITION",
        userId,
        inputVersion: "demo-v1",
        status: "ERROR",
        latencyMs: Date.now() - startedAt,
        error: validation.code,
      },
    })
    throw new AppError(validation.message, { status: 400, code: validation.code })
  }

  const vision = await resolveVisionRecognitionProvider(db)
  const legacy = getRecognitionProvider()
  const providerName = vision ? vision.name : legacy.name
  const providerVersion = vision ? `${vision.name}/${vision.model}` : legacy.version

  // 照片处理（栅格图）：EXIF 修正 + 用户旋转 + 压缩 → 待确认封面
  let recognitionBytes = file.bytes
  let recognitionMime = file.mimeType
  let cover: { id: string; url: string } | null = null
  let coverId: string | null = null
  if (validation.kind !== "svg") {
    try {
      const processed = await processUserImage(file.bytes, normalizeUserRotation(options.userRotation))
      recognitionBytes = processed.bytes
      recognitionMime = "image/jpeg"
      const stored = await storePendingCover(db, userId, processed)
      if (stored) {
        cover = { id: stored.id, url: stored.url }
        coverId = stored.id
      }
    } catch {
      // 无法解码：不生成封面，继续用原图识别
    }
    await sweepPendingCovers(db).catch(() => undefined)
  }

  const job = await db.recognitionJob.create({
    data: {
      userId,
      state: "RUNNING",
      provider: providerName,
      providerVersion,
      fileSha256: validation.sha256,
      fileName: file.name.slice(0, 200),
      fileSize: file.bytes.byteLength,
      coverId,
    },
    include: { cover: true },
  })

  let result: VisionRunOutcome
  try {
    if (vision) {
      result = await runVisionRecognition(db, userId, vision, { name: file.name, mimeType: recognitionMime, bytes: recognitionBytes }, role)
    } else {
      // Provider（fixture/HTTP 适配器）：候选直读目录（E2E 演示链路；生产 Kimi 不走此分支）
      const legacyResult = await legacy.recognize({
        sha256: validation.sha256,
        fileName: file.name,
        mimeType: file.mimeType,
        size: file.bytes.byteLength,
        imageKind: validation.kind,
      })
      const legacyExtraction = legacyResult.extraction ?? null
      const providerCandidates = legacyResult.candidates.filter((c) => c.confidence >= CONFIDENCE_FLOOR).slice(0, 3)
      const candidates = await resolveProviderCandidates(db, userId, providerCandidates)
      const { defaultNameZh } = await import("./official-search")
      result = {
        state: legacyResult.state,
        errorCode: legacyResult.errorCode,
        provider: legacyResult.provider,
        providerVersion: legacyResult.providerVersion,
        isFixture: legacyResult.isFixture,
        extraction: legacyExtraction,
        persisted: {
          candidates,
          searchQueries: [],
          searchState: "SKIPPED",
          searchMessage: null,
          nameZhDefault: legacyExtraction
            ? defaultNameZh({
                brand: legacyExtraction.brand,
                name: legacyExtraction.name,
                series: legacyExtraction.series,
                grade: legacyExtraction.grade,
                scale: legacyExtraction.scale,
                modelNumber: legacyExtraction.modelNumber,
              })
            : null,
        },
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await db.$transaction([
      db.recognitionJob.update({
        where: { id: job.id },
        data: { state: "FAILED", errorCode: "PROVIDER_ERROR" },
      }),
      db.agentRun.create({
        data: {
          runType: "RECOGNITION",
          userId,
          inputVersion: "demo-v1",
          status: "ERROR",
          latencyMs: Date.now() - startedAt,
          error: message.slice(0, 300),
        },
      }),
    ])
    throw new AppError("识别服务异常，可重试或改用手动录入", { status: 502, code: "PROVIDER_ERROR" })
  }

  await db.$transaction([
    db.recognitionJob.update({
      where: { id: job.id },
      data: {
        state: result.state,
        resultJson: JSON.stringify(result.persisted),
        extractionJson: result.extraction ? JSON.stringify(result.extraction) : null,
        errorCode: result.errorCode ?? null,
      },
    }),
    db.agentRun.create({
      data: {
        runType: "RECOGNITION",
        userId,
        inputVersion: "demo-v1",
        outputRefs: job.id,
        status: result.state === "SUCCEEDED" ? "OK" : "ERROR",
        latencyMs: Date.now() - startedAt,
        error: result.errorCode ?? null,
      },
    }),
  ])

  if (result.state === "FAILED") {
    const friendly =
      result.errorCode === "TIMEOUT"
        ? "识别超时，可重试或改用手动录入"
        : result.errorCode === "BUDGET_EXCEEDED"
          ? "本月 AI 预算已达上限（¥50），已切换为手动录入模式，下月自动恢复"
          : "识别失败，可重试或改用手动录入"
    return {
      jobId: job.id,
      state: "FAILED",
      provider: result.provider,
      providerVersion: result.providerVersion,
      isFixture: result.isFixture,
      demoMode: result.isFixture,
      extraction: null,
      candidates: [],
      searchQueries: [],
      searchState: null,
      searchMessage: null,
      nameZhDefault: null,
      cover,
      errorCode: result.errorCode ?? "PROVIDER_ERROR",
      message: friendly,
    }
  }

  return {
    jobId: job.id,
    state: "SUCCEEDED",
    provider: result.provider,
    providerVersion: result.providerVersion,
    isFixture: result.isFixture,
    demoMode: result.isFixture,
    extraction: result.extraction ?? null,
    candidates: result.persisted.candidates,
    searchQueries: result.persisted.searchQueries,
    searchState: result.persisted.searchState,
    searchMessage: result.persisted.searchMessage,
    nameZhDefault: result.persisted.nameZhDefault,
    cover,
    errorCode: null,
    message: result.persisted.candidates.length === 0
      ? "未找到官网商品：可修改名称后点击「重新搜索官网」，或改用手动录入"
      : `找到 ${result.persisted.candidates.length} 个候选，请核对后选择`,
  }
}

/** 草稿恢复：最近一次成功且未确认的识别（24 小时内）——同一识别任务的续确认，非跨图片复用 */
export async function getLatestDraft(
  db: PrismaClient,
  userId: string,
): Promise<RecognitionJobDTO | null> {
  const now = demoNow()
  const job = await db.recognitionJob.findFirst({
    where: {
      userId,
      state: "SUCCEEDED",
      confirmedAt: null,
      createdAt: { gte: new Date(now.getTime() - 24 * 3600_000) },
      resultJson: { not: null },
    },
    orderBy: { createdAt: "desc" },
    include: { cover: true },
  })
  if (!job) return null
  const persisted = JSON.parse(job.resultJson!) as PersistedResult
  const extraction = job.extractionJson ? (JSON.parse(job.extractionJson) as ExtractionDTO) : null
  return {
    jobId: job.id,
    state: "SUCCEEDED",
    provider: job.provider,
    providerVersion: job.providerVersion,
    isFixture: job.provider === "fixture",
    demoMode: job.provider === "fixture",
    extraction,
    candidates: persisted.candidates ?? [],
    searchQueries: persisted.searchQueries ?? [],
    searchState: persisted.searchState ?? null,
    searchMessage: persisted.searchMessage ?? null,
    nameZhDefault: persisted.nameZhDefault ?? null,
    cover: toCoverDTO(job.cover),
    errorCode: null,
    message: (persisted.candidates ?? []).length === 0 ? "未找到官网商品：可修改名称后点击「重新搜索官网」，或改用手动录入" : "上次识别的候选，请核对后选择",
  }
}

interface VisionRunOutcome {
  state: "SUCCEEDED" | "FAILED"
  errorCode?: string
  provider: string
  providerVersion: string
  isFixture: boolean
  extraction: ExtractionDTO | null
  persisted: PersistedResult
}

async function runVisionRecognition(
  db: PrismaClient,
  userId: string,
  vision: VisionRecognitionProvider,
  file: UploadFileInput,
  role: "OWNER" | "DEMO",
): Promise<VisionRunOutcome> {
  // 预算熔断：月硬上限 ¥50
  const budget = await getMonthlyBudgetStatus(db, new Date())
  if (budget.exceeded) {
    return {
      state: "FAILED",
      errorCode: "BUDGET_EXCEEDED",
      provider: "moonshot",
      providerVersion: `kimi/${vision.model}`,
      isFixture: false,
      extraction: null,
      persisted: { candidates: [], searchQueries: [], searchState: null, searchMessage: null, nameZhDefault: null },
    }
  }

  const dataUrl = `data:${file.mimeType};base64,${Buffer.from(file.bytes).toString("base64")}`
  const result = await vision.extract({ imageDataUrl: dataUrl, mimeType: file.mimeType })

  await recordAiUsage(db, {
    provider: "moonshot",
    model: vision.model,
    kind: "RECOGNITION",
    requestId: result.requestId,
    latencyMs: result.latencyMs,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
  }).catch(() => undefined)

  if (result.state !== "SUCCEEDED" || !result.extraction) {
    return {
      state: "FAILED",
      errorCode: result.errorCode ?? "PROVIDER_ERROR",
      provider: "moonshot",
      providerVersion: `kimi/${vision.model}`,
      isFixture: false,
      extraction: null,
      persisted: { candidates: [], searchQueries: [], searchState: null, searchMessage: null, nameZhDefault: null },
    }
  }

  // —— Kimi 原始提取：原样保留（绝不被目录覆盖/改写） ——
  const raw = result.extraction
  const extraction: ExtractionDTO = {
    brand: raw.brand,
    name: raw.name,
    series: raw.series,
    grade: raw.grade,
    scale: raw.scale,
    modelNumber: raw.modelNumber,
  }

  // —— 官网搜索（Kimi $web_search + 候选逐条验证）；E2E 模式不联网 ——
  const { defaultNameZh } = await import("./official-search")
  const searchInput: SearchExtractionInput = {
    brand: extraction.brand,
    name: extraction.name,
    series: extraction.series,
    grade: extraction.grade,
    scale: extraction.scale,
    modelNumber: extraction.modelNumber,
    visibleText: raw.visibleText,
  }
  let persisted: PersistedResult
  if (process.env.E2E_MODE === "1" || role === "DEMO") {
    persisted = {
      candidates: [],
      searchQueries: [],
      searchState: "SKIPPED",
      searchMessage: "演示/测试模式不执行联网搜索",
      nameZhDefault: defaultNameZh(searchInput),
    }
  } else {
    const config = await resolveRecognitionConfig(db)
    const search = await searchOfficialProducts(db, searchInput, {
      liveSearch: true,
      apiKey: config.apiKey ?? "",
      model: config.model,
      baseUrl: config.baseUrl,
    })
    // 搜索用量入台账（联网搜索 token 计入 prompt_tokens）
    await recordAiUsage(db, {
      provider: "moonshot",
      model: config.model,
      kind: "RECOGNITION",
      latencyMs: search.latencyMs,
      promptTokens: search.promptTokens,
      completionTokens: search.completionTokens,
    }).catch(() => undefined)
    const candidates = await attachOwnedCounts(db, userId, search.candidates.map(toCandidateDTO))
    persisted = {
      candidates,
      searchQueries: search.searchQueries,
      searchState: search.state === "FAILED" ? "FAILED" : "OK",
      searchMessage: search.message,
      nameZhDefault: defaultNameZh(searchInput),
    }
  }

  return {
    state: "SUCCEEDED",
    provider: "moonshot",
    providerVersion: `kimi/${vision.model}`,
    isFixture: false,
    extraction,
    persisted,
  }
}

/** Provider（fixture/HTTP 适配器）候选：目录商品直读（E2E 演示链路） */
async function resolveProviderCandidates(
  db: PrismaClient,
  userId: string,
  raw: { productId: string; confidence: number; fieldConfidences?: Record<string, number> }[],
): Promise<CandidateDTO[]> {
  const products = await db.catalogProduct.findMany({
    where: { id: { in: raw.map((c) => c.productId) } },
  })
  const productMap = new Map(products.map((p) => [p.id, p]))
  const out: CandidateDTO[] = []
  for (const c of raw) {
    const p = productMap.get(c.productId)
    if (!p) continue // 目录事实校验：引用的商品必须真实存在
    out.push({
      key: null,
      productId: p.id,
      origin: "provider",
      officialName: p.nameZh ?? p.canonicalName,
      nameZh: p.nameZh,
      productCode: p.officialProductCode,
      pageUrl: p.officialPageUrl,
      imageUrl: p.officialImageUrl,
      sourceDomain: p.officialPageUrl ? (() => { try { return new URL(p.officialPageUrl!).hostname } catch { return null } })() : null,
      snippet: null,
      brand: p.brand,
      grade: p.grade,
      scale: p.scale,
      modelNumber: p.modelNumber,
      series: null,
      releaseYear: p.releaseYear,
      line: p.line,
      confidence: c.confidence,
      confidencePercent: `${Math.round(c.confidence * 100)}%`,
      fieldConfidences: c.fieldConfidences ?? null,
      uncertainFields: uncertainFieldLabels(c.fieldConfidences),
      ownedCount: 0,
    })
  }
  return attachOwnedCounts(db, userId, out)
}

/** 已拥有同款数量：按精确目录 id（官网 key / Provider productId）聚合——非模糊匹配 */
async function attachOwnedCounts(db: PrismaClient, userId: string, candidates: CandidateDTO[]): Promise<CandidateDTO[]> {
  const ids = [...new Set(candidates.map((c) => (c.key ?? c.productId)!).filter(Boolean))]
  if (ids.length === 0) return candidates
  const owned = await db.collectionAsset.groupBy({
    by: ["catalogProductId"],
    where: {
      userId,
      dispositionState: "ACTIVE",
      archivedAt: null,
      catalogProductId: { in: ids },
    },
    _count: { _all: true },
  })
  const ownedMap = new Map(owned.map((o) => [o.catalogProductId as string, o._count._all]))
  return candidates.map((c) => ({ ...c, ownedCount: ownedMap.get((c.key ?? c.productId)!) ?? 0 }))
}

function toCandidateDTO(c: VerifiedOfficialCandidate): CandidateDTO {
  return {
    key: c.key,
    productId: null,
    origin: c.origin,
    officialName: c.officialName,
    nameZh: c.nameZh,
    productCode: c.productCode,
    pageUrl: c.pageUrl,
    imageUrl: c.imageUrl,
    sourceDomain: c.sourceDomain,
    snippet: c.snippet,
    brand: c.brand,
    grade: c.grade,
    scale: c.scale,
    modelNumber: c.modelNumber,
    series: c.series,
    releaseYear: c.releaseYear,
    line: c.line,
    confidence: null,
    confidencePercent: null,
    fieldConfidences: null,
    uncertainFields: [],
    ownedCount: 0,
  }
}

/** 当前识别形态（供页面标识） */
export function recognitionMode(): "fixture" | "http" | "kimi" {
  return getRecognitionMode()
}

export { resolveProviderCandidates }
