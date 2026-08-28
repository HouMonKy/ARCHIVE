import { formatCnyFromMinor } from "../format"

/**
 * 文案组织层（PRD §8.3：模板或 LLM 只负责把已验证事实组织成解释，不决定事实与候选集合）。
 * 本 Demo 使用确定性模板；所有事实（分数、理由码、商品、日期）由规则层传入。
 */

export interface RecommendationCopyInput {
  productName: string
  score: number
  reasonCodes: string[]
  eventPriceMinor: number | null
  budgetMinor: number | null
  sourceName: string
  sourceUrl: string
  sourceDateLabel: string
}

const REASON_LABELS: Record<string, string> = {
  PREF_CATEGORY: "品类偏好 +15",
  PREF_GRADE: "等级偏好 +15",
  PREF_ROUTE: "路线偏好 +10",
  COMPLEMENT: "路线收藏互补 +25",
  BUDGET_OK: "事件价不高于月预算 +15",
  RECENT_RELEASE: "近 30 日发布 +10",
  POSITIVE_FEEDBACK: "近期正向反馈 +10",
}

export function recommendationCopy(input: RecommendationCopyInput): { headline: string; body: string } {
  const reasons = input.reasonCodes.map((c) => REASON_LABELS[c] ?? c)
  const priceNote =
    input.eventPriceMinor != null
      ? `事件价 ${formatCnyFromMinor(input.eventPriceMinor)}${input.budgetMinor != null ? "（月预算 " + formatCnyFromMinor(input.budgetMinor) + " 内）" : ""}`
      : "事件未提供价格"
  const headline = `新品动态：${input.productName}`
  // 新需求：不显示匹配分与原因代码——只保留价格事实与来源
  const body = [`${priceNote}。`, `来源：${input.sourceName}（${input.sourceDateLabel}），可查看事件详情。`].join("")
  void reasons
  return { headline, body }
}

export interface StalledCopyInput {
  assetName: string
  assetId: string
  days: number
  progress: number
  lastActivityLabel: string
}

export function stalledCopy(input: StalledCopyInput): { headline: string; body: string } {
  const headline = `制作推进：${input.assetName} 已 ${input.days} 天无进展`
  const body = `该实体自 ${input.lastActivityLabel} 起处于制作中（进度 ${input.progress}%），连续超过 14 天没有状态、进度或日志变化。建议更新进度或安排制作时间。`
  return { headline, body }
}

export interface StructureCopyInput {
  completionRatePercent: number
  completed: number
  buildable: number
  building: number
}

export function structureCopy(input: StructureCopyInput): { headline: string; body: string } {
  const headline = `路线补齐：制作完成率 ${input.completionRatePercent}%`
  const body = `当前可制作实体 ${input.buildable} 件中已完成 ${input.completed} 件（完成率 ${input.completionRatePercent}%），另有 ${input.building} 件制作中。优先推进制作中的模型可以更快降低积压。`
  return { headline, body }
}
