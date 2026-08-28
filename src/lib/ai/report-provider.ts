import type { ReportPolishInput, ReportPolishProvider } from "./deepseek"
import { createDeepSeekPolishProvider } from "./deepseek"

/**
 * 周报润色 Provider 选择：DeepSeek Key 配置（设置页优先，环境变量 fallback）且非 E2E
 * 测试服务器时启用。E2E_MODE=1 强制确定性模板（普通测试不得联网）。
 */

/** 同步版（无设置页配置时使用；E2E/无 Key 一律 null） */
export function getReportPolishProvider(): ReportPolishProvider | null {
  if (process.env.E2E_MODE === "1") return null
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) return null
  return createDeepSeekPolishProvider(key)
}

/** 解析版（设置页保存的配置优先，环境变量 fallback；保存后立即生效） */
export async function resolveReportPolishProvider(
  getAdviceConfig: () => Promise<{ apiKey: string | null; model: string; baseUrl: string }>,
): Promise<ReportPolishProvider | null> {
  if (process.env.E2E_MODE === "1") return null
  const config = await getAdviceConfig().catch(() => null)
  if (!config?.apiKey) return null
  return createDeepSeekPolishProvider(config.apiKey, config.model, config.baseUrl)
}

export function reportPolishLabel(provider: ReportPolishProvider | null): string | null {
  return provider ? `deepseek/${provider.model}` : null
}

export type { ReportPolishInput, ReportPolishProvider }
