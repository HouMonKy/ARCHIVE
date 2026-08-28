import { parseVisionExtraction, type VisionExtractionResult } from "./vision"

/**
 * Kimi 视觉识别 Provider（任务书：MOONSHOT base=https://api.moonshot.cn/v1、model=kimi-k2.6、
 * thinking disabled、图片输入 + JSON Schema 语义（json_object + zod 契约校验））。
 * 超时只重试 1 次；不跨模型降级。
 */

export const KIMI_MODEL = "kimi-k2.6"
const DEFAULT_BASE_URL = "https://api.moonshot.cn/v1"
const TIMEOUT_MS = 90_000

/**
 * 厂商适配（设置页允许任意 OpenAI 兼容端点）：
 * - Moonshot：chat/completions 支持 thinking 字段与 builtin_function $web_search；
 * - 其他兼容端点（如 DeepSeek）：thinking 会 400、builtin_function 不支持——
 *   web search 走其 Responses API（tools:[{type:"web_search"}]）。
 */
export function isMoonshotEndpoint(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase().includes("moonshot")
  } catch {
    return false
  }
}

/** chat/completions 请求体：按端点剥离非标字段（thinking 仅 Moonshot 接受） */
function chatCompletionsBody(baseUrl: string, body: Record<string, unknown>): Record<string, unknown> {
  if (isMoonshotEndpoint(baseUrl)) return body
  const { thinking, ...rest } = body as { thinking?: unknown } & Record<string, unknown>
  void thinking
  return rest
}

const SYSTEM_PROMPT = `你是模型收藏识别助手。分析盒子/商品照片，输出严格的 JSON 对象（不要 markdown 包裹）。
要求：
- name 必须尽量转写包装上印刷的官方全名（Bandai 为日文原名，含等级与比例前缀如 "MG 1/100"、套装 Ver. 后缀；LEGO 为英文名）；
- grade 从包装印刷的等级标识读取（MG/RG/HG/HGUC/PG/MGEX/SD/EG/FM/TECHNIC 等），不要凭比例猜测；
- LEGO 必须把主题写入 series（如 Marvel、Harry Potter、Stranger Things、Technic），不要把所有 LEGO 都写成 TECHNIC；包装未印等级时 grade 留空；
- scale 填包装印刷的比例（如 "1/100"、"1/144"），未知为空；
- modelNumber 填机体型号（如 MSZ-006、RX-93）或套装编号（如 42143），从包装印刷文字读取，未知为空；
- visibleText 转写包装上可见的型号/全名/标语（保留原文，不要省略型号）。
JSON 结构：{"brand":"品牌（Bandai/万代、LEGO/乐高，未知则照实写）","name":"官方全名","series":"所属作品/系列","grade":"等级","scale":"比例","modelNumber":"型号或编号","visibleText":"包装可见关键文字","confidence":0到1的小数,"evidence":"判断依据（中文一两句）"}
不得输出 productId 或任何数据库主键；只描述可见事实，不确定的字段留空。`

export interface KimiVisionInput {
  imageDataUrl: string
  mimeType: string
}

interface ChatUsage {
  prompt_tokens?: number
  completion_tokens?: number
}

interface ChatResponse {
  model?: string
  usage?: ChatUsage
  choices?: { message?: { content?: string } }[]
  error?: { message?: string }
}

async function callOnce(apiKey: string, input: KimiVisionInput, model: string, baseUrl: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(
        chatCompletionsBody(baseUrl, {
          model,
          thinking: { type: "disabled" },
          // kimi-k2.6 仅允许 temperature=0.6（实测 400 invalid temperature），不传使用默认；
          // JSON 输出：json_object（提示词已含 "JSON" 字样，DeepSeek 同样接受）
          response_format: { type: "json_object" },
          messages: [
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: input.imageDataUrl } },
                { type: "text", text: SYSTEM_PROMPT },
              ],
            },
          ],
        }),
      ),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

export async function kimiExtract(apiKey: string, input: KimiVisionInput, model: string = KIMI_MODEL, baseUrl: string = DEFAULT_BASE_URL): Promise<VisionExtractionResult> {
  const startedAt = Date.now()
  const base = {
    provider: "moonshot",
    providerVersion: `kimi/${model}`,
  }

  let lastError = "PROVIDER_ERROR"
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await callOnce(apiKey, input, model, baseUrl)
      const requestId = res.headers.get("x-request-id") ?? res.headers.get("request-id")
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        lastError = res.status === 401 ? "AUTH_FAILED" : res.status === 429 ? "RATE_LIMITED" : res.status >= 500 ? "PROVIDER_ERROR" : "PROVIDER_REJECTED"
        // 429/5xx 允许重试一次；4xx（鉴权/参数）不重试
        if (attempt === 1 && (res.status === 429 || res.status >= 500)) {
          continue
        }
        void text
        return {
          state: "FAILED",
          extraction: null,
          errorCode: lastError,
          ...base,
          promptTokens: null,
          completionTokens: null,
          requestId,
          latencyMs: Date.now() - startedAt,
        }
      }
      const json = (await res.json()) as ChatResponse
      const content = json.choices?.[0]?.message?.content ?? ""
      const extraction = parseVisionExtraction(content)
      if (!extraction) {
        return {
          state: "FAILED",
          extraction: null,
          errorCode: "INVALID_EXTRACTION",
          ...base,
          promptTokens: json.usage?.prompt_tokens ?? null,
          completionTokens: json.usage?.completion_tokens ?? null,
          requestId,
          latencyMs: Date.now() - startedAt,
        }
      }
      return {
        state: "SUCCEEDED",
        extraction,
        ...base,
        promptTokens: json.usage?.prompt_tokens ?? null,
        completionTokens: json.usage?.completion_tokens ?? null,
        requestId,
        latencyMs: Date.now() - startedAt,
      }
    } catch (e) {
      const aborted = e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")
      lastError = aborted ? "TIMEOUT" : "PROVIDER_UNREACHABLE"
      // 超时/网络错误重试一次（任务书：超时只重试 1 次）
      if (attempt === 1) continue
    }
  }
  return {
    state: "FAILED",
    extraction: null,
    errorCode: lastError,
    ...base,
    promptTokens: null,
    completionTokens: null,
    requestId: null,
    latencyMs: Date.now() - startedAt,
  }
}

export interface VisionRecognitionProvider {
  readonly name: "kimi"
  readonly model: string
  readonly isFixture: false
  extract(input: KimiVisionInput): Promise<VisionExtractionResult>
}

export function createKimiVisionProvider(apiKey: string, model: string = KIMI_MODEL, baseUrl: string = DEFAULT_BASE_URL): VisionRecognitionProvider {
  return {
    name: "kimi",
    model,
    isFixture: false,
    extract: (input) => kimiExtract(apiKey, input, model, baseUrl),
  }
}

// ———— $web_search 官网搜索（Moonshot 内置联网搜索工具） ————

export interface KimiWebSearchInput {
  brand: string
  name: string
  series?: string
  grade?: string
  scale?: string
  modelNumber?: string
  visibleText?: string
}

export interface WebSearchCandidate {
  officialName: string
  productCode: string | null
  pageUrl: string
  imageUrl: string | null
  sourceDomain: string
  snippet: string | null
}

export interface KimiWebSearchOutput {
  state: "SUCCEEDED" | "FAILED"
  candidates: WebSearchCandidate[]
  searchQueries: string[]
  errorCode?: string
  promptTokens: number | null
  completionTokens: number | null
  latencyMs: number
}

const SEARCH_TIMEOUT_MS = 120_000
const MAX_TOOL_ROUNDS = 8

function searchSystemPrompt(brand: string): string {
  const domains =
    brand.toLowerCase() === "lego"
      ? "www.lego.com"
      : "bandai-hobby.net、manual.bandai-hobby.net、p-bandai.jp"
  return `你是万代/乐高模型官网查证助手。用户会给出 AI 从商品照片提取的信息。你的任务是使用联网搜索在官方域名（${domains}）内查找该商品的官方页面。

要求：
1. 自己构造 2~4 个不同角度的搜索词（利用机体型号/套装编号、作品名、等级与比例的组合，例如「MG 1/100 MSN-04 サザビー Ver.Ka」「site:manual.bandai-hobby.net サザビー」「bandai-hobby.net サザビー」），不要只照抄包装简写；
2. 只收录官方域名（${domains}）的页面；同款商品的不同官方页面（商品页/说明书页）都可收录；
3. 不得编造 URL——只返回搜索结果中真实存在的页面；
4. 官方完整商品名以页面实际标题为准；imageUrl 只接受官方域名下的商品图片直链，没有就留空。
输出严格 JSON（不要 markdown 包裹，不要多余文字）：
{"candidates":[{"officialName":"官方完整商品名","productCode":"官网品番（页面上的品番数字，没有则空串）","pageUrl":"官网商品页完整 URL","imageUrl":"官网商品图片直链 URL 或空串","sourceDomain":"页面域名","snippet":"一句话依据"}],"searchQueries":["实际使用的搜索词"]}
候选按相关度排序，最多 5 个；完全没有官方页面则 candidates=[]（不要用非官方站点或电商页顶替）。`
}

interface SearchChatResponse {
  choices?: { finish_reason?: string | null; message?: { role?: string; content?: string; tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[] } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string }
}

export function parseSearchJson(content: string): { candidates: WebSearchCandidate[]; searchQueries: string[] } | null {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    const m = content.match(/\{[\s\S]*\}/)
    if (!m) return null
    try {
      raw = JSON.parse(m[0]!)
    } catch {
      return null
    }
  }
  if (raw == null || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj.candidates)) return null
  const candidates: WebSearchCandidate[] = []
  for (const c of obj.candidates) {
    if (c == null || typeof c !== "object") continue
    const o = c as Record<string, unknown>
    const pageUrl = typeof o.pageUrl === "string" ? o.pageUrl.trim() : ""
    if (!/^https:\/\//.test(pageUrl)) continue
    candidates.push({
      officialName: typeof o.officialName === "string" ? o.officialName.trim().slice(0, 200) : "",
      productCode: typeof o.productCode === "string" && o.productCode.trim() ? o.productCode.trim().slice(0, 40) : null,
      pageUrl,
      imageUrl: typeof o.imageUrl === "string" && /^https:\/\//.test(o.imageUrl) ? o.imageUrl.trim() : null,
      sourceDomain: typeof o.sourceDomain === "string" ? o.sourceDomain.trim() : "",
      snippet: typeof o.snippet === "string" ? o.snippet.trim().slice(0, 300) : null,
    })
  }
  const searchQueries = Array.isArray(obj.searchQueries)
    ? obj.searchQueries.filter((q): q is string => typeof q === "string").slice(0, 8)
    : []
  return { candidates, searchQueries }
}

/**
 * Kimi $web_search 官网搜索：工具循环（builtin_function 由 Moonshot 服务端执行——
 * tool_calls 返回的 arguments 需原样回传，模型随后执行真实联网搜索并给出最终回答）。
 * 输出候选仅为模型声明，调用方必须逐条验证页面真实性（official-search 服务负责）。
 */
export async function kimiWebSearch(apiKey: string, model: string, input: KimiWebSearchInput, baseUrl: string = DEFAULT_BASE_URL): Promise<KimiWebSearchOutput> {
  // 厂商适配：Moonshot 走 chat/completions builtin_function 工具循环；
  // 其他 OpenAI 兼容端点（如 DeepSeek）走其 Responses API 的内置 web_search 工具
  if (isMoonshotEndpoint(baseUrl)) {
    return kimiWebSearchViaChat(apiKey, model, input, baseUrl)
  }
  return kimiWebSearchViaResponses(apiKey, model, input, baseUrl)
}

/** Moonshot：chat/completions + builtin_function $web_search 工具循环 */
async function kimiWebSearchViaChat(apiKey: string, model: string, input: KimiWebSearchInput, baseUrl: string): Promise<KimiWebSearchOutput> {
  const startedAt = Date.now()
  const messages: Record<string, unknown>[] = [
    { role: "system", content: searchSystemPrompt(input.brand) },
    {
      role: "user",
      content: `AI 识别结果：${JSON.stringify({
        brand: input.brand,
        name: input.name,
        series: input.series ?? "",
        grade: input.grade ?? "",
        scale: input.scale ?? "",
        modelNumber: input.modelNumber ?? "",
        visibleText: (input.visibleText ?? "").slice(0, 300),
      })}\n请在官方域名内搜索该商品的官方页面。`,
    },
  ]
  let promptTokens = 0
  let completionTokens = 0
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          thinking: { type: "disabled" },
          messages,
          tools: [{ type: "builtin_function", function: { name: "$web_search" } }],
        }),
        signal: controller.signal,
      })
    } catch {
      return {
        state: "FAILED",
        candidates: [],
        searchQueries: [],
        errorCode: "SEARCH_UNREACHABLE",
        promptTokens: null,
        completionTokens: null,
        latencyMs: Date.now() - startedAt,
      }
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) {
      const status = res.status
      return {
        state: "FAILED",
        candidates: [],
        searchQueries: [],
        errorCode: status === 401 ? "AUTH_FAILED" : status === 429 ? "RATE_LIMITED" : status >= 500 ? "SEARCH_PROVIDER_ERROR" : "SEARCH_REJECTED",
        promptTokens: null,
        completionTokens: null,
        latencyMs: Date.now() - startedAt,
      }
    }
    const json = (await res.json()) as SearchChatResponse
    const choice = json.choices?.[0]
    promptTokens += json.usage?.prompt_tokens ?? 0
    completionTokens += json.usage?.completion_tokens ?? 0
    const toolCalls = choice?.message?.tool_calls
    if (choice?.finish_reason === "tool_calls" && toolCalls && toolCalls.length > 0) {
      messages.push(choice.message as Record<string, unknown>)
      for (const tc of toolCalls) {
        // builtin_function：arguments 原样回传，由 Moonshot 服务端执行搜索
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          name: tc.function.name,
          content: tc.function.arguments,
        })
      }
      continue
    }
    const content = choice?.message?.content ?? ""
    const parsed = parseSearchJson(content)
    if (!parsed) {
      return {
        state: "FAILED",
        candidates: [],
        searchQueries: [],
        errorCode: "INVALID_SEARCH_RESULT",
        promptTokens,
        completionTokens,
        latencyMs: Date.now() - startedAt,
      }
    }
    return {
      state: "SUCCEEDED",
      candidates: parsed.candidates,
      searchQueries: parsed.searchQueries,
      promptTokens,
      completionTokens,
      latencyMs: Date.now() - startedAt,
    }
  }
  return {
    state: "FAILED",
    candidates: [],
    searchQueries: [],
    errorCode: "SEARCH_ROUNDS_EXCEEDED",
    promptTokens,
    completionTokens,
    latencyMs: Date.now() - startedAt,
  }
}

/** Responses API（DeepSeek 等兼容端点）：内置 web_search 工具——服务端自动执行搜索轮次 */
async function kimiWebSearchViaResponses(apiKey: string, model: string, input: KimiWebSearchInput, baseUrl: string): Promise<KimiWebSearchOutput> {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        tools: [{ type: "web_search" }],
        input: [
          { role: "system", content: searchSystemPrompt(input.brand) },
          {
            role: "user",
            content: `AI 识别结果：${JSON.stringify({
              brand: input.brand,
              name: input.name,
              series: input.series ?? "",
              grade: input.grade ?? "",
              scale: input.scale ?? "",
              modelNumber: input.modelNumber ?? "",
              visibleText: (input.visibleText ?? "").slice(0, 300),
            })}\n请在官方域名内搜索该商品的官方页面。`,
          },
        ],
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const status = res.status
      return {
        state: "FAILED",
        candidates: [],
        searchQueries: [],
        errorCode: status === 401 ? "AUTH_FAILED" : status === 429 ? "RATE_LIMITED" : status >= 500 ? "SEARCH_PROVIDER_ERROR" : "SEARCH_REJECTED",
        promptTokens: null,
        completionTokens: null,
        latencyMs: Date.now() - startedAt,
      }
    }
    const json = (await res.json()) as {
      status?: string
      output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }>; action?: { queries?: string[] } }>
      usage?: { input_tokens?: number; output_tokens?: number }
    }
    // 提取最终消息文本与搜索词
    let finalText = ""
    const searchQueries: string[] = []
    for (const item of json.output ?? []) {
      if (item.type === "message") {
        for (const c of item.content ?? []) finalText += c.text ?? ""
      }
      if (item.type === "web_search_call" && Array.isArray(item.action?.queries)) {
        searchQueries.push(...item.action!.queries!)
      }
    }
    const parsed = parseSearchJson(finalText)
    if (!parsed) {
      return {
        state: "FAILED",
        candidates: [],
        searchQueries: [],
        errorCode: "INVALID_SEARCH_RESULT",
        promptTokens: json.usage?.input_tokens ?? null,
        completionTokens: json.usage?.output_tokens ?? null,
        latencyMs: Date.now() - startedAt,
      }
    }
    return {
      state: "SUCCEEDED",
      candidates: parsed.candidates,
      searchQueries: [...new Set([...parsed.searchQueries, ...searchQueries])].slice(0, 8),
      promptTokens: json.usage?.input_tokens ?? null,
      completionTokens: json.usage?.output_tokens ?? null,
      latencyMs: Date.now() - startedAt,
    }
  } catch {
    return {
      state: "FAILED",
      candidates: [],
      searchQueries: [],
      errorCode: "SEARCH_UNREACHABLE",
      promptTokens: null,
      completionTokens: null,
      latencyMs: Date.now() - startedAt,
    }
  } finally {
    clearTimeout(timer)
  }
}
