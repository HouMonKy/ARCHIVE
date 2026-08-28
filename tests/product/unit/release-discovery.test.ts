import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getTestDb, resetTestDb } from "../../helpers/db"
import { deepseekDiscoverReleases, parseReleaseDiscoveryText } from "@/lib/ai/release-discovery"
import {
  refreshOfficialReleaseSources,
  releaseDiscoveryRunType,
  validateReleaseCandidates,
  validateReleaseCandidatesWithAudit,
} from "@/lib/services/release-discovery"

const NOW = new Date("2026-08-26T12:00:00+08:00")

const lego = {
  brand: "LEGO" as const,
  officialName: "Avengers Tower（76269）",
  nameZh: "复仇者大厦",
  series: "Marvel",
  grade: "Icons",
  modelNumber: "76269",
  sourceDate: "2026-08-26",
  releaseDate: "2026-09-01",
  officialPageUrl: "https://www.lego.com/en-us/product/avengers-tower-76269?utm_source=x",
  sourceUrl: "https://www.lego.com/en-us/categories/new-sets-and-products",
  evidence: "LEGO 官网新品页与商品详情页均列出该套装。",
}

const bandai = {
  brand: "Bandai" as const,
  officialName: "RG 1/144 サザビー",
  nameZh: "RG 1/144 沙扎比",
  series: "机动战士高达 逆袭的夏亚",
  grade: "RG",
  modelNumber: "MSN-04",
  sourceDate: "2026-08-25",
  releaseDate: null,
  officialPageUrl: "https://www.bandaihobbysite.cn/index/index/detail/id/3425",
  sourceUrl: "https://www.bandaihobbysite.cn/schedule",
  evidence: "Bandai 发售计划链接到该商品详情。",
}

function responsePayload(items: unknown[]) {
  return {
    id: "resp_release_1",
    output: [
      { type: "web_search_call", id: "ws_1", status: "completed" },
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify({ items }) }],
      },
    ],
    usage: { input_tokens: 500, output_tokens: 160 },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_BASE_URL
  delete process.env.DEEPSEEK_MODEL
})

describe("DeepSeek 官方新品联网检索", () => {
  it("兼容 JSON 代码围栏，并把空的可选字段规范为 null", () => {
    const parsed = parseReleaseDiscoveryText(`\`\`\`json\n${JSON.stringify({ items: [{ ...lego, nameZh: "", series: "", grade: "" }, { bad: true }] })}\n\`\`\``)
    expect(parsed?.items[0]?.nameZh).toBeNull()
    expect(parsed?.items[0]?.series).toBeNull()
    expect(parsed?.items[0]?.grade).toBeNull()
    expect(parsed?.items).toHaveLength(1)
  })

  it("LEGO 独立使用 web_search，且最多返回 5 件", async () => {
    const legoItems = Array.from({ length: 6 }, (_, index) => {
      const setNumber = String(76269 + index)
      return {
        ...lego,
        officialName: `LEGO Set ${setNumber}`,
        modelNumber: setNumber,
        officialPageUrl: `https://www.lego.com/en-us/product/lego-set-${setNumber}`,
      }
    })
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body.tools).toEqual([{ type: "web_search" }])
      expect(body.tool_choice).toBeUndefined()
      expect(JSON.stringify(body)).toContain("www.lego.com/en-us/categories/new-sets-and-products")
      expect(JSON.stringify(body)).toContain("目标 5 件")
      expect(JSON.stringify(body)).not.toContain("www.bandaihobbysite.cn/schedule")
      return new Response(JSON.stringify(responsePayload(legoItems)), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    const result = await deepseekDiscoverReleases({
      apiKey: "sk-test",
      model: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.test",
      now: NOW,
      brand: "LEGO",
      maxItems: 5,
    })
    expect(result.state).toBe("SUCCEEDED")
    expect(result.usedWebSearch).toBe(true)
    expect(result.candidates).toHaveLength(5)
    expect(result.candidates.every((item) => item.brand === "LEGO")).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith("https://api.deepseek.test/responses", expect.any(Object))
  })

  it("没有 web_search_call 时拒绝把模型回答当官网事实", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const payload = responsePayload([lego])
        payload.output = payload.output.filter((item) => item.type !== "web_search_call")
        return new Response(JSON.stringify(payload), { status: 200 })
      }),
    )
    const result = await deepseekDiscoverReleases({
      apiKey: "sk-test",
      model: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.test",
      now: NOW,
      brand: "LEGO",
    })
    expect(result.state).toBe("FAILED")
    expect(result.errorCode).toBe("WEB_SEARCH_NOT_USED")
  })

  it("首轮只有搜索过程时，把公开研究笔记交给无工具请求收尾", async () => {
    let call = 0
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      call += 1
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      if (call === 1) {
        return new Response(
          JSON.stringify({
            id: "resp_research",
            output: [
              { type: "message", content: [{ type: "output_text", text: "正在检索官方页面" }] },
              { type: "web_search_call" },
            ],
            usage: { input_tokens: 100, output_tokens: 20 },
          }),
          { status: 200 },
        )
      }
      expect(body.previous_response_id).toBeUndefined()
      expect(body.tools).toBeUndefined()
      expect(JSON.stringify(body.input)).toContain("正在检索官方页面")
      return new Response(
        JSON.stringify({
          id: "resp_final",
          output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ items: [lego] }) }] }],
          usage: { input_tokens: 40, output_tokens: 60 },
        }),
        { status: 200 },
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    const result = await deepseekDiscoverReleases({
      apiKey: "sk-test",
      model: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.test",
      now: NOW,
      brand: "LEGO",
    })
    expect(result.state).toBe("SUCCEEDED")
    expect(result.candidates).toHaveLength(1)
    expect(result.promptTokens).toBe(140)
    expect(result.completionTokens).toBe(80)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe("官网候选校验与持久化", () => {
  beforeEach(async () => {
    await resetTestDb()
  })

  it("只接受官方详情页、编号匹配与合理日期", () => {
    const accepted = validateReleaseCandidates(
      [
        lego,
        bandai,
        { ...lego, modelNumber: "10307" },
        { ...lego, sourceUrl: "https://example.com/news" },
        { ...bandai, officialPageUrl: "https://shop.example.com/item/3425" },
        { ...bandai, sourceDate: "2024-01-01" },
      ],
      NOW,
    )
    expect(accepted.map((item) => item.productId)).toEqual(["lego-76269", "bandai-cn-3425"])
    expect(accepted[0]!.officialPageUrl).not.toContain("utm_source")
  })

  it("Bandai 官网首页、新闻、发售日历和商品一览都可作为事实来源，拒绝原因可审计", () => {
    const acceptedSources = [
      "https://www.bandaihobbysite.cn/",
      "https://www.bandaihobbysite.cn/news",
      "https://www.bandaihobbysite.cn/gunpla/news?page=1",
      "https://www.bandaihobbysite.cn/schedule",
      "https://www.bandaihobbysite.cn/item_all?page=1",
    ]
    for (const sourceUrl of acceptedSources) {
      expect(validateReleaseCandidates([{ ...bandai, sourceUrl }], NOW)).toHaveLength(1)
    }
    const audit = validateReleaseCandidatesWithAudit(
      [{ ...bandai, sourceUrl: "https://www.bandaihobbysite.cn/blog" }],
      NOW,
      "Bandai",
    )
    expect(audit.accepted).toHaveLength(0)
    expect(audit.rejected[0]?.reason).toBe("BANDAI_INVALID_SOURCE_PATH")
  })

  it("验证后写入 ReleaseEvent；24 小时内复用结果而不重复联网", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test"
    process.env.DEEPSEEK_BASE_URL = "https://api.deepseek.test"
    process.env.DEEPSEEK_MODEL = "deepseek-v4-flash"
    const fetchMock = vi.fn(async (_url?: string | URL | Request, init?: RequestInit) => {
      const url = String(_url)
      if (!url.includes("/responses")) return new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      const serialized = JSON.stringify(body)
      const items = serialized.includes('\"enum\":[\"LEGO\"]')
        ? [lego, { ...lego, sourceUrl: "https://example.com/bad" }]
        : [{ ...bandai, sourceUrl: "https://www.bandaihobbysite.cn/news" }]
      return new Response(JSON.stringify(responsePayload(items)), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const db = getTestDb()
    const first = await refreshOfficialReleaseSources(db, "kai", NOW, { force: true, allowInTests: true })
    expect(first.status).toBe("UPDATED")
    expect(first.acceptedCount).toBe(2)
    expect(first.rejectedCount).toBe(1)
    expect(await db.releaseEvent.count({ where: { datasetVersion: "official-v1" } })).toBe(2)
    const legoProduct = await db.catalogProduct.findUnique({ where: { id: "lego-76269" } })
    expect(legoProduct?.grade).toBe("MARVEL")
    expect(legoProduct?.series).toBe("Marvel")
    expect(legoProduct?.officialPageUrl).toBe("https://www.lego.com/en-us/product/avengers-tower-76269")
    expect(legoProduct?.canonicalName).toBe("Avengers Tower")
    const legoEvent = await db.releaseEvent.findUnique({ where: { id: "official-live-lego-76269" } })
    expect(legoEvent?.title).toBe("Avengers Tower · 2026-09-01 发售")

    const second = await refreshOfficialReleaseSources(db, "kai", new Date(NOW.getTime() + 5 * 60_000), { allowInTests: true })
    expect(second.status).toBe("FRESH")
    // 两品牌各检索 1 次；缓存期内都不重复联网。
    //（缓存期内的图片补全是新增行为——见下方 imageSync 断言）
    const discoveryCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes("/responses")).length
    expect(discoveryCalls).toBe(2)
    // 24h 缓存期内仍执行展示窗口中 PENDING 图片补全：
    // 本轮持久化的 lego-76269 / bandai-cn-3425 均 PENDING → 缓存期内被补全（mock 响应 JSON → 图片校验失败 → 如实 FAILED）
    expect(second.imageSync.length).toBeGreaterThanOrEqual(1)
    expect(second.imageSync.every((r) => r.status === "OK" || r.status === "FAILED" || r.status === "SKIPPED_OK")).toBe(true)
  })

  it("LEGO 成功不会掩盖 Bandai 失败；Bandai 冷却后可单独重试", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test"
    process.env.DEEPSEEK_BASE_URL = "https://api.deepseek.test"
    process.env.DEEPSEEK_MODEL = "deepseek-v4-flash"
    let bandaiAttempt = 0
    const requestedBrands: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (_url?: string | URL | Request, init?: RequestInit) => {
      const url = String(_url)
      if (!url.includes("/responses")) return new Response("nf", { status: 404 })
      const serialized = String(init?.body)
      if (serialized.includes('\"enum\":[\"LEGO\"]')) {
        requestedBrands.push("LEGO")
        return new Response(JSON.stringify(responsePayload([lego])), { status: 200 })
      }
      requestedBrands.push("Bandai")
      bandaiAttempt += 1
      return new Response(JSON.stringify(responsePayload(bandaiAttempt === 1 ? [] : [bandai])), { status: 200 })
    }))

    const db = getTestDb()
    const first = await refreshOfficialReleaseSources(db, "kai", NOW, { force: true, allowInTests: true })
    expect(first.status).toBe("UPDATED")
    expect(requestedBrands.sort()).toEqual(["Bandai", "LEGO"])
    expect((await db.agentRun.findFirst({ where: { runType: releaseDiscoveryRunType("Bandai") }, orderBy: { createdAt: "desc" } }))?.status).toBe("ERROR")

    requestedBrands.length = 0
    const retryAt = new Date(NOW.getTime() + 61 * 60_000)
    const second = await refreshOfficialReleaseSources(db, "kai", retryAt, { allowInTests: true })
    expect(second.status).toBe("UPDATED")
    expect(requestedBrands).toEqual(["Bandai"])
    expect((await db.agentRun.findFirst({ where: { runType: releaseDiscoveryRunType("Bandai") }, orderBy: { createdAt: "desc" } }))?.status).toBe("OK")
  })
})
