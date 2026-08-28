import type { AgentRun, PrismaClient } from "@prisma/client"
import {
  deepseekDiscoverReleases,
  type ReleaseDiscoveryBrand,
  type ReleaseDiscoveryCandidate,
} from "../ai/release-discovery"
import { getMonthlyBudgetStatus, recordAiUsage } from "../ai/usage"
import { formatDateZh } from "../clock"
import { legoThemeLabel } from "../names/zh"
import { legoCanonicalNamePolicy } from "../names/lego-naming"
import { OFFICIAL_CATALOG_VERSION } from "./catalog"
import { resolveAdviceConfig } from "./ai-settings"
import { backfillReleaseImages, syncReleaseImage, type ReleaseImageSyncResult } from "./release-image-sync"

export const RELEASE_DISCOVERY_RUN_TYPE = "RELEASE_DISCOVERY"
export const RELEASE_DISCOVERY_SUCCESS_TTL_MS = 24 * 3600_000
export const RELEASE_DISCOVERY_FAILURE_COOLDOWN_MS = 60 * 60_000
export const RELEASE_DISCOVERY_BRANDS = ["LEGO", "Bandai"] as const satisfies readonly ReleaseDiscoveryBrand[]

export function releaseDiscoveryRunType(brand: ReleaseDiscoveryBrand): string {
  return `${RELEASE_DISCOVERY_RUN_TYPE}:${brand}`
}

export const OFFICIAL_RELEASE_SOURCES = [
  {
    brand: "LEGO" as const,
    label: "LEGO 官网新品",
    url: "https://www.lego.com/en-us/categories/new-sets-and-products",
  },
  {
    brand: "Bandai" as const,
    label: "Bandai 发售计划",
    url: "https://www.bandaihobbysite.cn/schedule",
  },
  {
    brand: "Bandai" as const,
    label: "Bandai 商品一览",
    url: "https://www.bandaihobbysite.cn/item_all",
  },
  {
    brand: "Bandai" as const,
    label: "Bandai 新品新闻",
    url: "https://www.bandaihobbysite.cn/news",
  },
] as const

export interface ValidatedReleaseCandidate extends ReleaseDiscoveryCandidate {
  productId: string
  officialPageUrl: string
  sourceUrl: string
  sourceDateValue: Date
  releaseDateValue: Date | null
}

export interface ReleaseDiscoveryRefreshResult {
  status: "UPDATED" | "FRESH" | "SKIPPED" | "FAILED"
  acceptedCount: number
  rejectedCount: number
  lastUpdatedAt: Date | null
  message: string
  /** 本轮图片补全结果（历史 PENDING 修复 + 新商品立即补图） */
  imageSync: ReleaseImageSyncResult[]
}

export interface OfficialReleaseSourceStatus {
  sources: typeof OFFICIAL_RELEASE_SOURCES
  lastUpdatedAt: Date | null
  lastStatus: "OK" | "ERROR" | null
}

export type ReleaseCandidateRejectionReason =
  | "BRAND_MISMATCH"
  | "INVALID_URL_OR_SOURCE_DATE"
  | "SOURCE_DATE_OUT_OF_RANGE"
  | "RELEASE_DATE_OUT_OF_RANGE"
  | "LEGO_NON_OFFICIAL_HOST"
  | "LEGO_INVALID_PRODUCT_PATH"
  | "LEGO_SET_NUMBER_MISMATCH"
  | "LEGO_INVALID_SOURCE_PATH"
  | "BANDAI_NON_OFFICIAL_HOST"
  | "BANDAI_INVALID_PRODUCT_PATH"
  | "BANDAI_INVALID_SOURCE_PATH"
  | "DUPLICATE_PRODUCT"

export interface RejectedReleaseCandidate {
  brand: ReleaseDiscoveryBrand
  modelNumber: string
  officialPageUrl: string
  sourceUrl: string
  reason: ReleaseCandidateRejectionReason
}

export interface ReleaseCandidateValidationAudit {
  accepted: ValidatedReleaseCandidate[]
  rejected: RejectedReleaseCandidate[]
}

function canonicalHttpsUrl(raw: string): URL | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null
    url.hostname = url.hostname.toLowerCase()
    url.search = ""
    url.hash = ""
    return url
  } catch {
    return null
  }
}

function dateAtShanghaiMidnight(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00+08:00`)
  if (!Number.isFinite(date.getTime()) || formatDateZh(date) !== value) return null
  return date
}

function withinDays(value: Date, now: Date, pastDays: number, futureDays: number): boolean {
  return value.getTime() >= now.getTime() - pastDays * 86_400_000 && value.getTime() <= now.getTime() + futureDays * 86_400_000
}

function exactHost(hostname: string, expected: string): boolean {
  return hostname === expected || hostname === `www.${expected}`
}

function rejectedCandidate(
  candidate: ReleaseDiscoveryCandidate,
  reason: ReleaseCandidateRejectionReason,
): { valid: null; rejected: RejectedReleaseCandidate } {
  return {
    valid: null,
    rejected: {
      brand: candidate.brand,
      modelNumber: candidate.modelNumber,
      officialPageUrl: candidate.officialPageUrl,
      sourceUrl: candidate.sourceUrl,
      reason,
    },
  }
}

/**
 * 模型输出不直接入库。这里只接受指定官方域名、明确的商品详情路径、匹配的商品编号和合理日期。
 * 搜索结果页、第三方转载、带认证信息/端口的 URL 一律丢弃，并返回可审计的原因码。
 */
export function validateReleaseCandidateWithReason(
  candidate: ReleaseDiscoveryCandidate,
  now: Date,
  expectedBrand?: ReleaseDiscoveryBrand,
): { valid: ValidatedReleaseCandidate; rejected: null } | { valid: null; rejected: RejectedReleaseCandidate } {
  if (expectedBrand && candidate.brand !== expectedBrand) return rejectedCandidate(candidate, "BRAND_MISMATCH")
  const officialPage = canonicalHttpsUrl(candidate.officialPageUrl)
  const source = canonicalHttpsUrl(candidate.sourceUrl)
  const sourceDateValue = dateAtShanghaiMidnight(candidate.sourceDate)
  const releaseDateValue = candidate.releaseDate ? dateAtShanghaiMidnight(candidate.releaseDate) : null
  if (!officialPage || !source || !sourceDateValue) return rejectedCandidate(candidate, "INVALID_URL_OR_SOURCE_DATE")
  if (!withinDays(sourceDateValue, now, 120, 1)) return rejectedCandidate(candidate, "SOURCE_DATE_OUT_OF_RANGE")
  if (candidate.releaseDate && (!releaseDateValue || !withinDays(releaseDateValue, now, 365, 365))) {
    return rejectedCandidate(candidate, "RELEASE_DATE_OUT_OF_RANGE")
  }

  if (candidate.brand === "LEGO") {
    if (!exactHost(officialPage.hostname, "lego.com") || !exactHost(source.hostname, "lego.com")) {
      return rejectedCandidate(candidate, "LEGO_NON_OFFICIAL_HOST")
    }
    const productMatch = officialPage.pathname.match(/^\/en-us\/product\/[a-z0-9-]+-(\d{4,7})\/?$/i)
    if (!productMatch) return rejectedCandidate(candidate, "LEGO_INVALID_PRODUCT_PATH")
    const setNumber = candidate.modelNumber.match(/\d{4,7}/)?.[0]
    if (!setNumber || productMatch[1] !== setNumber) return rejectedCandidate(candidate, "LEGO_SET_NUMBER_MISMATCH")
    const sourceAllowed =
      /^\/en-us\/categories\/new-sets-and-products\/?$/i.test(source.pathname) ||
      /^\/en-us\/product\/[a-z0-9-]+-\d{4,7}\/?$/i.test(source.pathname)
    if (!sourceAllowed) return rejectedCandidate(candidate, "LEGO_INVALID_SOURCE_PATH")
    return {
      valid: {
        ...candidate,
        productId: `lego-${setNumber}`,
        modelNumber: setNumber,
        officialPageUrl: officialPage.toString().replace(/\/$/, ""),
        sourceUrl: source.toString().replace(/\/$/, ""),
        sourceDateValue,
        releaseDateValue,
      },
      rejected: null,
    }
  }

  if (!exactHost(officialPage.hostname, "bandaihobbysite.cn") || !exactHost(source.hostname, "bandaihobbysite.cn")) {
    return rejectedCandidate(candidate, "BANDAI_NON_OFFICIAL_HOST")
  }
  const detailMatch = officialPage.pathname.match(/^\/index\/index\/detail\/id\/(\d+)\/?$/i)
  if (!detailMatch) return rejectedCandidate(candidate, "BANDAI_INVALID_PRODUCT_PATH")
  const sourceAllowed =
    /^\/?$/i.test(source.pathname) ||
    /^\/(gunpla|schedule|item_all|news)\/?$/i.test(source.pathname) ||
    /^\/gunpla\/news\/?$/i.test(source.pathname) ||
    /^\/index\/index\/(detail\/id\/\d+|schedule\/month\/\d{4}-\d{2}|news_detail\/id\/\d+)\/?$/i.test(source.pathname)
  if (!sourceAllowed) return rejectedCandidate(candidate, "BANDAI_INVALID_SOURCE_PATH")
  return {
    valid: {
      ...candidate,
      productId: `bandai-cn-${detailMatch[1]}`,
      officialPageUrl: officialPage.toString().replace(/\/$/, ""),
      sourceUrl: source.toString().replace(/\/$/, ""),
      sourceDateValue,
      releaseDateValue,
    },
    rejected: null,
  }
}

export function validateReleaseCandidatesWithAudit(
  candidates: ReleaseDiscoveryCandidate[],
  now: Date,
  expectedBrand?: ReleaseDiscoveryBrand,
): ReleaseCandidateValidationAudit {
  const accepted = new Map<string, ValidatedReleaseCandidate>()
  const rejected: RejectedReleaseCandidate[] = []
  for (const candidate of candidates) {
    const result = validateReleaseCandidateWithReason(candidate, now, expectedBrand)
    if (!result.valid) {
      rejected.push(result.rejected)
      continue
    }
    const valid = result.valid
    const previous = accepted.get(valid.productId)
    if (!previous) {
      accepted.set(valid.productId, valid)
      continue
    }
    rejected.push({
      brand: candidate.brand,
      modelNumber: candidate.modelNumber,
      officialPageUrl: candidate.officialPageUrl,
      sourceUrl: candidate.sourceUrl,
      reason: "DUPLICATE_PRODUCT",
    })
    if (valid.sourceDateValue > previous.sourceDateValue) accepted.set(valid.productId, valid)
  }
  return { accepted: [...accepted.values()], rejected }
}

export function validateReleaseCandidates(candidates: ReleaseDiscoveryCandidate[], now: Date): ValidatedReleaseCandidate[] {
  return validateReleaseCandidatesWithAudit(candidates, now).accepted
}

async function persistCandidates(
  db: PrismaClient,
  candidates: ValidatedReleaseCandidate[],
): Promise<void> {
  await db.$transaction(async (tx) => {
    for (const item of candidates) {
      const legoTheme = item.brand === "LEGO" ? legoThemeLabel(item.series, item.grade) : null
      const grade = item.brand === "LEGO" ? legoTheme! : item.grade ?? "GUNPLA"
      const canonicalName = item.brand === "LEGO"
        ? legoCanonicalNamePolicy(item.officialName, item.nameZh, item.modelNumber).canonicalName
        : item.officialName
      const eventTitle = item.releaseDateValue
        ? `${canonicalName} · ${formatDateZh(item.releaseDateValue)} 发售`
        : canonicalName
      await tx.catalogProduct.upsert({
        where: { id: item.productId },
        create: {
          id: item.productId,
          brand: item.brand,
          category: item.brand === "LEGO" ? "LEGO" : "Gundam",
          line: null,
          grade,
          // LEGO 名称策略（R9）：canonicalName=官网英文（模型输出即官网英文标题），
          // nameZh/nameZhSource 恒 null（丢弃模型生成的中文名）
          canonicalName,
          nameZh: item.brand === "LEGO" ? null : item.nameZh,
          nameZhSource: item.brand === "LEGO" ? null : undefined,
          modelNumber: item.modelNumber,
          series: item.series,
          officialPageUrl: item.officialPageUrl,
          source: item.sourceUrl,
          catalogVersion: OFFICIAL_CATALOG_VERSION,
          releaseYear: item.releaseDate ? Number(item.releaseDate.slice(0, 4)) : null,
          imageStatus: "PENDING",
        },
        update: {
          canonicalName,
          nameZh: item.brand === "LEGO" ? null : (item.nameZh ?? undefined),
          nameZhSource: item.brand === "LEGO" ? null : undefined,
          modelNumber: item.modelNumber,
          series: item.series ?? undefined,
          grade,
          officialPageUrl: item.officialPageUrl,
          source: item.sourceUrl,
          catalogVersion: OFFICIAL_CATALOG_VERSION,
          releaseYear: item.releaseDate ? Number(item.releaseDate.slice(0, 4)) : undefined,
        },
      })
      await tx.releaseEvent.upsert({
        where: { id: `official-live-${item.productId}` },
        create: {
          id: `official-live-${item.productId}`,
          catalogProductId: item.productId,
          title: eventTitle,
          announcedAt: item.sourceDateValue,
          sourceUrl: item.sourceUrl,
          sourceName: item.brand === "LEGO" ? "LEGO 官网新品" : "Bandai Hobby Site",
          priceMinor: null,
          datasetVersion: OFFICIAL_CATALOG_VERSION,
        },
        update: {
          title: eventTitle,
          announcedAt: item.sourceDateValue,
          sourceUrl: item.sourceUrl,
          sourceName: item.brand === "LEGO" ? "LEGO 官网新品" : "Bandai Hobby Site",
          datasetVersion: OFFICIAL_CATALOG_VERSION,
        },
      })
    }
  })
}

/**
 * LEGO / Bandai 各自独立检索和缓存：单品牌成功后 24h 内不重复消耗额度，
 * 单品牌失败只冷却 1h，不再被另一品牌的成功结果掩盖。已验证的旧事件始终保留。
 */
export async function refreshOfficialReleaseSources(
  db: PrismaClient,
  userId: string,
  now: Date,
  options: { force?: boolean; allowInTests?: boolean } = {},
): Promise<ReleaseDiscoveryRefreshResult> {
  if (process.env.E2E_MODE === "1" || (process.env.NODE_ENV === "test" && !options.allowInTests)) {
    return { status: "SKIPPED", acceptedCount: 0, rejectedCount: 0, lastUpdatedAt: null, message: "测试环境不联网", imageSync: [] }
  }

  const latestByBrand = new Map<ReleaseDiscoveryBrand, AgentRun | null>()
  await Promise.all(RELEASE_DISCOVERY_BRANDS.map(async (brand) => {
    latestByBrand.set(brand, await db.agentRun.findFirst({
      where: { runType: releaseDiscoveryRunType(brand), userId },
      orderBy: { createdAt: "desc" },
    }))
  }))
  const latestSuccessfulAt = [...latestByBrand.values()]
    .filter((run): run is NonNullable<typeof run> => Boolean(run && run.status === "OK"))
    .map((run) => run.createdAt)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null
  const dueBrands = RELEASE_DISCOVERY_BRANDS.filter((brand) => {
    if (options.force) return true
    const latest = latestByBrand.get(brand)
    if (!latest) return true
    const age = now.getTime() - latest.createdAt.getTime()
    const ttl = latest.status === "OK" ? RELEASE_DISCOVERY_SUCCESS_TTL_MS : RELEASE_DISCOVERY_FAILURE_COOLDOWN_MS
    return age < 0 || age >= ttl
  })
  if (dueBrands.length === 0) {
    const failedBrands = RELEASE_DISCOVERY_BRANDS.filter((brand) => latestByBrand.get(brand)?.status === "ERROR")
    return {
      status: "FRESH",
      acceptedCount: 0,
      rejectedCount: 0,
      lastUpdatedAt: latestSuccessfulAt,
      message: failedBrands.length > 0
        ? `${failedBrands.join(" / ")} 上次联网失败，冷却后将单独重试`
        : "LEGO 与 Bandai 官方新品信息仍在有效期内",
      imageSync: await backfillReleaseImages(db, { now }),
    }
  }

  const [config, budget] = await Promise.all([
    resolveAdviceConfig(db),
    getMonthlyBudgetStatus(db, now),
  ])
  if (!config.apiKey) {
    return { status: "SKIPPED", acceptedCount: 0, rejectedCount: 0, lastUpdatedAt: latestSuccessfulAt, message: "收藏建议模型尚未配置", imageSync: await backfillReleaseImages(db, { now }) }
  }
  if (budget.exceeded) {
    return { status: "SKIPPED", acceptedCount: 0, rejectedCount: 0, lastUpdatedAt: latestSuccessfulAt, message: "本月 AI 额度已达上限", imageSync: await backfillReleaseImages(db, { now }) }
  }
  const apiKey = config.apiKey

  const discoveries = await Promise.all(dueBrands.map(async (brand) => {
    const discovery = await deepseekDiscoverReleases({
      apiKey,
      model: config.model,
      baseUrl: config.baseUrl,
      now,
      brand,
      maxItems: 5,
    })
    await recordAiUsage(db, {
      provider: "deepseek",
      model: discovery.model,
      kind: "REPORT",
      requestId: discovery.requestId,
      latencyMs: discovery.latencyMs,
      promptTokens: discovery.promptTokens,
      completionTokens: discovery.completionTokens,
    }).catch(() => undefined)
    return { brand, discovery }
  }))

  const accepted: ValidatedReleaseCandidate[] = []
  let rejectedCount = 0
  const failedBrands: ReleaseDiscoveryBrand[] = []
  for (const { brand, discovery } of discoveries) {
    if (discovery.state !== "SUCCEEDED") {
      failedBrands.push(brand)
      await db.agentRun.create({
        data: {
          runType: releaseDiscoveryRunType(brand),
          userId,
          inputVersion: `official-web:${brand}:${formatDateZh(now)}`,
          status: "ERROR",
          latencyMs: discovery.latencyMs,
          error: discovery.errorCode ?? "DISCOVERY_FAILED",
          createdAt: now,
        },
      })
      continue
    }

    const audit = validateReleaseCandidatesWithAudit(discovery.candidates, now, brand)
    rejectedCount += audit.rejected.length
    const auditJson = JSON.stringify({
      accepted: audit.accepted.map((item) => item.productId),
      rejected: audit.rejected,
    })
    if (audit.accepted.length === 0) {
      failedBrands.push(brand)
      await db.agentRun.create({
        data: {
          runType: releaseDiscoveryRunType(brand),
          userId,
          inputVersion: `official-web:${brand}:${formatDateZh(now)}`,
          outputRefs: auditJson,
          status: "ERROR",
          latencyMs: discovery.latencyMs,
          error: "NO_ACCEPTED_CANDIDATES",
          createdAt: now,
        },
      })
      continue
    }

    // 单品牌元数据先安全入库，再记成功运行；另一品牌失败不回滚本品牌。
    await persistCandidates(db, audit.accepted)
    accepted.push(...audit.accepted)
    await db.agentRun.create({
      data: {
        runType: releaseDiscoveryRunType(brand),
        userId,
        inputVersion: `official-web:${brand}:${formatDateZh(now)}`,
        outputRefs: auditJson,
        status: "OK",
        latencyMs: discovery.latencyMs,
        createdAt: now,
      },
    })
  }

  // 新商品立即补图（逐个，事务外） + 展示窗口内 PENDING/null 历史补全。
  const imageSync: ReleaseImageSyncResult[] = []
  for (const item of accepted) {
    const product = await db.catalogProduct.findUnique({ where: { id: item.productId } })
    if (product) {
      imageSync.push(await syncReleaseImage(db, product).catch((e) => ({
        productId: item.productId,
        status: "FAILED" as const,
        reason: (e as Error).message.slice(0, 60),
        imageUrl: null,
      })))
    }
  }
  const backfilled = await backfillReleaseImages(db, { now }).catch(() => [] as ReleaseImageSyncResult[])
  const seen = new Set(imageSync.map((r) => r.productId))
  for (const r of backfilled) {
    if (!seen.has(r.productId)) imageSync.push(r)
  }
  const allFailed = failedBrands.length === dueBrands.length
  return {
    status: allFailed ? "FAILED" : "UPDATED",
    acceptedCount: accepted.length,
    rejectedCount,
    lastUpdatedAt: accepted.length > 0 ? now : latestSuccessfulAt,
    message: allFailed
      ? `${failedBrands.join(" / ")} 官网检索未得到可验证商品，继续使用上次结果`
      : `已更新 ${accepted.length} 条新品信息${failedBrands.length > 0 ? `；${failedBrands.join(" / ")} 将于冷却后单独重试` : ""}`,
    imageSync,
  }
}

export async function getOfficialReleaseSourceStatus(db: PrismaClient, userId: string): Promise<OfficialReleaseSourceStatus> {
  const runTypes = [RELEASE_DISCOVERY_RUN_TYPE, ...RELEASE_DISCOVERY_BRANDS.map(releaseDiscoveryRunType)]
  const runs = await db.agentRun.findMany({
    where: { runType: { in: runTypes }, userId },
    orderBy: { createdAt: "desc" },
    select: { runType: true, status: true, createdAt: true },
  })
  const latestByType = new Map<string, (typeof runs)[number]>()
  for (const run of runs) {
    if (!latestByType.has(run.runType)) latestByType.set(run.runType, run)
  }
  const brandLatest = RELEASE_DISCOVERY_BRANDS
    .map((brand) => latestByType.get(releaseDiscoveryRunType(brand)))
    .filter((run): run is NonNullable<typeof run> => Boolean(run))
  const legacyLatest = latestByType.get(RELEASE_DISCOVERY_RUN_TYPE)
  const visibleLatest = brandLatest.length > 0 ? brandLatest : legacyLatest ? [legacyLatest] : []
  const latestSuccess = runs.find((run) => run.status === "OK")
  return {
    sources: OFFICIAL_RELEASE_SOURCES,
    lastUpdatedAt: latestSuccess?.createdAt ?? null,
    lastStatus: visibleLatest.some((run) => run.status === "ERROR")
      ? "ERROR"
      : visibleLatest.some((run) => run.status === "OK") ? "OK" : null,
  }
}
