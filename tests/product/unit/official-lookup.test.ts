import { describe, expect, it, afterEach, vi } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { parseManualSearch, parseManualDetail, parseReleaseYear, seriesToLine, extractModelNumber, lookupLegoDraft, lookupBandai } from "@/lib/services/official-lookup"

/**
 * Bandai manual.bandai-hobby.net 按需查询解析器：
 * - 搜索结果行解析（真实页面快照，2026-08-26 抓取）；
 * - 详情页解析（品番/発売日/ブランド/作品/官网图/PDF）；
 * - 行打分：基础款优先于变体（[メカニカルクリア] 等后缀降权）；
 * - LEGO 套装编号 draft 构造。
 */

const FIXTURES = path.resolve(process.cwd(), "tests/product/fixtures")
const SEARCH_HTML = readFileSync(path.join(FIXTURES, "bandai-manual-search-freedom.html"), "utf-8")
const DETAIL_HTML = readFileSync(path.join(FIXTURES, "bandai-manual-detail-646.html"), "utf-8")

describe("manual.bandai-hobby.net 搜索结果解析（真实页面快照）", () => {
  it("按商品名搜索：返回行含 detailId/名称/发售日", () => {
    const html = readFileSync(path.join(FIXTURES, "bandai-manual-search-freedom.html"), "utf-8")
    const rows = parseManualSearch(html)
    expect(rows.length).toBeGreaterThan(10)
    const mgex = rows.find((r) => r.detailId === "646")
    expect(mgex).toBeDefined()
    expect(mgex!.name).toContain("MGEX 1/100 ストライクフリーダムガンダム")
    expect(mgex!.name).not.toContain("発売日")
    expect(mgex!.releaseDate).toBe("2022年11月19日")
  })

  it("同 detailId 去重", () => {
    const html = readFileSync(path.join(FIXTURES, "bandai-manual-search-freedom.html"), "utf-8")
    const rows = parseManualSearch(html)
    const ids = rows.map((r) => r.detailId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe("manual.bandai-hobby.net 商品详情解析（真实页面快照）", () => {
  it("MGEX 详情：品番 2583176 / 発売日 2022-11-19 / ブランド MGEX / 作品 SEED DESTINY / 官网图", () => {
    const html = readFileSync(path.join(FIXTURES, "bandai-manual-detail-646.html"), "utf-8")
    const detail = parseManualDetail(html, "646")
    expect(detail.name).toBe("MGEX 1/100 ストライクフリーダムガンダム")
    expect(detail.productCode).toBe("2583176")
    expect(detail.releaseDate).toBe("2022年11月19日発売")
    expect(detail.brand).toBe("MGEX")
    expect(detail.series).toBe("機動戦士ガンダムSEED DESTINY")
    expect(detail.imageUrl).toBe("https://bandai-hobby.net/images/196_5149_s_4h4ix8i0czfctrqhwa4e0dygycqs.jpg")
    expect(detail.manualPdfUrl).toContain("/viewer.php?file=/pdf/646.pdf")
  })
})

describe("辅助解析", () => {
  it("发售年解析", () => {
    expect(parseReleaseYear("2022年11月19日発売")).toBe(2022)
    expect(parseReleaseYear(null)).toBeNull()
  })

  it("作品 → 系列线归一", () => {
    expect(seriesToLine("機動戦士ガンダムSEED DESTINY")).toBe("CE")
    expect(seriesToLine("機動戦士ガンダムSEED")).toBe("CE")
    expect(seriesToLine("機動戦士ガンダム 逆襲のシャア")).toBe("UC")
    expect(seriesToLine(null)).toBe("OTHER")
  })

  it("机体型号提取", () => {
    expect(extractModelNumber("RG 1/144 ZGMF-X20A STRIKE FREEDOM GUNDAM")).toBe("ZGMF-X20A")
    expect(extractModelNumber("MGEX 1/100 ストライクフリーダムガンダム")).toBeNull()
  })
})

describe("lookupBandai 行打分与官网建档（网络层 mock：搜索/详情用真实页面快照）", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("基础款优先于变体：MGEX 强袭自由 → bandai-manual-646（非 4196 メカニカルクリア）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input)
        if (url.includes("freeword=")) {
          return new Response(SEARCH_HTML, { status: 200, headers: { "content-type": "text/html" } })
        }
        if (url.includes("/menus/detail/646")) {
          return new Response(DETAIL_HTML, { status: 200, headers: { "content-type": "text/html" } })
        }
        return new Response("not found", { status: 404 })
      }),
    )
    const draft = await lookupBandai({ name: "MGEX 1/100 ストライクフリーダムガンダム", grade: "MGEX", modelNumber: "ZGMF-X20A" })
    expect(draft).not.toBeNull()
    expect(draft!.id).toBe("bandai-manual-646")
    expect(draft!.canonicalName).toBe("MGEX 1/100 ストライクフリーダムガンダム")
    expect(draft!.nameZh).toBe("MGEX 1/100 强袭自由高达")
    expect(draft!.modelNumber).toBe("ZGMF-X20A")
    expect(draft!.officialProductCode).toBe("2583176")
    expect(draft!.officialPageUrl).toBe("https://manual.bandai-hobby.net/menus/detail/646")
    expect(draft!.officialImageUrl).toContain("bandai-hobby.net")
  })

  it("低分结果拒绝建档（评分 < 4 → null，不臆造）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(SEARCH_HTML, { status: 200, headers: { "content-type": "text/html" } })),
    )
    const draft = await lookupBandai({ name: "完全无关的名字", grade: "SD" })
    expect(draft).toBeNull()
  })
})

describe("LEGO 套装编号 draft", () => {
  it("42172：官方主图 + 美国官网页；R9 名称策略——nameZh 恒 null、canonicalName=官网英文", () => {
    const draft = lookupLegoDraft({ setNumber: "42172", name: "McLaren P1", series: "Technic" })
    expect(draft.id).toBe("lego-42172")
    expect(draft.brand).toBe("LEGO")
    expect(draft.nameZh).toBeNull()
    expect(draft.nameZhSource).toBeNull()
    expect(draft.officialImageUrl).toBe("https://www.lego.com/cdn/product-assets/product.img.pri/42172_Prod.png")
    expect(draft.officialPageUrl).toBe("https://www.lego.com/en-us/product/mclaren-p1-42172")
    expect(draft.modelNumber).toBe("42172")
    expect(draft.canonicalName).toBe("McLaren P1")
    expect(draft.grade).toBe("TECHNIC")
  })

  it("76178：主题来自识别 series，不能写死 TECHNIC", () => {
    const draft = lookupLegoDraft({ setNumber: "76178", name: "Daily Bugle（76178）", series: "Marvel" })
    expect(draft.category).toBe("LEGO")
    expect(draft.line).toBeNull()
    expect(draft.grade).toBe("MARVEL")
    expect(draft.series).toBe("Marvel")
    expect(draft.officialPageUrl).toBe("https://www.lego.com/en-us/product/daily-bugle-76178")
    expect(draft.canonicalName).toBe("Daily Bugle")
  })

  it("未收录套装：官网页为 null，但主图 URL 仍为官方标准地址（可验证）；canonicalName 为英文", () => {
    const draft = lookupLegoDraft({ setNumber: "99999", name: "Unknown Set" })
    expect(draft.nameZh).toBeNull()
    expect(draft.officialPageUrl).toBeNull()
    expect(draft.canonicalName).toBe("Unknown Set")
    expect(draft.officialImageUrl).toBe("https://www.lego.com/cdn/product-assets/product.img.pri/99999_Prod.png")
  })
})
