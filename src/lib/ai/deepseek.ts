import { z } from "zod"
import { isMoonshotEndpoint } from "./kimi"

/**
 * DeepSeek 收藏建议文案 Provider（base=https://api.deepseek.com、model=deepseek-v4-flash、
 * thinking disabled、JSON Output；只接收程序算好的统计/路线缺口/候选及来源，不接原图，
 * 不得改事实字段）。
 *
 * 事实保真：润色结果必须保留确定性草稿中的全部"事实片段"（数字、金额、日期、链接、
 * 商品名/实体名/来源名）。任一事实缺失即判定越权改写，整批回退确定性文案。
 */

export const DEEPSEEK_MODEL = "deepseek-v4-flash"
const DEFAULT_BASE_URL = "https://api.deepseek.com"
const TIMEOUT_MS = 90_000

export interface PolishInsightInput {
  type: string
  deterministicHeadline: string
  deterministicBody: string
  /** 供润色参考的结构化事实（同样不得被改写） */
  facts: Record<string, string | number | null>
}

export interface ReportPolishInput {
  periodLabel: string
  stats: Record<string, string | number>
  routeGaps: { route: string; missing: string[]; completion: string }[]
  candidates: { name: string; score: number; reasons: string[]; sourceName: string; sourceUrl: string; sourceDate: string }[]
  insights: PolishInsightInput[]
}

export interface ReportPolishOutput {
  state: "SUCCEEDED" | "FAILED"
  polished: { headline: string; body: string }[] | null
  errorCode?: string
  provider: "deepseek"
  model: string
  requestId: string | null
  promptTokens: number | null
  completionTokens: number | null
  latencyMs: number
}

const outputSchema = z.object({
  insights: z
    .array(
      z.object({
        headline: z.string().min(1).max(120),
        body: z.string().min(1).max(1200),
      }),
    )
    .min(1),
})

/** 从确定性文案中提取必须保留的事实片段 */
export function extractFactFragments(text: string): string[] {
  const fragments = new Set<string>()
  for (const m of text.matchAll(/¥[\d,]+(?:\.\d+)?|\d+(?:\.\d+)?%|\d{4}-\d{2}-\d{2}|https?:\/\/[^\s，。）)]+|\/[a-z][\w/-]*|[A-Z]{2,}[\w/.-]*|「([^」]+)」|\d+\s*天/g)) {
    fragments.add(m[1] ?? m[0]!)
  }
  return [...fragments]
}

/** 校验润色结果未丢失任何事实片段 */
export function validateFactPreservation(deterministic: string, polished: string): { ok: boolean; missing: string[] } {
  const missing = extractFactFragments(deterministic).filter((f) => !polished.includes(f))
  return { ok: missing.length === 0, missing }
}

const SYSTEM_PROMPT = `你是个人模型收藏建议的中文文案编辑。你会收到程序确定性计算好的事实（统计数字、路线缺口、候选商品及其来源）与草稿洞察。
规则：
1. 只润色 headline 与 body 的表达，让语气自然、有行动指引；
2. 不得改变、删除或新增任何事实：数字、金额、百分比、日期、链接、商品名、来源名必须原样保留；
3. 每个 draft 附带 protected 数组——其中列出的字符串必须逐字出现在对应输出里（顺序无关，可被自然语句包裹）；
4. 不得给出价格预测或投资建议；结尾不添加免责声明（系统已统一展示）；
4b. 不得出现「匹配分」「SCORE」「推荐指数」「原因代码」等词（系统不再展示评分维度）；
5. 输出严格 JSON：{"insights":[{"headline":"...","body":"..."}]}，条数与输入草稿一一对应。`

interface ChatResponse {
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  choices?: { message?: { content?: string } }[]
}

export async function deepseekPolish(apiKey: string, input: ReportPolishInput, model: string = DEEPSEEK_MODEL, baseUrl: string = DEFAULT_BASE_URL): Promise<ReportPolishOutput> {
  const startedAt = Date.now()
  const base = { provider: "deepseek" as const, model }
  const payload = {
    period: input.periodLabel,
    stats: input.stats,
    route_gaps: input.routeGaps,
    candidates: input.candidates,
    drafts: input.insights.map((i) => ({
      type: i.type,
      headline: i.deterministicHeadline,
      body: i.deterministicBody,
      facts: i.facts,
    })),
  }

  let lastError = "PROVIDER_ERROR"
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        // thinking 字段仅 Moonshot 端点接受（其他 OpenAI 兼容端点会 400）——按端点适配
        body: JSON.stringify({
          model,
          ...(isMoonshotEndpoint(baseUrl) ? { thinking: { type: "disabled" } } : {}),
          temperature: 0.3,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: JSON.stringify({
                ...payload,
                drafts: input.insights.map((i) => ({
                  type: i.type,
                  headline: i.deterministicHeadline,
                  body: i.deterministicBody,
                  facts: i.facts,
                  protected: [
                    ...new Set([...extractFactFragments(i.deterministicHeadline), ...extractFactFragments(i.deterministicBody)]),
                  ],
                })),
              }),
            },
          ],
        }),
        signal: controller.signal,
      })
      const requestId = res.headers.get("x-request-id") ?? res.headers.get("request-id")
      if (!res.ok) {
        lastError = res.status === 401 ? "AUTH_FAILED" : res.status === 429 ? "RATE_LIMITED" : res.status >= 500 ? "PROVIDER_ERROR" : "PROVIDER_REJECTED"
        if (attempt === 1 && (res.status === 429 || res.status >= 500)) continue
        return { state: "FAILED", polished: null, errorCode: lastError, ...base, requestId, promptTokens: null, completionTokens: null, latencyMs: Date.now() - startedAt }
      }
      const json = (await res.json()) as ChatResponse
      const content = json.choices?.[0]?.message?.content ?? ""
      let parsed: z.infer<typeof outputSchema> | null = null
      try {
        parsed = outputSchema.parse(JSON.parse(content))
      } catch {
        parsed = null
      }
      if (!parsed || parsed.insights.length !== input.insights.length) {
        return { state: "FAILED", polished: null, errorCode: "INVALID_POLISH", ...base, requestId, promptTokens: json.usage?.prompt_tokens ?? null, completionTokens: json.usage?.completion_tokens ?? null, latencyMs: Date.now() - startedAt }
      }
      // 事实保真校验：任一洞察丢失事实片段 → 整批拒绝（回退确定性文案）
      for (let i = 0; i < input.insights.length; i++) {
        const draft = input.insights[i]!
        const out = parsed.insights[i]!
        const h = validateFactPreservation(draft.deterministicHeadline, out.headline)
        const b = validateFactPreservation(draft.deterministicBody, out.body)
        if (!h.ok || !b.ok) {
          return { state: "FAILED", polished: null, errorCode: "FACT_VIOLATION", ...base, requestId, promptTokens: json.usage?.prompt_tokens ?? null, completionTokens: json.usage?.completion_tokens ?? null, latencyMs: Date.now() - startedAt }
        }
      }
      return {
        state: "SUCCEEDED",
        polished: parsed.insights.map((i) => ({ headline: i.headline, body: i.body })),
        ...base,
        requestId,
        promptTokens: json.usage?.prompt_tokens ?? null,
        completionTokens: json.usage?.completion_tokens ?? null,
        latencyMs: Date.now() - startedAt,
      }
    } catch (e) {
      const aborted = e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")
      lastError = aborted ? "TIMEOUT" : "PROVIDER_UNREACHABLE"
      if (attempt === 1) continue
    } finally {
      clearTimeout(timer)
    }
  }
  return { state: "FAILED", polished: null, errorCode: lastError, ...base, requestId: null, promptTokens: null, completionTokens: null, latencyMs: Date.now() - startedAt }
}

export interface ReportPolishProvider {
  readonly name: "deepseek"
  readonly model: string
  polish(input: ReportPolishInput): Promise<ReportPolishOutput>
}

export function createDeepSeekPolishProvider(apiKey: string, model: string = DEEPSEEK_MODEL, baseUrl: string = DEFAULT_BASE_URL): ReportPolishProvider {
  return {
    name: "deepseek",
    model,
    polish: (input) => deepseekPolish(apiKey, input, model, baseUrl),
  }
}
