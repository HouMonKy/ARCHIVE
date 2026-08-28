import { describe, expect, it, vi, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  parseOfficialPage,
  officialPageKey,
  extractScale,
  searchOfficialProducts,
  defaultNameZh,
} from "@/lib/services/official-search"
import { getTestDb, resetTestDb } from "../../helpers/db"

/**
 * 官网搜索服务（识别主链路重构）：
 * - 官方页面解析（bandai-hobby.net 商品页 / manual 说明书页 真实快照）；
 * - 唯一标识派生（官方页面 ID → bandai-manual-949 / bandai-item-01_15 / lego-42172）；
 * - 候选验证：非官方域名/页面不可达/重定向到无关页 → 丢弃，绝不从目录顶替；
 * - LEGO Set Number 精确键（本地目录唯一允许参与方式）；
 * - E2E（liveSearch=false）不联网。
 */

const FIXTURES = path.resolve(process.cwd(), "tests/product/fixtures")
const SAZABI_ITEM_HTML = readFileSync(path.join(FIXTURES, "bandai-item-01_15.html"), "utf-8")
const SAZABI_MANUAL_HTML = readFileSync(path.join(FIXTURES, "bandai-manual-detail-949.html"), "utf-8")
const ECLIPSE_ITEM_GALLERY_HTML = `
  <html>
    <head>
      <title>MG 1/100 エクリプスガンダム｜バンダイ ホビーサイト</title>
      <meta property="og:image" content="https://bandai-hobby.net/ogp.png?=ver2">
    </head>
    <body>
      <img src="https://bandai-hobby.net/images/common/logo_title.png" alt="BANDAI HOBBY SITE">
      <div class="swiper-slide">
        <a href="https://bandai-hobby.net/images/153_4474_s_xpqsknt23wvt78leoyj3fjqvtixj.jpg" data-fancybox="images">
          <img src="https://bandai-hobby.net/images/153_4474_s_xpqsknt23wvt78leoyj3fjqvtixj.jpg" alt="MG 1/100 エクリプスガンダム">
        </a>
      </div>
      <dt>発売日</dt><dd>2021年8月21日</dd>
      <img src="https://bandai-hobby.net/images/bnr/bnr_survey.jpg" alt="アンケート">
    </body>
  </html>`
/** 说明书站内检索结果页（补齐路径的 mock：含 949 行） */
const MANUAL_SEARCH_949 = `<html><body><a href="/menus/detail/949">MG 1/100 MSN-04 サザビーVer.ka MG 1/100 MSN-04 SAZABI Ver.Ka 発売日 2013年12月14日発売</a></body></html>`

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("官方页面 ID 派生", () => {
  it("manual 说明书页 / 商品页 / P-Bandai / LEGO 各派生唯一标识", () => {
    expect(officialPageKey("https://manual.bandai-hobby.net/menus/detail/949", "2204932")).toBe("bandai-manual-949")
    expect(officialPageKey("https://bandai-hobby.net/item/01_15/", null)).toBe("bandai-item-01_15")
    expect(officialPageKey("https://p-bandai.jp/item/26898/", null)).toBe("pbandai-26898")
    expect(officialPageKey("https://www.lego.com/zh-cn/product/mclaren-p1-42172", "42172")).toBe("lego-42172")
    expect(officialPageKey("https://www.lego.com/en-us/product/42172", null)).toBe("lego-42172")
  })

  it("无法派生页面 ID 时退回官方产品编号；两者皆无 → null", () => {
    expect(officialPageKey("https://bandai-hobby.net/brand/mg/", "2204932")).toBe("code-2204932")
    expect(officialPageKey("https://bandai-hobby.net/brand/mg/", null)).toBeNull()
  })
})

describe("官方商品页解析（真实页面快照）", () => {
  it("bandai-hobby.net 商品页：标题 + 官方 Akamai CDN 商品图 + 发售年（沙扎比）", () => {
    const parsed = parseOfficialPage(SAZABI_ITEM_HTML, "https://bandai-hobby.net/item/01_15/")
    expect(parsed.officialName).toContain("MG 1/100 MSN-04 サザビーVer.ka")
    expect(parsed.imageUrl).toMatch(/^https:\/\/bandai-a\.akamaihd\.net\/bc\/img\/model\//)
    expect(parsed.releaseYear).toBe(2013)
  })

  it("bandai-hobby.net 新版商品相册：读取官网 /images/ 主轮播图，不误取 OGP/Logo/Banner（Eclipse）", () => {
    const parsed = parseOfficialPage(ECLIPSE_ITEM_GALLERY_HTML, "https://bandai-hobby.net/item/01_3523/")
    expect(parsed.officialName).toBe("MG 1/100 エクリプスガンダム")
    expect(parsed.imageUrl).toBe("https://bandai-hobby.net/images/153_4474_s_xpqsknt23wvt78leoyj3fjqvtixj.jpg")
    expect(parsed.releaseYear).toBe(2021)
  })

  it("manual.bandai-hobby.net 说明书页：品番 2204932 / ブランド MG / 作品 逆襲のシャア", () => {
    const parsed = parseOfficialPage(SAZABI_MANUAL_HTML, "https://manual.bandai-hobby.net/menus/detail/949")
    expect(parsed.officialName).toBe("MG 1/100 MSN-04 サザビーVer.ka")
    expect(parsed.productCode).toBe("2204932")
    expect(parsed.brand).toBe("MG")
    expect(parsed.series).toBe("機動戦士ガンダム 逆襲のシャア")
    expect(parsed.imageUrl).toContain("bandai-hobby.net/images/")
  })

  it("比例提取", () => {
    expect(extractScale("MG 1/100 MSN-04 サザビーVer.ka")).toBe("1/100")
    expect(extractScale("HGUC 1/144 リゼル")).toBe("1/144")
    expect(extractScale("PG UNLEASHED")).toBeNull()
  })
})

const SAZABI_EXTRACTION = {
  brand: "Bandai",
  name: "MG 1/100 サザビー Ver.Ka",
  series: "機動戦士ガンダム 逆襲のシャア",
  grade: "MG",
  scale: "1/100",
  modelNumber: "MSN-04",
}

describe("候选验证（网络层 mock：页面真实快照/失败）", () => {
  function stubFetch(handler: (url: string) => Response) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => handler(String(input))),
    )
  }

  it("真实官方页面 → 验证通过：名称取自页面、品番、来源域名、官方图", async () => {
    await resetTestDb()
    const db = getTestDb()
    stubFetch((url) => {
      if (url.includes("chat/completions")) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    candidates: [
                      {
                        officialName: "MG 1/100 サザビー Ver.Ka（模型声明名）",
                        productCode: "",
                        pageUrl: "https://bandai-hobby.net/item/01_15/",
                        imageUrl: "",
                        sourceDomain: "bandai-hobby.net",
                        snippet: "商品页",
                      },
                      {
                        officialName: "MG 1/100 MSN-04 サザビーVer.ka",
                        productCode: "2204932",
                        pageUrl: "https://manual.bandai-hobby.net/menus/detail/949",
                        imageUrl: "",
                        sourceDomain: "manual.bandai-hobby.net",
                        snippet: "说明书页",
                      },
                    ],
                    searchQueries: ["MG 1/100 MSN-04 サザビー Ver.Ka"],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      }
      if (url.startsWith("https://bandai-hobby.net/item/01_15/")) {
        return new Response(SAZABI_ITEM_HTML, { status: 200, headers: { "content-type": "text/html" } })
      }
      if (url.startsWith("https://manual.bandai-hobby.net/menus/detail/949")) {
        return new Response(SAZABI_MANUAL_HTML, { status: 200, headers: { "content-type": "text/html" } })
      }
      if (url.startsWith("https://manual.bandai-hobby.net/?freeword=")) {
        return new Response(MANUAL_SEARCH_949, { status: 200, headers: { "content-type": "text/html" } })
      }
      return new Response("not found", { status: 404 })
    })

    const result = await searchOfficialProducts(db, SAZABI_EXTRACTION, {
      liveSearch: true,
      apiKey: "sk-test",
      model: "kimi-k2.6",
      baseUrl: "https://api.moonshot.cn/v1",
    })
    expect(result.state).toBe("SUCCEEDED")
    expect(result.candidates).toHaveLength(2)
    const manual = result.candidates.find((c) => c.key === "bandai-manual-949")!
    expect(manual).toBeDefined()
    // 名称取自页面实际标题（验证过的真实名称），而非模型声明
    expect(manual.officialName).toBe("MG 1/100 MSN-04 サザビーVer.ka")
    expect(manual.productCode).toBe("2204932")
    expect(manual.sourceDomain).toBe("manual.bandai-hobby.net")
    expect(manual.nameZh).toContain("沙扎比")
    const item = result.candidates.find((c) => c.key === "bandai-item-01_15")!
    expect(item.officialName).toContain("サザビーVer.ka")
    expect(item.imageUrl).toMatch(/bandai-a\.akamaihd\.net/)
  })

  it("非官方域名候选直接丢弃；页面不可达丢弃——绝不从本地目录顶替", async () => {
    await resetTestDb()
    const db = getTestDb()
    stubFetch((url) => {
      if (url.includes("chat/completions")) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    candidates: [
                      { officialName: "第三方电商页", pageUrl: "https://www.1999.co.jp/item/xxx", sourceDomain: "1999.co.jp" },
                      { officialName: "不可达官方页", pageUrl: "https://bandai-hobby.net/item/99_9999/", sourceDomain: "bandai-hobby.net" },
                    ],
                    searchQueries: [],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      }
      return new Response("not found", { status: 404 })
    })
    const result = await searchOfficialProducts(db, SAZABI_EXTRACTION, {
      liveSearch: true,
      apiKey: "sk-test",
      model: "kimi-k2.6",
      baseUrl: "https://api.moonshot.cn/v1",
    })
    // 全部候选验证失败 → 空结果 + 明确提示（不拿目录商品顶替）
    expect(result.candidates).toHaveLength(0)
    expect(result.message).toContain("未找到官网商品")
  })

  it("搜索失败（网络/接口错误）→ FAILED 空候选，可重试", async () => {
    await resetTestDb()
    const db = getTestDb()
    stubFetch(() => new Response("server error", { status: 500 }))
    const result = await searchOfficialProducts(db, SAZABI_EXTRACTION, {
      liveSearch: true,
      apiKey: "sk-test",
      model: "kimi-k2.6",
      baseUrl: "https://api.moonshot.cn/v1",
    })
    expect(result.state).toBe("FAILED")
    expect(result.candidates).toHaveLength(0)
    expect(result.message).toContain("官网搜索失败")
  })

  it("LEGO Set Number 精确键：目录已有 lego-42172 → 直读缓存候选（唯一允许的本地目录参与）", async () => {
    await resetTestDb()
    const db = getTestDb()
    // liveSearch=false：不联网，仅 LEGO 精确键路径
    const result = await searchOfficialProducts(
      db,
      { brand: "LEGO", name: "McLaren P1", series: "TECHNIC", grade: "TECHNIC", scale: "", modelNumber: "42172" },
      { liveSearch: false, apiKey: "", model: "", baseUrl: "https://api.moonshot.cn/v1" },
    )
    expect(result.candidates).toHaveLength(1)
    const c = result.candidates[0]!
    expect(c.key).toBe("lego-42172")
    expect(c.origin).toBe("lego_set_exact")
    expect(c.imageUrl).toBe("https://www.lego.com/cdn/product-assets/product.img.pri/42172_Prod.png")
    expect(c.pageUrl).toBe("https://www.lego.com/en-us/product/mclaren-p1-42172")
    expect(c.grade).toBe("TECHNIC")
    expect(c.series).toBe("TECHNIC")
  })

  it("号角日报大楼 76178：精确编号候选保留 Kimi 的 Marvel 主题，并使用美国官网页", async () => {
    await resetTestDb()
    const db = getTestDb()
    const result = await searchOfficialProducts(
      db,
      { brand: "LEGO", name: "Daily Bugle", series: "Marvel", grade: "", scale: "", modelNumber: "76178" },
      { liveSearch: false, apiKey: "", model: "", baseUrl: "https://api.moonshot.cn/v1" },
    )
    const candidate = result.candidates[0]!
    expect(candidate.officialName).toBe("Daily Bugle")
    expect(candidate.grade).toBe("MARVEL")
    expect(candidate.series).toBe("Marvel")
    expect(candidate.line).toBeNull()
    expect(candidate.pageUrl).toBe("https://www.lego.com/en-us/product/daily-bugle-76178")
  })

  it("Bandai 品牌 liveSearch=false → 无候选（不走模糊目录匹配）", async () => {
    await resetTestDb()
    const db = getTestDb()
    const result = await searchOfficialProducts(db, SAZABI_EXTRACTION, { liveSearch: false, apiKey: "", model: "", baseUrl: "https://api.moonshot.cn/v1" })
    expect(result.candidates).toHaveLength(0)
  })

  it("同名候选去重（同 key 只留一个）", async () => {
    await resetTestDb()
    const db = getTestDb()
    stubFetch((url) => {
      if (url.includes("chat/completions")) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    candidates: [
                      { officialName: "A", pageUrl: "https://manual.bandai-hobby.net/menus/detail/949", productCode: "2204932" },
                      { officialName: "B（重复页面）", pageUrl: "https://manual.bandai-hobby.net/menus/detail/949", productCode: "2204932" },
                    ],
                    searchQueries: [],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      }
      if (url.startsWith("https://manual.bandai-hobby.net/menus/detail/949")) {
        return new Response(SAZABI_MANUAL_HTML, { status: 200, headers: { "content-type": "text/html" } })
      }
      if (url.startsWith("https://manual.bandai-hobby.net/?freeword=")) {
        return new Response(MANUAL_SEARCH_949, { status: 200, headers: { "content-type": "text/html" } })
      }
      return new Response("nf", { status: 404 })
    })
    const result = await searchOfficialProducts(db, SAZABI_EXTRACTION, {
      liveSearch: true,
      apiKey: "sk-test",
      model: "kimi-k2.6",
      baseUrl: "https://api.moonshot.cn/v1",
    })
    // 站内检索补齐与联网搜索命中同一页面 → key 去重只留一条
    expect(result.candidates).toHaveLength(1)
  })
})

describe("中文名默认值", () => {
  it("Bandai 词典转写；LEGO 名称策略不提供中文名（R9：展示恒用官网英文）", () => {
    expect(defaultNameZh(SAZABI_EXTRACTION)).toContain("沙扎比")
    expect(
      defaultNameZh({ brand: "LEGO", name: "McLaren P1", series: "", grade: "TECHNIC", scale: "", modelNumber: "42172" }),
    ).toBe("")
  })
})
