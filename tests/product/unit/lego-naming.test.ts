import { describe, expect, it, vi, afterEach, beforeAll } from "vitest"
import { getTestDb, resetTestDb } from "../../helpers/db"
import {
  legoCanonicalNamePolicy,
  legoDisplayName,
  isGenericLegoPlaceholderName,
  cleanLegoSeoSuffix,
  fetchLegoOfficialTitle,
  extractLegoTitleFromHtml,
  resolveLegoEnUsName,
  stripLegoTrailingSetNumber,
} from "@/lib/names/lego-naming"

/**
 * LEGO 官网英文名统一策略（R9）：
 * - 写入策略：canonicalName=官网英文标题；LEGO nameZh/nameZhSource 恒 null；
 * - 展示策略：LEGO 恒用 canonicalName（即使 nameZh 非空——历史数据）；Bandai 原逻辑；
 * - 占位名识别：LEGO Technic <编号> / LEGO <编号> 等可被官网标题替换；
 * - meaningful canonicalName 不被未验证结果覆盖；
 * - 官网元数据：en-us 商品页 og:title/JSON-LD/title 解析（服务端校验域名/路径/编号），
 *   Cloudflare 403 时 web search 兜底；
 * - 76419 保留 ™；11370 名称与 URL 正确。
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("LEGO 名称策略函数", () => {
  it("写入策略：canonicalName 原样、nameZh/nameZhSource 恒 null（即使 AI 给了中文名）", () => {
    const policy = legoCanonicalNamePolicy("Hogwarts™ Castle and Grounds", "霍格沃茨城堡")
    expect(policy).toEqual({
      canonicalName: "Hogwarts™ Castle and Grounds",
      nameZh: null,
      nameZhSource: null,
    })
  })

  it("仅移除与 modelNumber 一致的末尾括号编号，不误删名称自身数字", () => {
    expect(stripLegoTrailingSetNumber("Daily Bugle（76178）", "76178")).toBe("Daily Bugle")
    expect(stripLegoTrailingSetNumber("Avengers Tower ( 76269 )", "76269")).toBe("Avengers Tower")
    expect(stripLegoTrailingSetNumber("Daily Bugle（76178）", "76269")).toBe("Daily Bugle（76178）")
    expect(stripLegoTrailingSetNumber("BMW M 1000 RR", "42130")).toBe("BMW M 1000 RR")
    expect(stripLegoTrailingSetNumber("Porsche 911", "10295")).toBe("Porsche 911")
  })

  it("写入与展示策略都能防御历史括号编号", () => {
    expect(legoCanonicalNamePolicy("Daily Bugle（76178）", null, "76178").canonicalName).toBe("Daily Bugle")
    expect(legoDisplayName("LEGO", "Avengers Tower（76269）", null, "76269")).toBe("Avengers Tower")
  })

  it("展示策略：LEGO 恒用 canonicalName（旧 nameZh 存在也不读）", () => {
    expect(legoDisplayName("LEGO", "Hogwarts™ Castle and Grounds", "LEGO Technic 76419")).toBe("Hogwarts™ Castle and Grounds")
    expect(legoDisplayName("LEGO", "Stranger Things: The Creel House", null)).toBe("Stranger Things: The Creel House")
  })

  it("展示策略：Bandai 原逻辑不变（有效 nameZh 优先）", () => {
    expect(legoDisplayName("Bandai", "MG 1/100 MSN-04 サザビーVer.ka", "MG 1/100 沙扎比Ver.ka")).toBe("MG 1/100 沙扎比Ver.ka")
    expect(legoDisplayName("Bandai", "MG 1/100 MSN-04 サザビーVer.ka", null)).toBe("MG 1/100 MSN-04 サザビーVer.ka")
  })

  it("SEO 后缀清理：去 ' | LEGO' 等，保留 ™ ® 冒号标点", () => {
    expect(cleanLegoSeoSuffix("Hogwarts™ Castle and Grounds | LEGO")).toBe("Hogwarts™ Castle and Grounds")
    expect(cleanLegoSeoSuffix("Stranger Things: The Creel House | LEGO® Official")).toBe("Stranger Things: The Creel House")
    expect(cleanLegoSeoSuffix("McLaren P1")).toBe("McLaren P1")
  })

  it("占位名识别：LEGO Technic <编号> / LEGO <编号> / LEGO Icons <编号> 等", () => {
    expect(isGenericLegoPlaceholderName("LEGO Technic 76419", "76419")).toBe(true)
    expect(isGenericLegoPlaceholderName("LEGO Technic 11370", "11370")).toBe(true)
    expect(isGenericLegoPlaceholderName("LEGO 42172", "42172")).toBe(true)
    expect(isGenericLegoPlaceholderName("LEGO Icons 10337", "10337")).toBe(true)
    expect(isGenericLegoPlaceholderName("Stranger Things: The Creel House", "11370")).toBe(false)
    expect(isGenericLegoPlaceholderName("Lamborghini Countach", "10337")).toBe(false)
  })
})

describe("LEGO en-us 页面标题解析", () => {
  it("og:title 优先；JSON-LD name 次之；<title> 兜底；均去 SEO 后缀", () => {
    const html = `
      <html><head>
        <title>Wrong Page Title | Something</title>
        <meta property="og:title" content="Hogwarts™ Castle and Grounds | LEGO" />
      </head><body></body></html>`
    expect(extractLegoTitleFromHtml(html)).toBe("Hogwarts™ Castle and Grounds")

    const jsonld = `<script type="application/ld+json">{"@type":"Product","name":"Stranger Things: The Creel House"}</script>`
    expect(extractLegoTitleFromHtml(jsonld)).toBe("Stranger Things: The Creel House")

    const titleOnly = "<html><head><title>Daily Bugle | LEGO</title></head></html>"
    expect(extractLegoTitleFromHtml(titleOnly)).toBe("Daily Bugle")

    expect(extractLegoTitleFromHtml("<html><head></head></html>")).toBeNull()
  })

  it("服务端校验：hostname 必须 lego.com、路径 /en-us/product/、slug 编号与 setNumber 一致", async () => {
    const ok = `<meta property="og:title" content="Hogwarts™ Castle and Grounds | LEGO">`
    // 合法：lego.com + /en-us/product/ + slug 尾编号一致
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`<html>${ok}</html>`, { status: 200, headers: { "content-type": "text/html" } })))
    expect(await fetchLegoOfficialTitle("https://www.lego.com/en-us/product/hogwarts-castle-and-grounds-76419", "76419")).toBe("Hogwarts™ Castle and Grounds")
    // 非 lego.com 域名
    expect(await fetchLegoOfficialTitle("https://evil.example.com/en-us/product/x-76419", "76419")).toBeNull()
    // 非 /en-us/product/ 路径
    expect(await fetchLegoOfficialTitle("https://www.lego.com/en-us/categories/x-76419", "76419")).toBeNull()
    // slug 编号不一致
    expect(await fetchLegoOfficialTitle("https://www.lego.com/en-us/product/hogwarts-castle-99999", "76419")).toBeNull()
  })

  it("Cloudflare 403 → null（由上层走 web search 兜底）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("blocked", { status: 403 })))
    expect(await fetchLegoOfficialTitle("https://www.lego.com/en-us/product/hogwarts-castle-and-grounds-76419", "76419")).toBeNull()
  })

  it("编号不一致/外部域名的 web search 候选被拒绝；一致候选被接受", async () => {
    // web search 返回候选（含外部域名与编号不一致）→ 只接受 en-us 商品页且编号一致的
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url)
      if (u.includes("/chat/completions")) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    candidates: [
                      { officialName: "Evil Clone Set", pageUrl: "https://evil.example.com/en-us/product/x-11370" },
                      { officialName: "Wrong Number Set", pageUrl: "https://www.lego.com/en-us/product/other-set-99999" },
                      { officialName: "Stranger Things: The Creel House", pageUrl: "https://www.lego.com/en-us/product/stranger-things-the-creel-house-11370" },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      }
      return new Response("nf", { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const result = await resolveLegoEnUsName("11370", {
      webSearch: { apiKey: "sk-test", model: "kimi-k2.6", baseUrl: "https://api.moonshot.cn/v1" },
    })
    // 外部域名与编号不一致被拒；官网候选被接受
    expect(result.status).toBe("RESOLVED")
    expect(result.officialName).toBe("Stranger Things: The Creel House")
  })
})

describe("写入路径策略（真实 SQLite）", () => {
  beforeAll(async () => {
    await resetTestDb()
  })

  it("LEGO 更新路径：nameZh 恒 null；meaningful canonicalName 不被未验证结果覆盖；占位名可被官网标题替换", async () => {
    const db = getTestDb()
    // upsert 写入路径通过策略函数间接验证（official-confirm 集成用例覆盖库行为）；
    // 此处直接验证策略组合语义
    const meaningful = legoCanonicalNamePolicy("Lamborghini Countach", "兰博基尼 Countach")
    expect(meaningful.nameZh).toBeNull()
    // meaningful canonicalName + 未验证新标题 → 保持
    const keep = resolveLegoEnUsName.shouldKeepExistingName("Lamborghini Countach", "10337")
    expect(keep).toBe(true)
    // 占位名 + 已验证官网标题 → 替换
    const replace = resolveLegoEnUsName.shouldKeepExistingName("LEGO Technic 11370", "11370")
    expect(replace).toBe(false)
  })
})
