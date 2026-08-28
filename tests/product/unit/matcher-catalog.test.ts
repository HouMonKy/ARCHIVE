import { describe, expect, it, vi, afterEach } from "vitest"
import { getTestDb, resetTestDb } from "../../helpers/db"

/**
 * 产品级契约测试：识别匹配器、视觉提取解析、目录同步解析器、双模式数据库、图片边界。
 */
import { matchCatalogTop3, tokenize, type MatcherProduct } from "@/lib/ai/matcher"
import { parseVisionExtraction, normalizeBrand } from "@/lib/ai/vision"
import { parseListing, parseItemPage, parseReleaseDate, LEGO_MANUAL_LIST } from "../../../scripts/catalog-sync"
import { resolveDatabaseMode, isHostedRuntime, DatabaseModeError } from "@/lib/db-mode"
import { computeRouteProgress } from "@/lib/services/routes"
import { validateFactPreservation, extractFactFragments } from "@/lib/ai/deepseek"

const PRODUCTS: MatcherProduct[] = [
  { id: "P02", brand: "Bandai", category: "Gundam", line: "UC", grade: "MG", canonicalName: "MG Zeta Gundam Ver.Ka", matchText: "MG 1/100 ゼータガンダム Ver.Ka MSZ-006" },
  { id: "P01", brand: "Bandai", category: "Gundam", line: "UC", grade: "MG", canonicalName: "MG RX-78-2 Gundam Ver.3.0", matchText: null },
  { id: "lego-42143", brand: "LEGO", category: "Technic", line: "SUPERCAR", grade: "TECHNIC", canonicalName: "Ferrari Daytona SP3（42143）", matchText: null },
  { id: "lego-42172", brand: "LEGO", category: "Technic", line: "SUPERCAR", grade: "TECHNIC", canonicalName: "McLaren P1（42172）", matchText: null },
]

describe("目录 Top-3 匹配器（确定性，无网络）", () => {
  it("日文提取命中英文目录条目：Zeta → P02 Top-1", () => {
    const top = matchCatalogTop3(
      { brand: "万代", name: "MG 1/100 ゼータガンダム Ver.Ka", series: "機動戦士Zガンダム", grade: "MG", scale: "", modelNumber: "MSZ-006", visibleText: "※画像はイメージです", confidence: 0.95, evidence: "" },
      PRODUCTS,
    )
    expect(top[0]!.productId).toBe("P02")
    expect(top.length).toBeLessThanOrEqual(3)
  })

  it("中文提取命中：自由高达 → P12（等价词典）", () => {
    const products = [...PRODUCTS, { id: "P12", brand: "Bandai", category: "Gundam", line: "CE", grade: "MG", canonicalName: "MG Freedom Gundam Ver.2.0", matchText: "MG 1/100 フリーダムガンダム Ver.2.0 ZGMF-X10A" }]
    const top = matchCatalogTop3(
      { brand: "Bandai", name: "自由高达 Ver.2.0", series: "高达SEED", grade: "MG", scale: "", modelNumber: "ZGMF-X10A", visibleText: "", confidence: 0.9, evidence: "" },
      products,
    )
    expect(top[0]!.productId).toBe("P12")
  })

  it("LEGO 套装编号强信号：42143 → lego-42143", () => {
    const top = matchCatalogTop3(
      { brand: "LEGO", name: "Ferrari Daytona SP3", series: "LEGO Technic", grade: "TECHNIC", scale: "", modelNumber: "42143", visibleText: "42143", confidence: 0.9, evidence: "" },
      PRODUCTS,
    )
    expect(top[0]!.productId).toBe("lego-42143")
  })

  it("LEGO 套装编号强匹配键：品牌+编号精确一致 → 0.95 Top-1（确定性）", () => {
    const top = matchCatalogTop3(
      { brand: "LEGO", name: "迈凯伦P1", series: "LEGO Technic", grade: "TECHNIC", scale: "", modelNumber: "42172", visibleText: "McLaren P1 42172", confidence: 0.93, evidence: "" },
      PRODUCTS,
    )
    expect(top[0]!.productId).toBe("lego-42172")
    expect(top[0]!.confidence).toBe(0.95)
  })

  it("LEGO 套装编号也可通过 modelNumber 字段命中（目录商品带编号）", () => {
    const withModel = PRODUCTS.map((p) => ({ ...p, modelNumber: p.id.startsWith("lego-") ? p.id.replace("lego-", "") : null }))
    const top = matchCatalogTop3(
      { brand: "LEGO", name: "完全不同的名字", series: "", grade: "TECHNIC", scale: "", modelNumber: "42172", visibleText: "", confidence: 0.9, evidence: "" },
      withModel,
    )
    expect(top[0]!.productId).toBe("lego-42172")
  })

  it("编号不在目录（如 99999）不强匹配，正常打分", () => {
    const top = matchCatalogTop3(
      { brand: "LEGO", name: "Unknown", series: "", grade: "TECHNIC", scale: "", modelNumber: "99999", visibleText: "", confidence: 0.9, evidence: "" },
      PRODUCTS,
    )
    expect(top[0]?.productId).not.toBe("lego-99999")
  })

  it("同分数时按 productId 字典序稳定排序（确定性）", () => {
    const ex = { brand: "LEGO", name: "Unknown Kit", series: "", grade: "", scale: "", modelNumber: "", visibleText: "", confidence: 0.5, evidence: "" }
    const a = matchCatalogTop3(ex, PRODUCTS)
    const b = matchCatalogTop3(ex, PRODUCTS)
    expect(a.map((x) => x.productId)).toEqual(b.map((x) => x.productId))
  })

  it("tokenize 走等价词典（ガンダム/高达/高达 → gundam）", () => {
    expect(tokenize("ガンダム")).toContain("gundam")
    expect(tokenize("高达")).toContain("gundam")
    expect(tokenize("GUNDAM")).toContain("gundam")
  })
})

describe("视觉提取解析（模型输出契约）", () => {
  it("合法 JSON 解析为结构化提取；品牌归一万代→Bandai", () => {
    const ex = parseVisionExtraction('{"brand":"万代","name":"Z高达","series":"機動戦士Zガンダム","grade":"MG","modelNumber":"MSZ-006","visibleText":"©SOTSU・SUNRISE","confidence":0.95,"evidence":"配色"}')
    expect(ex).not.toBeNull()
    expect(ex!.brand).toBe("Bandai")
    expect(ex!.name).toBe("Z高达")
  })

  it("模型输出 productId 被丢弃（模型不得生成目录主键）", () => {
    const ex = parseVisionExtraction('{"brand":"LEGO","name":"X","productId":"P01","confidence":0.9}')
    expect(ex).not.toBeNull()
    expect(JSON.stringify(ex)).not.toContain("productId")
  })

  it("非法输出（非 JSON/缺字段/超界置信度）返回 null", () => {
    expect(parseVisionExtraction("not json")).toBeNull()
    expect(parseVisionExtraction('{"brand":"a"}')).toBeNull()
    expect(parseVisionExtraction('{"brand":"a","name":"b","confidence":2}')).toBeNull()
  })

  it("markdown 包裹的 JSON 容错解析", () => {
    const ex = parseVisionExtraction('```json\n{"brand":"LEGO","name":"X","confidence":0.5}\n```')
    expect(ex).not.toBeNull()
    expect(ex!.brand).toBe("LEGO")
  })

  it("normalizeBrand：乐高/樂高/バンダイ 归一", () => {
    expect(normalizeBrand("乐高")).toBe("LEGO")
    expect(normalizeBrand("バンダイ")).toBe("Bandai")
    expect(normalizeBrand("Other")).toBe("Other")
  })
})

describe("catalog-sync 解析器（离线契约）", () => {
  it("parseListing 提取商品链接与名称", () => {
    const html = `<a href="https://bandai-hobby.net/item/01_7333/"><div><span>RG 1/144 サザビー</span></div></a><a href="https://bandai-hobby.net/item/01_7333/">重复</a>`
    const items = parseListing(html)
    expect(items).toHaveLength(1)
    expect(items[0]!.code).toBe("01_7333")
    expect(items[0]!.name).toContain("サザビー")
  })

  it("parseItemPage 提取等级/系列/价格/发售日（真实页面结构片段）", () => {
    const html = [
      "<title>MG 1/100 ガンダムリバティアストレイ レッドフレーム｜バンダイ ホビーサイト</title>",
      `<a href="https://bandai-hobby.net/gunpla/">ガンプラ</a><a href="https://bandai-hobby.net/brand/mg/">MG [マスターグレード]</a><a href="https://bandai-hobby.net/series/seed-freedom/">機動戦士ガンダムSEED FREEDOM</a>`,
      `<dl><dt><span>価格</span></dt><dd>8,250                                                  円(税10%込)                                              </dd><dt><span>発売日</span></dt><dd>2026年12月</dd></dl>`,
      `"https://d3bk8pkqsprcvh.cloudfront.net/hobby/jp/product/2026/05/abc/def.jpg?Expires=1"`,
    ].join("")
    const parsed = parseItemPage(html, "https://bandai-hobby.net/brand/mg/?p=1")
    expect(parsed.title).toBe("MG 1/100 ガンダムリバティアストレイ レッドフレーム")
    expect(parsed.grade).toBe("MG")
    expect(parsed.line).toBe("CE")
    expect(parsed.priceText).toBe("8,250")
    expect(parsed.releaseText).toBe("2026年12月")
    expect(parsed.image).toContain("cloudfront.net/hobby/jp/product/")
    expect(parsed.isGunpla).toBe(true)
  })

  it("parseReleaseDate：年月/年/无效", () => {
    expect(parseReleaseDate("2026年12月")).toEqual({ year: 2026, month: 12, day: 1 })
    expect(parseReleaseDate("2027年")).toEqual({ year: 2027, month: 1, day: 1 })
    expect(parseReleaseDate("未定")).toBeNull()
    expect(parseReleaseDate(null)).toBeNull()
  })

  it("LEGO 人工清单完整（编号唯一、≥25 条、官方 URL 形态）", () => {
    expect(LEGO_MANUAL_LIST.length).toBeGreaterThanOrEqual(25)
    const numbers = LEGO_MANUAL_LIST.map((e) => e.setNumber)
    expect(new Set(numbers).size).toBe(numbers.length)
    for (const e of LEGO_MANUAL_LIST) {
      expect(e.slug).toMatch(/^[a-z0-9-]+$/)
      expect(e.name.length).toBeGreaterThan(3)
    }
  })
})

describe("双模式数据库（LOCAL/HOSTED 边界）", () => {
  const original = { ...process.env }

  afterEach(() => {
    process.env = { ...original }
  })

  it("默认 LOCAL；HOSTED 需 LIBSQL_URL", () => {
    delete process.env.DATABASE_MODE
    delete process.env.LIBSQL_URL
    delete process.env.VERCEL
    expect(resolveDatabaseMode().mode).toBe("LOCAL")
    process.env.DATABASE_MODE = "HOSTED"
    expect(() => resolveDatabaseMode()).toThrowError(DatabaseModeError)
    process.env.LIBSQL_URL = "libsql://db.turso.io"
    process.env.LIBSQL_AUTH_TOKEN = "token"
    expect(resolveDatabaseMode().mode).toBe("HOSTED")
  })

  it("远程 libSQL 缺 token 拒启；本地 file: 不需要 token", () => {
    process.env.DATABASE_MODE = "HOSTED"
    process.env.LIBSQL_URL = "libsql://db.turso.io"
    delete process.env.LIBSQL_AUTH_TOKEN
    expect(() => resolveDatabaseMode()).toThrowError(/LIBSQL_AUTH_TOKEN/)
    process.env.LIBSQL_URL = "file:./local.db"
    expect(resolveDatabaseMode().mode).toBe("HOSTED")
  })

  it("Vercel 上 LOCAL 模式直接拒绝（禁止临时 SQLite）", () => {
    delete process.env.DATABASE_MODE
    delete process.env.LIBSQL_URL
    process.env.VERCEL = "1"
    expect(() => resolveDatabaseMode()).toThrowError(/Vercel/)
    expect(isHostedRuntime()).toBe(true)
  })

  it("未知模式拒绝", () => {
    process.env.DATABASE_MODE = "WEIRD"
    expect(() => resolveDatabaseMode()).toThrowError(DatabaseModeError)
  })
})

describe("托管版官方图片边界（契约）", () => {
  it("HOSTED 模式图片路由返回占位图（不伺服官方图）", async () => {
    const original = { ...process.env }
    process.env.DATABASE_MODE = "HOSTED"
    process.env.LIBSQL_URL = "file:./local.db"
    delete process.env.VERCEL
    try {
      const { GET } = await import("@/app/api/demo-images/[code]/route")
      const res = await GET(new Request("http://local/api/demo-images/P02"), { params: Promise.resolve({ code: "P02" }) })
      expect(res.status).toBe(200)
      expect(res.headers.get("X-Image-Provenance")).toBe("fallback")
      expect(res.headers.get("Content-Type")).toBe("image/svg+xml")
    } finally {
      process.env = { ...original }
    }
  })

  it("编码白名单：非法字符 404（防路径穿越）", async () => {
    const { GET } = await import("@/app/api/demo-images/[code]/route")
    const res = await GET(new Request("http://local/"), { params: Promise.resolve({ code: "../evil" }) })
    expect(res.status).toBe(404)
  })
})

describe("路线完整度（确定性计算）", () => {
  const nodes = [
    { id: "n1", order: 1, label: "HGUC Mk-II", nodeKind: "PRODUCT", productKey: "P09", note: null },
    { id: "n2", order: 2, label: "MG 百式", nodeKind: "PRODUCT", productKey: "P10", note: null },
    { id: "n3", order: 3, label: "MG Zeta", nodeKind: "PRODUCT", productKey: "P02", note: null },
    { id: "m1", order: 4, label: "里程碑", nodeKind: "MILESTONE", productKey: null, note: null },
  ]

  it("完整度=已拥有/全部商品节点；缺口按顺序；里程碑不计入", () => {
    const r = computeRouteProgress("UC", "route-v1", nodes, new Set(["P09"]), new Map([["P09", "P09"]]))
    expect(r.totalProductNodes).toBe(3)
    expect(r.ownedProductNodes).toBe(1)
    expect(r.completionPercent).toBe(33)
    expect(r.completionDisplay).toBe("33%（1/3）")
    expect(r.gaps.map((g) => g.productKey)).toEqual(["P10", "P02"])
    expect(r.nextGap!.productKey).toBe("P10")
  })

  it("空路线完成率 0 且展示 —", () => {
    const r = computeRouteProgress("X", "route-v1", [], new Set(), new Map())
    expect(r.completionPercent).toBe(0)
    expect(r.completionDisplay).toBe("—")
    expect(r.nextGap).toBeNull()
  })
})

describe("DeepSeek 事实保真校验（纯函数）", () => {
  it("金额/日期/链接/百分比/天数片段全部提取并要求保留", () => {
    const draft = "「官方目录」2026-08-20 发布：MG Zeta Ver.Ka 事件价 ¥700.00，停滞 24 天，完成率 33%（2/6）。来源：/demo/sources/E01"
    const fragments = extractFactFragments(draft)
    for (const must of ["¥700.00", "2026-08-20", "/demo/sources/E01", "33%", "24 天"]) {
      expect(fragments).toContain(must)
    }
    expect(validateFactPreservation(draft, draft + "（润色后缀）").ok).toBe(true)
    expect(validateFactPreservation(draft, "价格改为 ¥999").ok).toBe(false)
  })

  it("「」内专名整段保留", () => {
    const draft = "「ARCHIVE Demo Feed」发布"
    expect(extractFactFragments(draft)).toContain("ARCHIVE Demo Feed")
  })
})

describe("目录去重（同步幂等契约，真实 SQLite）", () => {
  it("同一商品 upsert 两次不产生重复行；唯一键约束兜底", async () => {
    const db = getTestDb()
    await resetTestDb()
    const data = {
      id: "lego-99999",
      brand: "LEGO",
      category: "Technic",
      line: "TEST",
      grade: "TECHNIC",
      canonicalName: "Test Kit（99999）",
      releaseYear: 2026,
      source: "https://www.lego.com/en-us/product/test-99999",
      catalogVersion: "official-v1",
    }
    await db.catalogProduct.upsert({ where: { id: data.id }, create: data, update: { canonicalName: data.canonicalName } })
    await db.catalogProduct.upsert({ where: { id: data.id }, create: data, update: { canonicalName: data.canonicalName + " v2" } })
    expect(await db.catalogProduct.count({ where: { id: data.id } })).toBe(1)
    expect((await db.catalogProduct.findUniqueOrThrow({ where: { id: data.id } })).canonicalName).toBe("Test Kit（99999） v2")
  })
})
