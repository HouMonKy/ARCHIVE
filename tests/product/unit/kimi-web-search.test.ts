import { describe, expect, it, vi, afterEach } from "vitest"
import { kimiWebSearch, parseSearchJson, isMoonshotEndpoint } from "@/lib/ai/kimi"

/**
 * Kimi $web_search 工具循环（识别主链路重构）：
 * - builtin_function 声明 + tool_calls arguments 原样回传 → 服务端执行搜索 → 最终 JSON；
 * - 解析容错（markdown 包裹/非 JSON 拒绝）；
 * - 失败路径（HTTP 4xx/5xx、轮数超限）。
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

function chatResponse(content: string, finishReason = "stop", toolCalls?: unknown[]) {
  return JSON.stringify({
    choices: [{ finish_reason: finishReason, message: { role: "assistant", content, tool_calls: toolCalls } }],
    usage: { prompt_tokens: 42, completion_tokens: 7 },
  })
}

describe("parseSearchJson", () => {
  it("标准 JSON 与 markdown 包裹容错", () => {
    const data = { candidates: [{ officialName: "MG サザビー", pageUrl: "https://bandai-hobby.net/item/01_15/" }], searchQueries: ["q"] }
    expect(parseSearchJson(JSON.stringify(data))?.candidates).toHaveLength(1)
    expect(parseSearchJson("```json\n" + JSON.stringify(data) + "\n```")?.candidates).toHaveLength(1)
  })

  it("非 JSON / 缺 candidates 拒绝；非 https 候选被过滤", () => {
    expect(parseSearchJson("不是 JSON")).toBeNull()
    expect(parseSearchJson("{}")).toBeNull()
    // http://（非 https）候选被过滤为空数组（合法 JSON，无有效候选）
    const filtered = parseSearchJson('{"candidates":[{"officialName":"x","pageUrl":"http://insecure"},{"officialName":"y","pageUrl":"https://bandai-hobby.net/item/01_15/"}]}')
    expect(filtered?.candidates).toHaveLength(1)
    expect(filtered?.candidates[0]!.pageUrl).toBe("https://bandai-hobby.net/item/01_15/")
  })
})

describe("kimiWebSearch 工具循环", () => {
  it("tool_calls → arguments 原样回传（builtin_function）→ 最终 JSON 候选", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        calls.push({ url: String(url), body })
        // 第一轮：模型请求搜索（tool_calls）
        const messages = body.messages as { role: string; tool_call_id?: string }[]
        if (messages.length === 2) {
          return new Response(
            chatResponse("", "tool_calls", [
              { id: "t-1", type: "builtin_function", function: { name: "$web_search", arguments: '{"search_result":{"search_id":"abc"},"usage":{"total_tokens":10070}}' } },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }
        // 第二轮：搜索完成后的最终回答
        return new Response(
          chatResponse(
            JSON.stringify({
              candidates: [{ officialName: "MG 1/100 MSN-04 サザビーVer.ka", productCode: "2204932", pageUrl: "https://manual.bandai-hobby.net/menus/detail/949", sourceDomain: "manual.bandai-hobby.net" }],
              searchQueries: ["site:manual.bandai-hobby.net サザビー"],
            }),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      }),
    )
    const out = await kimiWebSearch("sk-test", "kimi-k2.6", {
      brand: "Bandai",
      name: "MG 1/100 サザビー Ver.Ka",
      series: "逆襲のシャア",
      grade: "MG",
      scale: "1/100",
      modelNumber: "MSN-04",
    })
    expect(out.state).toBe("SUCCEEDED")
    expect(out.candidates).toHaveLength(1)
    expect(out.candidates[0]!.pageUrl).toBe("https://manual.bandai-hobby.net/menus/detail/949")
    expect(out.searchQueries).toContain("site:manual.bandai-hobby.net サザビー")
    // 第二轮请求包含 role=tool 的原样回传
    const second = calls[1]!.body.messages as { role: string; content?: string; tool_call_id?: string }[]
    const toolMsg = second.find((m) => m.role === "tool")
    expect(toolMsg).toBeDefined()
    expect(toolMsg!.content).toContain("search_id")
    // 每轮都完整携带 tools 声明
    for (const c of calls) {
      expect(c.body.tools).toEqual([{ type: "builtin_function", function: { name: "$web_search" } }])
    }
  })

  it("模型直接回答（无 tool_calls）→ 单轮完成", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(chatResponse('{"candidates":[],"searchQueries":[]}'), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    )
    const out = await kimiWebSearch("sk-test", "kimi-k2.6", { brand: "Bandai", name: "x" })
    expect(out.state).toBe("SUCCEEDED")
    expect(out.candidates).toHaveLength(0)
  })

  it("HTTP 5xx/4xx → FAILED 错误码（不抛出）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })))
    const out = await kimiWebSearch("sk-test", "kimi-k2.6", { brand: "Bandai", name: "x" })
    expect(out.state).toBe("FAILED")
    expect(out.errorCode).toBe("SEARCH_PROVIDER_ERROR")
  })

  it("最终回答非 JSON → INVALID_SEARCH_RESULT", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(chatResponse("我找到了一些结果…"), { status: 200, headers: { "content-type": "application/json" } })),
    )
    const out = await kimiWebSearch("sk-test", "kimi-k2.6", { brand: "Bandai", name: "x" })
    expect(out.state).toBe("FAILED")
    expect(out.errorCode).toBe("INVALID_SEARCH_RESULT")
  })
})

describe("厂商适配（任意 OpenAI 兼容端点）", () => {
  it("isMoonshotEndpoint：moonshot 域名识别", () => {
    expect(isMoonshotEndpoint("https://api.moonshot.cn/v1")).toBe(true)
    expect(isMoonshotEndpoint("https://api.deepseek.com")).toBe(false)
    expect(isMoonshotEndpoint("https://api.openai.com/v1")).toBe(false)
    expect(isMoonshotEndpoint("not-a-url")).toBe(false)
  })

  it("非 Moonshot 端点：视觉提取请求体不含 thinking 字段", async () => {
    const fetchMock = vi.fn(async (_url?: string | URL | Request, init?: RequestInit) => {
      void init
      return new Response(
        JSON.stringify({
          choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ brand: "Bandai", name: "X", series: "", grade: "", scale: "", modelNumber: "", visibleText: "", confidence: 0.9, evidence: "" }) } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    const { kimiExtract } = await import("@/lib/ai/kimi")
    const result = await kimiExtract("sk-test", { imageDataUrl: "data:image/png;base64,x", mimeType: "image/png" }, "deepseek-v4-flash-vision-exp", "https://api.deepseek.com")
    expect(result.state).toBe("SUCCEEDED")
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body)) as Record<string, unknown>
    expect("thinking" in body).toBe(false) // DeepSeek 等端点 thinking 会 400
    expect(body.response_format).toEqual({ type: "json_object" })
  })

  it("Moonshot 端点：视觉提取请求体保留 thinking", async () => {
    const fetchMock = vi.fn(async (_url?: string | URL | Request, init?: RequestInit) => {
      void init
      return new Response(
        JSON.stringify({
          choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ brand: "Bandai", name: "X", series: "", grade: "", scale: "", modelNumber: "", visibleText: "", confidence: 0.9, evidence: "" }) } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    const { kimiExtract } = await import("@/lib/ai/kimi")
    await kimiExtract("sk-test", { imageDataUrl: "data:image/png;base64,x", mimeType: "image/png" }, "kimi-k2.6", "https://api.moonshot.cn/v1")
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body)) as Record<string, unknown>
    expect(body.thinking).toEqual({ type: "disabled" })
  })

  it("非 Moonshot 端点：web search 走 Responses API（/responses + tools:[{type:web_search}]）", async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url)
      expect(u, "应请求 /responses 端点").toContain("/responses")
      return new Response(
        JSON.stringify({
          status: "completed",
          output: [
            { type: "web_search_call", action: { queries: ["site:lego.com 42172"] } },
            { type: "message", content: [{ type: "output_text", text: JSON.stringify({ candidates: [{ officialName: "McLaren P1", pageUrl: "https://www.lego.com/en-us/product/mclaren-p1-42172" }], searchQueries: [] }) }] },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    const out = await kimiWebSearch("sk-test", "deepseek-v4-flash", { brand: "LEGO", name: "McLaren P1" }, "https://api.deepseek.com")
    expect(out.state).toBe("SUCCEEDED")
    expect(out.candidates).toHaveLength(1)
    expect(out.candidates[0]!.officialName).toBe("McLaren P1")
    expect(out.searchQueries).toContain("site:lego.com 42172")
    // 请求体校验：Responses API 工具形态
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body)) as { tools: { type: string }[] }
    expect(body.tools).toEqual([{ type: "web_search" }])
  })

  it("非 Moonshot 端点：Responses 最终消息非 JSON → INVALID_SEARCH_RESULT", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "找到了一些结果…" }] }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    )
    const out = await kimiWebSearch("sk-test", "deepseek-v4-flash", { brand: "LEGO", name: "x" }, "https://api.deepseek.com")
    expect(out.state).toBe("FAILED")
    expect(out.errorCode).toBe("INVALID_SEARCH_RESULT")
  })
})
