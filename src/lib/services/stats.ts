import type { Prisma, PrismaClient } from "@prisma/client"

/** PrismaClient 或事务客户端（$transaction 回调参数），两者模型委托结构兼容 */
export type DbClient = PrismaClient | Prisma.TransactionClient
import { addDays, diffDays } from "../clock"
import { normalizeCustomName } from "../format"

/**
 * PRD §7 统计口径：
 * - 收藏数量 = ACTIVE 且未归档的实体数；意向不计入；
 * - 不同 SKU = 上述实体中目录商品按 catalog_product_id 去重 + 自定义商品按规范化名称去重；
 * - 累计购入成本 = 已填写购买价之和（缺失价不计 0，单独显示缺价件数）；
 * - 完成率 = COMPLETED / (UNOPENED+OPENED+BUILDING+COMPLETED)，只算可制作实体；
 * - 制作停滞 = BUILDING 且连续 14 天无状态/进度/日志变化。
 */

export interface StatsAssetRow {
  id: string
  catalogProductId: string | null
  customName: string | null
  customBrand: string | null
  dispositionState: string
  archivedAt: Date | null
  buildState: string
  progress: number
  purchasePriceMinor: number | null
  lastActivityAt: Date
  product: { brand: string; grade: string; canonicalName: string; line: string | null } | null
}

export interface DistributionItem {
  key: string
  label: string
  count: number
  href: string
}

export interface StalledItem {
  assetId: string
  name: string
  days: number
}

export interface NextStepItem {
  kind: "STALLED" | "MISSING_PRICE" | "UNOPENED"
  assetId: string
  title: string
  detail: string
  href: string
}

export interface DashboardStats {
  totalRecords: number
  currentCollection: number
  distinctSku: number
  cumulativeCostMinor: number
  missingPriceCount: number
  buildableCount: number
  completedCount: number
  completionRatePercent: number
  completionDisplay: string
  buildStateDistribution: DistributionItem[]
  brandDistribution: DistributionItem[]
  gradeDistribution: DistributionItem[]
  /** 系列线分布（机库索引轨的系列编码） */
  lineDistribution: DistributionItem[]
  stalled: StalledItem[]
  nextSteps: NextStepItem[]
  isEmpty: boolean
}

export const STALL_THRESHOLD_DAYS = 14

export function assetDisplayName(a: StatsAssetRow): string {
  return a.product?.canonicalName ?? a.customName ?? "未命名实体"
}

export function computeStats(assets: StatsAssetRow[], now: Date): DashboardStats {
  const current = assets.filter((a) => a.dispositionState === "ACTIVE" && a.archivedAt == null)

  const catalogIds = new Set<string>()
  const customNames = new Set<string>()
  for (const a of current) {
    if (a.catalogProductId) catalogIds.add(a.catalogProductId)
    else if (a.customName) customNames.add(normalizeCustomName(a.customName))
  }

  const cumulativeCostMinor = current.reduce((sum, a) => sum + (a.purchasePriceMinor ?? 0), 0)
  const missingPriceCount = current.filter((a) => a.purchasePriceMinor == null).length

  const buildable = current.filter((a) =>
    ["UNOPENED", "OPENED", "BUILDING", "COMPLETED"].includes(a.buildState),
  )
  const completed = current.filter((a) => a.buildState === "COMPLETED")
  const completionRatePercent =
    buildable.length === 0 ? 0 : Math.round((completed.length / buildable.length) * 100)

  const buildStateOrder = ["UNOPENED", "OPENED", "BUILDING", "COMPLETED", "NOT_APPLICABLE"]
  const buildStateDistribution: DistributionItem[] = buildStateOrder
    .map((key) => ({
      key,
      label: key,
      count: current.filter((a) => a.buildState === key).length,
      href: `/collection?status=${key}`,
    }))
    .filter((d) => d.count > 0)

  const brandCounts = new Map<string, number>()
  for (const a of current) {
    const brand = a.product?.brand ?? a.customBrand ?? "其他"
    brandCounts.set(brand, (brandCounts.get(brand) ?? 0) + 1)
  }
  const brandDistribution: DistributionItem[] = [...brandCounts.entries()]
    .map(([brand, count]) => ({ key: brand, label: brand, count, href: `/collection?brand=${encodeURIComponent(brand)}` }))
    .sort((x, y) => y.count - x.count || x.label.localeCompare(y.label))

  const gradeCounts = new Map<string, number>()
  for (const a of current) {
    const grade = a.product?.grade ?? "其他"
    gradeCounts.set(grade, (gradeCounts.get(grade) ?? 0) + 1)
  }
  const gradeDistribution: DistributionItem[] = [...gradeCounts.entries()]
    .map(([grade, count]) => ({ key: grade, label: grade, count, href: `/collection?grade=${encodeURIComponent(grade)}` }))
    .sort((x, y) => y.count - x.count || x.label.localeCompare(y.label))

  const lineCounts = new Map<string, number>()
  for (const a of current) {
    const line = a.product?.line ?? "自定义"
    lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1)
  }
  const lineDistribution: DistributionItem[] = [...lineCounts.entries()]
    .map(([line, count]) => ({ key: line, label: line, count, href: `/collection?line=${encodeURIComponent(line)}` }))
    .sort((x, y) => y.count - x.count || x.label.localeCompare(y.label))

  const stalled: StalledItem[] = current
    .filter((a) => a.buildState === "BUILDING" && diffDays(a.lastActivityAt, now) >= STALL_THRESHOLD_DAYS)
    .map((a) => ({ assetId: a.id, name: assetDisplayName(a), days: diffDays(a.lastActivityAt, now) }))
    .sort((x, y) => y.days - x.days)

  const nextSteps: NextStepItem[] = []
  for (const s of stalled.slice(0, 2)) {
    nextSteps.push({
      kind: "STALLED",
      assetId: s.assetId,
      title: `${s.name} 已停滞 ${s.days} 天`,
      detail: "制作中超过 14 天无进度变化，建议安排时间推进或调整状态",
      href: `/collection/${s.assetId}`,
    })
  }
  const missingPrice = current.find((a) => a.purchasePriceMinor == null)
  if (missingPrice) {
    nextSteps.push({
      kind: "MISSING_PRICE",
      assetId: missingPrice.id,
      title: `${assetDisplayName(missingPrice)} 缺少购入价`,
      detail: "补全价格后，累计购入成本口径更完整（缺失价不计为 0 元）",
      href: `/collection/${missingPrice.id}`,
    })
  }
  const oldestUnopened = current
    .filter((a) => a.buildState === "UNOPENED")
    .sort((x, y) => x.lastActivityAt.getTime() - y.lastActivityAt.getTime())[0]
  if (nextSteps.length < 3 && oldestUnopened && stalled.length === 0) {
    nextSteps.push({
      kind: "UNOPENED",
      assetId: oldestUnopened.id,
      title: `${assetDisplayName(oldestUnopened)} 尚未开盒`,
      detail: "积压最久的未开盒实体，可考虑纳入制作计划",
      href: `/collection/${oldestUnopened.id}`,
    })
  }

  return {
    totalRecords: assets.length,
    currentCollection: current.length,
    distinctSku: catalogIds.size + customNames.size,
    cumulativeCostMinor,
    missingPriceCount,
    buildableCount: buildable.length,
    completedCount: completed.length,
    completionRatePercent,
    completionDisplay: buildable.length === 0 ? "—" : `${completionRatePercent}%（${completed.length}/${buildable.length}）`,
    buildStateDistribution,
    brandDistribution,
    gradeDistribution,
    lineDistribution,
    stalled,
    nextSteps: nextSteps.slice(0, 3),
    isEmpty: current.length === 0,
  }
}

export async function getStatsAssetRows(db: DbClient, userId: string): Promise<StatsAssetRow[]> {
  return db.collectionAsset.findMany({
    where: { userId },
    orderBy: { lastActivityAt: "desc" },
    select: {
      id: true,
      catalogProductId: true,
      customName: true,
      customBrand: true,
      dispositionState: true,
      archivedAt: true,
      buildState: true,
      progress: true,
      purchasePriceMinor: true,
      lastActivityAt: true,
      product: { select: { brand: true, grade: true, canonicalName: true, line: true } },
    },
  })
}

export async function getDashboardStats(db: DbClient, userId: string, now: Date): Promise<DashboardStats> {
  const rows = await getStatsAssetRows(db, userId)
  return computeStats(rows, now)
}

/** 结构洞察使用的完成率阈值（PRD §19 演示规则：33% < 50% 触发） */
export const STRUCTURE_INSIGHT_THRESHOLD_PERCENT = 50

export function daysStalledWindow(now: Date): Date {
  return addDays(now, -STALL_THRESHOLD_DAYS)
}
