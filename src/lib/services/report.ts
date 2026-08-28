import { createHash } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import { addDays, diffDays, startOfDay } from "../clock"
import { DATASET_VERSION } from "../demo-dataset"
import { formatDateZh } from "../clock"
import { insightTypeLabel } from "../format"
import { STRUCTURE_INSIGHT_THRESHOLD_PERCENT, computeStats, getDashboardStats } from "./stats"
import { recommendationCopy, stalledCopy, structureCopy } from "../report/copy"
import { recommendationBasisFingerprint } from "../report/basis"
import { isUniqueConstraintViolation } from "../db-errors"
import { CATALOG_VERSIONS } from "./catalog"
import { resolveReportPolishProvider } from "../ai/report-provider"
import { resolveAdviceConfig } from "./ai-settings"
import { getMonthlyBudgetStatus, recordAiUsage } from "../ai/usage"
import { getRouteProgress, type RouteProgress } from "./routes"
import { refreshOfficialReleaseSources } from "./release-discovery"

/**
 * 收藏建议（返工轮任务 3，原"周报"）：
 * - 单个数据库事务内一致读取快照 → 版本化新品事件生成候选 → 确定性规则打分排序去重
 *   → 模板组织文案 → 校验引用 → 保存 0–3 条建议，写入真实快照标识；
 * - 三类语义：制作推进（停滞提醒）、路线补齐（结构完成度）、新品关注（推荐）；
 * - 打分不重归一化：偏好 40（品类 15+等级 15+路线 10）、互补 25、预算 15、30 日时效 10、近 90 日同等级正反馈 10；
 * - 已拥有同 SKU 强排除；“不感兴趣”在 30 天内且推荐依据指纹未变时抑制，依据实质变化允许重新推荐（FR-09）；
 * - 无可靠新品时明确输出“暂无新品动态”，绝不编造；
 * - 刷新语义：同一自然日（periodEnd=当日 00:00，@@unique(userId, periodEnd) 兜底并发）
 *   且输入数据快照未变 → 幂等返回现有建议；收藏确认/状态变化（快照变化）→ 原位更新当日建议；
 *   跨日首次打开 → 生成新一期。AI 润色失败回退确定性模板（始终有可用建议）。
 */

export const GENERATOR_VERSION = "advice-generator-v5"
export const REPORT_ELIGIBILITY_MIN_ASSETS = 3
export const SUPPRESS_DAYS = 30
export const FEEDBACK_WINDOW_DAYS = 90

export interface ScoredCandidate {
  eventId: string
  productId: string
  productName: string
  grade: string
  line: string | null
  score: number
  reasonCodes: string[]
  eventPriceMinor: number | null
  announcedAt: Date
  sourceUrl: string
  sourceName: string
  basisFingerprint: string
}

export interface ScoringEventInput {
  id: string
  title: string
  announcedAt: Date
  sourceUrl: string
  sourceName: string
  priceMinor: number | null
  product: { id: string; canonicalName: string; category: string; grade: string; line: string | null }
}

export interface NotInterestedRecord {
  productId: string
  /** 反馈时点的推荐依据指纹；null 表示旧数据（按“依据未变”保守抑制） */
  fingerprint: string | null
  actedAt: Date
}

export interface ScoringContext {
  ownedProductIds: ReadonlySet<string>
  /** 显式排除集（兼容既有调用；与依据抑制取并集） */
  suppressedProductIds: ReadonlySet<string>
  /** 30 天内“不感兴趣”记录（依据指纹抑制） */
  notInterested?: readonly NotInterestedRecord[]
  preferences: { category?: string; grade?: string; route?: string; monthlyBudgetMinor?: number }
  distinctActiveProductsByLine: ReadonlyMap<string, number>
  positiveFeedbackGrades: ReadonlySet<string>
  negativeFeedbackGrades: ReadonlySet<string>
  now: Date
}

/** 纯函数：确定性打分与排除（预期排序 P02=90 > P06=75 > P12=55，P03 已拥有被排除） */
export function scoreReleaseEvents(events: ScoringEventInput[], ctx: ScoringContext): ScoredCandidate[] {
  const notInterestedByProduct = new Map<string, NotInterestedRecord>()
  for (const record of ctx.notInterested ?? []) {
    const prev = notInterestedByProduct.get(record.productId)
    if (!prev || record.actedAt > prev.actedAt) notInterestedByProduct.set(record.productId, record)
  }

  const scored: ScoredCandidate[] = []
  for (const e of events) {
    const p = e.product
    if (ctx.ownedProductIds.has(p.id)) continue // 已拥有同 SKU：强排除
    if (ctx.suppressedProductIds.has(p.id)) continue // 显式排除

    let score = 0
    const reasonCodes: string[] = []
    if (ctx.preferences.category && p.category === ctx.preferences.category) {
      score += 15
      reasonCodes.push("PREF_CATEGORY")
    }
    if (ctx.preferences.grade && p.grade === ctx.preferences.grade) {
      score += 15
      reasonCodes.push("PREF_GRADE")
    }
    if (ctx.preferences.route && p.line === ctx.preferences.route) {
      score += 10
      reasonCodes.push("PREF_ROUTE")
    }
    const lineCount = (p.line != null ? ctx.distinctActiveProductsByLine.get(p.line) : undefined) ?? 0
    if (lineCount >= 2) {
      score += 25
      reasonCodes.push("COMPLEMENT")
    }
    if (
      e.priceMinor != null &&
      ctx.preferences.monthlyBudgetMinor != null &&
      e.priceMinor <= ctx.preferences.monthlyBudgetMinor
    ) {
      score += 15
      reasonCodes.push("BUDGET_OK")
    }
    const ageDays = diffDays(e.announcedAt, ctx.now)
    if (ageDays >= -180 && ageDays <= 90) {
      score += 10
      reasonCodes.push("RECENT_RELEASE")
    }
    if (
      ctx.positiveFeedbackGrades.has(p.grade) &&
      !ctx.negativeFeedbackGrades.has(p.grade)
    ) {
      score += 10
      reasonCodes.push("POSITIVE_FEEDBACK")
    }

    const candidate: Omit<ScoredCandidate, "basisFingerprint"> = {
      eventId: e.id,
      productId: p.id,
      productName: p.canonicalName,
      grade: p.grade,
      line: p.line,
      score,
      reasonCodes,
      eventPriceMinor: e.priceMinor,
      announcedAt: e.announcedAt,
      sourceUrl: e.sourceUrl,
      sourceName: e.sourceName,
    }

    // 依据指纹抑制（FR-09）：30 天内“不感兴趣”且依据未变 → 排除；依据实质变化 → 允许重新推荐
    const notInterested = notInterestedByProduct.get(p.id)
    if (notInterested && diffDays(notInterested.actedAt, ctx.now) <= SUPPRESS_DAYS) {
      if (notInterested.fingerprint == null) continue // 旧数据无指纹：保守抑制
      const fingerprint = recommendationBasisFingerprint({
        productId: candidate.productId,
        score: candidate.score,
        reasonCodes: candidate.reasonCodes,
        eventPriceMinor: candidate.eventPriceMinor,
        sourceUrl: candidate.sourceUrl,
        sourceDate: candidate.announcedAt,
      })
      if (notInterested.fingerprint === fingerprint) continue
    }

    scored.push({
      ...candidate,
      basisFingerprint: recommendationBasisFingerprint({
        productId: candidate.productId,
        score: candidate.score,
        reasonCodes: candidate.reasonCodes,
        eventPriceMinor: candidate.eventPriceMinor,
        sourceUrl: candidate.sourceUrl,
        sourceDate: candidate.announcedAt,
      }),
    })
  }
  return scored.sort((a, b) => b.score - a.score || a.productId.localeCompare(b.productId))
}

export interface GenerateReportResult {
  status: "LOCKED" | "OK"
  needMoreCount: number
  reportId: string | null
  created: boolean
  insightCount: number
  message: string
  snapshotVersion: string | null
}

/** 建议的刷新窗口：当日（periodEnd=+08:00 日历日 00:00，唯一键粒度） */
export function reportPeriod(now: Date): { periodStart: Date; periodEnd: Date } {
  const periodEnd = startOfDay(now)
  const periodStart = addDays(periodEnd, -6)
  return { periodStart, periodEnd }
}

interface SnapshotRows {
  events: { id: string; announcedAt: Date; priceMinor: number | null; catalogProductId: string }[]
  preferences: { kind: string; value: string }[]
  assets: { id: string; catalogProductId: string | null; dispositionState: string; buildState: string; progress: number; lastActivityAt: Date }[]
  feedbacks: { id: string; value: string; actedAt: Date; basisFingerprint: string | null }[]
}

/**
 * 真实快照标识：对本次事务内实际读取的输入数据做指纹（数据变化 → 标识变化）。
 * 注意（返工轮任务 3）：反馈不参与标识——「不感兴趣」等反馈只影响后续打分（30 天抑制），
 * 不构成建议过期；过期信号 = 收藏确认/状态变化（assets）、目录事件或偏好变化。
 */
export function computeSnapshotVersion(rows: SnapshotRows): string {
  const digest = JSON.stringify({
    events: rows.events
      .map((e) => `${e.id}:${e.catalogProductId}:${formatDateZh(e.announcedAt)}:${e.priceMinor ?? "-"}`)
      .sort(),
    preferences: rows.preferences.map((p) => `${p.kind}=${p.value}`).sort(),
    assets: rows.assets
      .map((a) => `${a.id}:${a.catalogProductId ?? "-"}:${a.dispositionState}:${a.buildState}:${a.progress}:${formatDateZh(a.lastActivityAt)}`)
      .sort(),
  })
  return `${DATASET_VERSION}:snap-${sha256Hex12(digest)}`
}

function sha256Hex12(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12)
}

export async function generateReport(db: PrismaClient, userId: string, now: Date): Promise<GenerateReportResult> {
  const startedAt = Date.now()
  const { periodStart, periodEnd } = reportPeriod(now)

  // 收藏建议的上游数据：每天主动联网检索 LEGO / Bandai 官方来源。
  // 远程失败只保留旧的已验证 ReleaseEvent，不影响后续确定性建议与页面可用性。
  const activeAssetCount = await db.collectionAsset.count({
    where: { userId, dispositionState: "ACTIVE", archivedAt: null },
  })
  if (activeAssetCount >= REPORT_ELIGIBILITY_MIN_ASSETS) {
    await refreshOfficialReleaseSources(db, userId, now).catch(() => undefined)
  }

  // —— 一致快照读取：批量事务（单一连接上顺序执行的一组查询，原子一致）——
  // 事件、偏好、资产（打分用）、资产（统计/停滞详情用）、反馈、本期已有报告，全部同批读取。
  const [events, preferences, scoringAssets, allAssets, feedbacks, existingReport] = await db.$transaction([
    db.releaseEvent.findMany({
      where: { datasetVersion: { in: CATALOG_VERSIONS } },
      include: { product: true },
      orderBy: { announcedAt: "desc" },
    }),
    db.userPreference.findMany({ where: { userId, source: "USER" } }),
    db.collectionAsset.findMany({
      where: { userId, dispositionState: "ACTIVE", archivedAt: null, catalogProductId: { not: null } },
      select: { catalogProductId: true, product: { select: { line: true } } },
    }),
    db.collectionAsset.findMany({
      where: { userId },
      include: { product: { select: { canonicalName: true, brand: true, grade: true, line: true } } },
      orderBy: { lastActivityAt: "desc" },
    }),
    db.insightFeedback.findMany({
      where: { userId, actedAt: { gte: addDays(now, -FEEDBACK_WINDOW_DAYS) } },
      include: { insight: { include: { product: true } } },
    }),
    db.insightReport.findUnique({
      where: { userId_periodEnd: { userId, periodEnd } },
      include: { insights: { select: { id: true } } },
    }),
  ])

  const stats = computeStats(
    allAssets.map((a) => ({
      id: a.id,
      catalogProductId: a.catalogProductId,
      customName: a.customName,
      customBrand: a.customBrand,
      dispositionState: a.dispositionState,
      archivedAt: a.archivedAt,
      buildState: a.buildState,
      progress: a.progress,
      purchasePriceMinor: a.purchasePriceMinor,
      lastActivityAt: a.lastActivityAt,
      product: a.product,
    })),
    now,
  )

  if (stats.currentCollection < REPORT_ELIGIBILITY_MIN_ASSETS) {
    return {
      status: "LOCKED",
      needMoreCount: REPORT_ELIGIBILITY_MIN_ASSETS - stats.currentCollection,
      reportId: null,
      created: false,
      insightCount: 0,
      message: "已确认收藏不足 3 件，尚未解锁收藏建议",
      snapshotVersion: null,
    }
  }

  // —— 快照标识先算：当日建议 + 数据未变 → 幂等返回（收藏确认/状态变化 → 快照变化 → 原位刷新）——
  const snapshotVersion = computeSnapshotVersion({
    events: events.map((e) => ({
      id: e.id,
      announcedAt: e.announcedAt,
      priceMinor: e.priceMinor,
      catalogProductId: e.catalogProductId,
    })),
    preferences: preferences.map((p) => ({ kind: p.kind, value: p.value })),
    assets: allAssets.map((a) => ({
      id: a.id,
      catalogProductId: a.catalogProductId,
      dispositionState: a.dispositionState,
      buildState: a.buildState,
      progress: a.progress,
      lastActivityAt: a.lastActivityAt,
    })),
    feedbacks: feedbacks.map((f) => ({
      id: f.id,
      value: f.value,
      actedAt: f.actedAt,
      basisFingerprint: f.basisFingerprint,
    })),
  })

  if (
    existingReport &&
    existingReport.snapshotVersion === snapshotVersion &&
    existingReport.generatorVersion === GENERATOR_VERSION
  ) {
    const count = await db.insight.count({ where: { reportId: existingReport.id } })
    return {
      status: "OK",
      needMoreCount: 0,
      reportId: existingReport.id,
      created: false,
      insightCount: count,
      message: "收藏建议已是最新（数据未变化）",
      snapshotVersion: existingReport.snapshotVersion,
    }
  }

  const ownedProductIds = new Set<string>()
  const lineProductSet = new Map<string, Set<string>>()
  for (const a of scoringAssets) {
    if (!a.catalogProductId) continue
    ownedProductIds.add(a.catalogProductId)
    const line = a.product?.line
    if (line) {
      const set = lineProductSet.get(line) ?? new Set<string>()
      set.add(a.catalogProductId)
      lineProductSet.set(line, set)
    }
  }
  const distinctActiveProductsByLine = new Map<string, number>()
  for (const [line, set] of lineProductSet) distinctActiveProductsByLine.set(line, set.size)

  const prefs: ScoringContext["preferences"] = {}
  for (const p of preferences) {
    if (p.kind === "CATEGORY") prefs.category = p.value
    if (p.kind === "GRADE") prefs.grade = p.value
    if (p.kind === "ROUTE") prefs.route = p.value
    if (p.kind === "MONTHLY_BUDGET_MINOR") prefs.monthlyBudgetMinor = Number(p.value)
  }

  const notInterested: NotInterestedRecord[] = []
  const positiveFeedbackGrades = new Set<string>()
  const negativeFeedbackGrades = new Set<string>()
  for (const f of feedbacks) {
    const product = f.insight.product
    const grade = product?.grade
    if (f.value === "NOT_INTERESTED" && product) {
      notInterested.push({ productId: product.id, fingerprint: f.basisFingerprint, actedAt: f.actedAt })
    }
    if (grade) {
      if (f.value === "USEFUL" || f.value === "ACTED") positiveFeedbackGrades.add(grade)
      if (f.value === "NOT_INTERESTED") negativeFeedbackGrades.add(grade)
    }
  }

  const candidates = scoreReleaseEvents(events, {
    ownedProductIds,
    suppressedProductIds: new Set<string>(),
    notInterested,
    preferences: prefs,
    distinctActiveProductsByLine,
    positiveFeedbackGrades,
    negativeFeedbackGrades,
    now,
  })

  // —— 每类最多一条，总数不超过 3（纯计算，基于快照数据）——
  type NewInsight = {
    type: string
    score: number
    reasonCodes: string[]
    headline: string
    body: string
    productId?: string
    assetId?: string
    sourceUrl?: string
    sourceDate?: Date
    eventPriceMinor?: number | null
  }
  const newInsights: NewInsight[] = []

  // 新品关注按已验证来源日期倒序，不再用“匹配分”决定谁是最新动态；
  // 分数只保留为内部反馈依据，产品界面不展示。
  const top = candidates
    .filter((candidate) => {
      const age = diffDays(candidate.announcedAt, now)
      return age >= -180 && age <= 90
    })
    .sort((a, b) => {
      const aFuture = a.announcedAt.getTime() > now.getTime()
      const bFuture = b.announcedAt.getTime() > now.getTime()
      if (aFuture !== bFuture) return aFuture ? 1 : -1
      const dateOrder = aFuture
        ? a.announcedAt.getTime() - b.announcedAt.getTime()
        : b.announcedAt.getTime() - a.announcedAt.getTime()
      return dateOrder || b.score - a.score || a.productId.localeCompare(b.productId)
    })[0]
  if (top) {
    const copy = recommendationCopy({
      productName: top.productName,
      score: top.score,
      reasonCodes: top.reasonCodes,
      eventPriceMinor: top.eventPriceMinor,
      budgetMinor: prefs.monthlyBudgetMinor ?? null,
      sourceName: top.sourceName,
      sourceUrl: top.sourceUrl,
      sourceDateLabel: formatDateZh(top.announcedAt),
    })
    newInsights.push({
      type: "NEW_PRODUCT_RECOMMENDATION",
      score: top.score,
      reasonCodes: top.reasonCodes,
      headline: copy.headline,
      body: copy.body,
      productId: top.productId,
      sourceUrl: top.sourceUrl,
      sourceDate: top.announcedAt,
      eventPriceMinor: top.eventPriceMinor,
    })
  }

  const stalledTop = stats.stalled[0]
  if (stalledTop) {
    const stalledAsset = allAssets.find((a) => a.id === stalledTop.assetId)
    if (stalledAsset && stalledAsset.userId === userId) {
      const copy = stalledCopy({
        assetName: stalledAsset.product?.canonicalName ?? stalledAsset.customName ?? "未命名实体",
        assetId: stalledAsset.id,
        days: stalledTop.days,
        progress: stalledAsset.progress,
        lastActivityLabel: formatDateZh(stalledAsset.lastActivityAt),
      })
      newInsights.push({
        type: "STALLED_BUILDING",
        score: stalledTop.days,
        reasonCodes: ["NO_ACTIVITY_14D"],
        headline: copy.headline,
        body: copy.body,
        assetId: stalledAsset.id,
        sourceUrl: `/collection/${stalledAsset.id}`,
        sourceDate: stalledAsset.lastActivityAt,
      })
    }
  }

  if (
    stats.buildableCount > 0 &&
    stats.completionRatePercent < STRUCTURE_INSIGHT_THRESHOLD_PERCENT
  ) {
    const buildingCount = stats.buildStateDistribution.find((d) => d.key === "BUILDING")?.count ?? 0
    const copy = structureCopy({
      completionRatePercent: stats.completionRatePercent,
      completed: stats.completedCount,
      buildable: stats.buildableCount,
      building: buildingCount,
    })
    newInsights.push({
      type: "STRUCTURE_COMPLETION",
      score: stats.completionRatePercent,
      reasonCodes: ["COMPLETION_RATE_LOW"],
      headline: copy.headline,
      body: copy.body,
      sourceUrl: "/",
      sourceDate: now,
    })
  }

  // —— 路线完整度/缺口（确定性计算，随建议快照存档）——
  const routeProgress = await getRouteProgress(db, userId)
  const routeSummaryJson = JSON.stringify(
    routeProgress.map((r) => ({
      routeId: r.routeId,
      title: r.title,
      completionDisplay: r.completionDisplay,
      completionPercent: r.completionPercent,
      ownedProductNodes: r.ownedProductNodes,
      totalProductNodes: r.totalProductNodes,
      nextGap: r.nextGap,
      gaps: r.gaps.slice(0, 5),
    })),
  )

  // —— DeepSeek 润色（可选）：只接收统计/路线缺口/候选及来源；事实保真失败回退确定性文案 ——
  let polishedBy: string | null = null
  // 设置页保存的配置优先（保存后立即生效），环境变量 fallback
  const polishProvider = await resolveReportPolishProvider(() => resolveAdviceConfig(db))
  if (polishProvider && newInsights.length > 0) {
    const budget = await getMonthlyBudgetStatus(db, now)
    if (!budget.exceeded) {
      const polishResult = await polishProvider
        .polish({
          periodLabel: `${formatDateZh(periodStart)} ~ ${formatDateZh(periodEnd)}`,
          stats: {
            currentCollection: stats.currentCollection,
            distinctSku: stats.distinctSku,
            cumulativeCostDisplay: `¥${(stats.cumulativeCostMinor / 100).toFixed(2)}`,
            completionDisplay: stats.completionDisplay,
            stalledCount: stats.stalled.length,
          },
          routeGaps: routeProgress.map((r: RouteProgress) => ({
            route: r.title,
            missing: r.gaps.map((g) => g.label),
            completion: r.completionDisplay,
          })),
          candidates: candidates.slice(0, 3).map((c) => ({
            name: c.productName,
            score: c.score,
            reasons: c.reasonCodes,
            sourceName: c.sourceName,
            sourceUrl: c.sourceUrl,
            sourceDate: formatDateZh(c.announcedAt),
          })),
          insights: newInsights.map((i) => ({
            type: i.type,
            deterministicHeadline: i.headline,
            deterministicBody: i.body,
            facts: {
              score: i.score,
              sourceUrl: i.sourceUrl ?? null,
              sourceDate: i.sourceDate ? formatDateZh(i.sourceDate) : null,
            },
          })),
        })
        .catch(() => null)
      if (polishResult) {
        await recordAiUsage(db, {
          provider: "deepseek",
          model: polishResult.model,
          kind: "REPORT",
          requestId: polishResult.requestId,
          latencyMs: polishResult.latencyMs,
          promptTokens: polishResult.promptTokens,
          completionTokens: polishResult.completionTokens,
        }).catch(() => undefined)
        if (polishResult.state === "SUCCEEDED" && polishResult.polished) {
          newInsights.forEach((ins, i) => {
            const p = polishResult.polished![i]!
            ins.headline = p.headline
            ins.body = p.body
          })
          polishedBy = `deepseek/${polishResult.model}`
        }
      }
    }
  }

  try {
    const insightData = newInsights.map((i, idx) => ({
      type: i.type,
      score: i.score,
      reasonCodes: JSON.stringify(i.reasonCodes),
      headline: i.headline,
      body: i.body,
      productId: i.productId ?? null,
      assetId: i.assetId ?? null,
      sourceUrl: i.sourceUrl ?? null,
      sourceDate: i.sourceDate ?? null,
      eventPriceMinor: i.eventPriceMinor ?? null,
      sortOrder: idx,
    }))

    // —— 写入（批量事务，原子提交）——
    // ① 当日建议存在但快照过期（收藏变化）→ 原位替换：清旧建议/反馈（按 reportId 全量清，
    //    并发替换者写入的同内容建议也会被清后重建，不产生重复）+ 更新行 + 写新建议；
    // ② 不存在 → 创建；并发败者触发唯一键 → 外层 catch 幂等兜底（不产生 500）。
    let report
    if (existingReport) {
      const [, , updated] = await db.$transaction([
        db.insightFeedback.deleteMany({ where: { insight: { reportId: existingReport.id } } }),
        db.insight.deleteMany({ where: { reportId: existingReport.id } }),
        db.insightReport.update({
          where: { id: existingReport.id },
          data: {
            periodStart,
            snapshotVersion,
            generatorVersion: GENERATOR_VERSION,
            routeSummaryJson,
            polishedBy,
            createdAt: now,
            insights: { create: insightData },
          },
          include: { insights: true },
        }),
        db.agentRun.create({
          data: {
            runType: "REPORT_GENERATION",
            userId,
            inputVersion: snapshotVersion,
            status: "OK",
            latencyMs: Date.now() - startedAt,
          },
        }),
      ])
      report = updated
    } else {
      const [created] = await db.$transaction([
        db.insightReport.create({
          data: {
            userId,
            periodStart,
            periodEnd,
            snapshotVersion,
            generatorVersion: GENERATOR_VERSION,
            status: "PUBLISHED",
            routeSummaryJson,
            polishedBy,
            createdAt: now,
            insights: { create: insightData },
          },
          include: { insights: true },
        }),
        db.agentRun.create({
          data: {
            runType: "REPORT_GENERATION",
            userId,
            inputVersion: snapshotVersion,
            status: "OK",
            latencyMs: Date.now() - startedAt,
          },
        }),
      ])
      report = created
    }

    return {
      status: "OK",
      needMoreCount: 0,
      reportId: report.id,
      created: true,
      insightCount: report.insights.length,
      message: `已更新收藏建议（${report.insights.length} 条）`,
      snapshotVersion,
    }
  } catch (e) {
    // 并发竞争：同日建议已被另一请求创建/刷新 → 幂等返回已存在的一期（唯一键冲突不是 500）
    if (isUniqueConstraintViolation(e)) {
      const existing = await db.insightReport.findUnique({
        where: { userId_periodEnd: { userId, periodEnd } },
      })
      if (existing) {
        const count = await db.insight.count({ where: { reportId: existing.id } })
        return {
          status: "OK",
          needMoreCount: 0,
          reportId: existing.id,
          created: false,
          insightCount: count,
          message: "收藏建议已是最新（并发请求已更新）",
          snapshotVersion: existing.snapshotVersion,
        }
      }
    }
    throw e
  }
}

export interface InsightDTO {
  id: string
  type: string
  typeLabel: string
  score: number
  headline: string
  body: string
  reasonCodes: string[]
  productId: string | null
  productName: string | null
  assetId: string | null
  sourceUrl: string | null
  sourceDateLabel: string | null
  myFeedback: string | null
}

export interface RouteSummaryEntry {
  routeId: string
  title: string
  completionDisplay: string
  completionPercent: number
  ownedProductNodes: number
  totalProductNodes: number
  nextGap: { label: string; productKey: string | null; note: string | null } | null
  gaps: { label: string; productKey: string | null; note: string | null }[]
}

export interface ReportView {
  locked: boolean
  currentCount: number
  needMoreCount: number
  report: {
    id: string
    periodStartLabel: string
    periodEndLabel: string
    /** 生成/最近刷新时间（收藏建议的时效标识） */
    generatedAtLabel: string
    generatorVersion: string
    snapshotVersion: string
    insights: InsightDTO[]
    hasRecommendation: boolean
    noRecommendationNotice: string | null
    polishedBy?: string | null
    routeSummary?: RouteSummaryEntry[] | null
  } | null
  canGenerate: boolean
}

export async function getLatestReportView(db: PrismaClient, userId: string, now: Date): Promise<ReportView> {
  const stats = await getDashboardStats(db, userId, now)
  const locked = stats.currentCollection < REPORT_ELIGIBILITY_MIN_ASSETS

  const report = await db.insightReport.findFirst({
    where: { userId },
    orderBy: { periodEnd: "desc" },
    include: {
      insights: {
        orderBy: { sortOrder: "asc" },
        include: { product: true, feedbacks: { where: { userId }, orderBy: { actedAt: "desc" }, take: 1 } },
      },
    },
  })

  // canGenerate：当日无建议，或当日建议的数据快照已过期（收藏确认/状态变化后可刷新）
  let canGenerate = false
  if (!locked) {
    const { periodEnd } = reportPeriod(now)
    if (report?.periodEnd.getTime() === periodEnd.getTime()) {
      canGenerate =
        report.generatorVersion !== GENERATOR_VERSION ||
        report.snapshotVersion !== (await computeCurrentSnapshotVersion(db, userId, now))
    } else {
      canGenerate = true
    }
  }

  if (!report) {
    return {
      locked,
      currentCount: stats.currentCollection,
      needMoreCount: locked ? REPORT_ELIGIBILITY_MIN_ASSETS - stats.currentCollection : 0,
      report: null,
      canGenerate,
    }
  }

  const insights: InsightDTO[] = report.insights.map((i) => ({
    id: i.id,
    type: i.type,
    typeLabel: insightTypeLabel(i.type),
    score: i.score,
    headline: i.headline,
    body: i.body,
    reasonCodes: JSON.parse(i.reasonCodes) as string[],
    productId: i.productId,
    productName: i.product?.canonicalName ?? null,
    assetId: i.assetId,
    sourceUrl: i.sourceUrl,
    sourceDateLabel: i.sourceDate ? formatDateZh(i.sourceDate) : null,
    myFeedback: i.feedbacks[0]?.value ?? null,
  }))

  const hasRecommendation = insights.some((i) => i.type === "NEW_PRODUCT_RECOMMENDATION")

  let routeSummary: RouteSummaryEntry[] | null = null
  if (report.routeSummaryJson) {
    try {
      routeSummary = JSON.parse(report.routeSummaryJson) as RouteSummaryEntry[]
    } catch {
      routeSummary = null
    }
  }

  return {
    locked,
    currentCount: stats.currentCollection,
    needMoreCount: locked ? REPORT_ELIGIBILITY_MIN_ASSETS - stats.currentCollection : 0,
    report: {
      id: report.id,
      periodStartLabel: formatDateZh(report.periodStart),
      periodEndLabel: formatDateZh(report.periodEnd),
      generatedAtLabel: formatDateZh(report.createdAt),
      generatorVersion: report.generatorVersion,
      snapshotVersion: report.snapshotVersion,
      insights,
      hasRecommendation,
      noRecommendationNotice: hasRecommendation ? null : "暂无新品动态：没有可靠且未拥有、未反馈不感兴趣的目录新品事件。",
      polishedBy: report.polishedBy ?? null,
      routeSummary,
    },
    canGenerate,
  }
}

/** 当前数据快照标识（用于判断收藏建议是否过期：收藏确认/状态变化 → 标识变化） */
async function computeCurrentSnapshotVersion(db: PrismaClient, userId: string, now: Date): Promise<string> {
  const [events, preferences, assets, feedbacks] = await db.$transaction([
    db.releaseEvent.findMany({
      where: { datasetVersion: { in: CATALOG_VERSIONS } },
      select: { id: true, announcedAt: true, priceMinor: true, catalogProductId: true },
    }),
    db.userPreference.findMany({ where: { userId, source: "USER" }, select: { kind: true, value: true } }),
    db.collectionAsset.findMany({
      where: { userId },
      select: {
        id: true,
        catalogProductId: true,
        dispositionState: true,
        buildState: true,
        progress: true,
        lastActivityAt: true,
      },
    }),
    db.insightFeedback.findMany({
      where: { userId },
      select: { id: true, value: true, actedAt: true, basisFingerprint: true },
    }),
  ])
  return computeSnapshotVersion({ events, preferences, assets, feedbacks })
}
