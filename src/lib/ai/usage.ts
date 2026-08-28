import type { PrismaClient } from "@prisma/client"

/**
 * AI 用量与预算（任务书：Moonshot + DeepSeek 合计每自然月硬上限 ¥50，¥35 预警，
 * 超限改手动识别/确定性周报）。
 *
 * 成本为**估算**：按公开定价锚点折算人民币（分），仅用于预算熔断，不作为账单依据。
 * - kimi-k2.6：输入 ¥4/百万 token、输出 ¥16/百万 token（Moonshot 平台 K2 系公开价锚点）
 * - deepseek-v4-flash：输入 ¥1/百万 token、输出 ¥4/百万 token（DeepSeek flash 档公开价锚点）
 */

export const BUDGET_HARD_LIMIT_MINOR = 5000 // ¥50
export const BUDGET_WARN_LIMIT_MINOR = 3500 // ¥35

export interface ModelPricing {
  inputMinorPerMTok: number
  outputMinorPerMTok: number
}

const PRICING: Record<string, ModelPricing> = {
  "kimi-k2.6": { inputMinorPerMTok: 400, outputMinorPerMTok: 1600 },
  "deepseek-v4-flash": { inputMinorPerMTok: 100, outputMinorPerMTok: 400 },
}

export function estimateCostMinor(model: string, promptTokens: number | null, completionTokens: number | null): number {
  const pricing = PRICING[model]
  if (!pricing) return 0 // 未知模型不计费（宁可低估也不编造）
  const input = Math.ceil(((promptTokens ?? 0) / 1_000_000) * pricing.inputMinorPerMTok)
  const output = Math.ceil(((completionTokens ?? 0) / 1_000_000) * pricing.outputMinorPerMTok)
  return Math.max(0, Math.min(input + output, 1_000_000))
}

export interface UsageRecordInput {
  provider: "moonshot" | "deepseek"
  model: string
  kind: "RECOGNITION" | "REPORT" | "EVAL"
  requestId?: string | null
  latencyMs: number
  promptTokens?: number | null
  completionTokens?: number | null
}

export async function recordAiUsage(db: PrismaClient, input: UsageRecordInput): Promise<number> {
  const costMinor = estimateCostMinor(input.model, input.promptTokens ?? null, input.completionTokens ?? null)
  await db.aiUsageLog.create({
    data: {
      provider: input.provider,
      model: input.model,
      kind: input.kind,
      requestId: input.requestId ?? null,
      latencyMs: input.latencyMs,
      promptTokens: input.promptTokens ?? null,
      completionTokens: input.completionTokens ?? null,
      costMinor,
    },
  })
  return costMinor
}

export interface MonthlyBudgetStatus {
  monthKey: string // Asia/Shanghai 自然月，如 2026-08
  usedMinor: number
  warnMinor: number
  hardLimitMinor: number
  warn: boolean
  exceeded: boolean
}

/** 当月（Asia/Shanghai）已用成本 */
export async function getMonthlyBudgetStatus(db: PrismaClient, now: Date): Promise<MonthlyBudgetStatus> {
  // Asia/Shanghai 自然月起点（UTC 表示）
  const shifted = new Date(now.getTime() + 8 * 3600_000)
  const monthKey = shifted.toISOString().slice(0, 7)
  const monthStartUtc = new Date(`${monthKey}-01T00:00:00+08:00`)
  const monthEndUtc = new Date(monthStartUtc.getTime())
  monthEndUtc.setUTCMonth(monthEndUtc.getUTCMonth() + 1)

  const agg = await db.aiUsageLog.aggregate({
    _sum: { costMinor: true },
    where: { createdAt: { gte: monthStartUtc, lt: monthEndUtc } },
  })
  const usedMinor = agg._sum.costMinor ?? 0
  return {
    monthKey,
    usedMinor,
    warnMinor: BUDGET_WARN_LIMIT_MINOR,
    hardLimitMinor: BUDGET_HARD_LIMIT_MINOR,
    warn: usedMinor >= BUDGET_WARN_LIMIT_MINOR,
    exceeded: usedMinor >= BUDGET_HARD_LIMIT_MINOR,
  }
}
