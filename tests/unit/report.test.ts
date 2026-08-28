import { describe, expect, it, beforeAll } from "vitest"
import { getTestDb, resetTestDb } from "../helpers/db"
import {
  generateReport,
  getLatestReportView,
  scoreReleaseEvents,
  GENERATOR_VERSION,
  type ScoringEventInput,
  type ScoringContext,
} from "@/lib/services/report"
import { recordFeedback } from "@/lib/services/feedback"
import { demoNow } from "@/lib/clock"

function buildContext(overrides: Partial<ScoringContext> = {}): ScoringContext {
  return {
    ownedProductIds: new Set(["P03"]),
    suppressedProductIds: new Set(),
    preferences: { category: "Gundam", grade: "MG", route: "UC", monthlyBudgetMinor: 200000 },
    distinctActiveProductsByLine: new Map([["UC", 6]]),
    positiveFeedbackGrades: new Set(),
    negativeFeedbackGrades: new Set(),
    now: demoNow(),
    ...overrides,
  }
}

function demoEvents(): ScoringEventInput[] {
  return [
    {
      id: "E01",
      title: "MG Zeta Gundam Ver.Ka 补货发售（演示事件）",
      announcedAt: new Date("2026-08-20T00:00:00+08:00"),
      sourceUrl: "/demo/sources/E01",
      sourceName: "ARCHIVE Demo Feed",
      priceMinor: 70000,
      product: { id: "P02", canonicalName: "MG Zeta Gundam Ver.Ka", category: "Gundam", grade: "MG", line: "UC" },
    },
    {
      id: "E02",
      title: "HGUC Narrative Gundam C-Packs 新品（演示事件）",
      announcedAt: new Date("2026-08-18T00:00:00+08:00"),
      sourceUrl: "/demo/sources/E02",
      sourceName: "ARCHIVE Demo Feed",
      priceMinor: 28000,
      product: { id: "P06", canonicalName: "HGUC Narrative Gundam C-Packs", category: "Gundam", grade: "HG", line: "UC" },
    },
    {
      id: "E03",
      title: "MG Freedom Gundam Ver.2.0 再版（演示事件）",
      announcedAt: new Date("2026-08-15T00:00:00+08:00"),
      sourceUrl: "/demo/sources/E03",
      sourceName: "ARCHIVE Demo Feed",
      priceMinor: 55000,
      product: { id: "P12", canonicalName: "MG Freedom Gundam Ver.2.0", category: "Gundam", grade: "MG", line: "CE" },
    },
    {
      id: "E04",
      title: "MGEX Unicorn Gundam Ver.Ka 限定套装（演示事件）",
      announcedAt: new Date("2026-08-22T00:00:00+08:00"),
      sourceUrl: "/demo/sources/E04",
      sourceName: "ARCHIVE Demo Feed",
      priceMinor: 130000,
      product: { id: "P03", canonicalName: "MGEX Unicorn Gundam Ver.Ka", category: "Gundam", grade: "MGEX", line: "UC" },
    },
  ]
}

describe("新品事件打分（PRD §19 固定公式，不重归一化）", () => {
  it("初始排序必须是 P02=90、P06=75、P12=55，P03 因已拥有被排除", () => {
    const scored = scoreReleaseEvents(demoEvents(), buildContext())
    expect(scored.map((c) => c.productId)).toEqual(["P02", "P06", "P12"])
    expect(scored.map((c) => c.score)).toEqual([90, 75, 55])
    expect(scored[0]!.reasonCodes).toEqual(["PREF_CATEGORY", "PREF_GRADE", "PREF_ROUTE", "COMPLEMENT", "BUDGET_OK", "RECENT_RELEASE"])
    expect(scored[1]!.reasonCodes).toEqual(["PREF_CATEGORY", "PREF_ROUTE", "COMPLEMENT", "BUDGET_OK", "RECENT_RELEASE"])
    expect(scored[2]!.reasonCodes).toEqual(["PREF_CATEGORY", "PREF_GRADE", "BUDGET_OK", "RECENT_RELEASE"])
  })

  it("30 日内“不感兴趣”的商品被排除（FR-09 抑制）", () => {
    const scored = scoreReleaseEvents(demoEvents(), buildContext({ suppressedProductIds: new Set(["P02"]) }))
    expect(scored.map((c) => c.productId)).toEqual(["P06", "P12"])
  })

  it("近 90 日同等级正反馈加 10 分", () => {
    const scored = scoreReleaseEvents(demoEvents(), buildContext({ positiveFeedbackGrades: new Set(["MG"]) }))
    expect(scored.map((c) => [c.productId, c.score])).toEqual([
      ["P02", 100],
      ["P06", 75],
      ["P12", 65],
    ])
  })

  it("同等级存在负反馈时不加分", () => {
    const scored = scoreReleaseEvents(
      demoEvents(),
      buildContext({ positiveFeedbackGrades: new Set(["MG"]), negativeFeedbackGrades: new Set(["MG"]) }),
    )
    expect(scored[0]!.score).toBe(90)
  })

  it("事件价高于显式月预算时不加预算分", () => {
    const scored = scoreReleaseEvents(demoEvents(), buildContext({ preferences: { category: "Gundam", grade: "MG", route: "UC", monthlyBudgetMinor: 50000 } }))
    expect(scored.map((c) => [c.productId, c.score])).toEqual([
      ["P02", 75],
      ["P06", 75],
      ["P12", 40],
    ])
  })

  it("无事件时返回空列表（本周无建议，不编造）", () => {
    expect(scoreReleaseEvents([], buildContext())).toEqual([])
  })
})

describe("周报生成（幂等 / 解锁 / 引用校验 / 跨期抑制）", () => {
  beforeAll(async () => {
    await resetTestDb()
  })

  it("首份周报包含 3 条洞察：P02 推荐(90) + A02 停滞(24) + 完成率 33%", async () => {
    const db = getTestDb()
    const result = await generateReport(db, "kai", demoNow())
    expect(result.status).toBe("OK")
    expect(result.created).toBe(true)
    expect(result.insightCount).toBe(3)
    const insights = await db.insight.findMany({ orderBy: { sortOrder: "asc" } })
    expect(insights.map((i) => i.type)).toEqual([
      "NEW_PRODUCT_RECOMMENDATION",
      "STALLED_BUILDING",
      "STRUCTURE_COMPLETION",
    ])
    expect(insights[0]!.score).toBe(90)
    expect(insights[0]!.productId).toBe("P02")
    expect(insights[0]!.sourceUrl).toBe("/demo/sources/E01")
    expect(insights[0]!.sourceDate).toEqual(new Date("2026-08-20T00:00:00+08:00"))
    expect(insights[1]!.assetId).toBe("A02")
    expect(insights[1]!.score).toBe(24)
    expect(insights[2]!.score).toBe(33)
    expect(insights[2]!.sourceUrl).toBe("/")
    const report = await db.insightReport.findFirstOrThrow()
    expect(report.generatorVersion).toBe(GENERATOR_VERSION)
    // 真实快照标识：数据集版本 + 本次事务实际读取数据的指纹
    expect(report.snapshotVersion).toMatch(/^demo-v1:snap-[0-9a-f]{12}$/)
  })

  it("同一周期重复生成只保留一期（幂等）", async () => {
    const db = getTestDb()
    const result = await generateReport(db, "kai", demoNow())
    expect(result.created).toBe(false)
    expect(await db.insightReport.count()).toBe(1)
    expect(await db.insight.count()).toBe(3)
  })

  it("洞察引用的商品、实体与来源均真实存在（D-07）", async () => {
    const db = getTestDb()
    const insights = await db.insight.findMany({ include: { product: true, asset: true } })
    for (const i of insights) {
      if (i.productId) expect(i.product).not.toBeNull()
      if (i.assetId) expect(i.asset).not.toBeNull()
      expect(i.sourceUrl).toBeTruthy()
      expect(i.sourceDate).not.toBeNull()
    }
    const rec = insights.find((i) => i.type === "NEW_PRODUCT_RECOMMENDATION")!
    expect(rec.product?.canonicalName).toBe("MG Zeta Gundam Ver.Ka")
  })

  it("少于 3 件确认收藏时锁定且不创建报告（FR-07）", async () => {
    await resetTestDb({ assets: "minimal", intents: false })
    const db = getTestDb()
    const result = await generateReport(db, "kai", demoNow())
    expect(result.status).toBe("LOCKED")
    expect(result.needMoreCount).toBe(1)
    expect(await db.insightReport.count()).toBe(0)
    const view = await getLatestReportView(db, "kai", demoNow())
    expect(view.locked).toBe(true)
    expect(view.currentCount).toBe(2)
  })

  it("无新品事件时生成报告但明确“本周无新品建议”，不编造推荐", async () => {
    await resetTestDb({ assets: "all", events: false })
    const db = getTestDb()
    const result = await generateReport(db, "kai", demoNow())
    expect(result.status).toBe("OK")
    const view = await getLatestReportView(db, "kai", demoNow())
    expect(view.report?.hasRecommendation).toBe(false)
    expect(view.report?.noRecommendationNotice).toContain("暂无新品动态")
    const recCount = await db.insight.count({ where: { type: "NEW_PRODUCT_RECOMMENDATION" } })
    expect(recCount).toBe(0)
  })

  it("“不感兴趣”后跨周期重新生成：P02 被抑制 30 天，P06 成为首选", async () => {
    await resetTestDb()
    const db = getTestDb()
    await generateReport(db, "kai", demoNow())
    const p02Insight = await db.insight.findFirstOrThrow({ where: { type: "NEW_PRODUCT_RECOMMENDATION" } })
    await recordFeedback(db, "kai", p02Insight.id, { value: "NOT_INTERESTED" })

    const nextWeek = new Date("2026-09-01T00:00:00+08:00")
    const result = await generateReport(db, "kai", nextWeek)
    expect(result.created).toBe(true)
    expect(await db.insightReport.count()).toBe(2)

    const newReport = await db.insightReport.findFirstOrThrow({
      where: { periodEnd: new Date("2026-09-01T00:00:00+08:00") },
      include: { insights: true },
    })
    const rec = newReport.insights.find((i) => i.type === "NEW_PRODUCT_RECOMMENDATION")!
    expect(rec.productId).toBe("P06")
    expect(rec.score).toBe(75)
    expect(newReport.insights.some((i) => i.productId === "P02")).toBe(false)
    // 停滞提醒在跨期后仍引用同一真实实体
    const stalled = newReport.insights.find((i) => i.type === "STALLED_BUILDING")!
    expect(stalled.assetId).toBe("A02")
  })

  it("视图层返回最新一期与反馈状态", async () => {
    await resetTestDb()
    const db = getTestDb()
    await generateReport(db, "kai", demoNow())
    const view = await getLatestReportView(db, "kai", demoNow())
    expect(view.report).not.toBeNull()
    expect(view.report!.insights).toHaveLength(3)
    expect(view.report!.insights[0]!.typeLabel).toBe("新品动态")
    expect(view.report!.insights[0]!.productName).toBe("MG Zeta Gundam Ver.Ka")
    expect(view.canGenerate).toBe(false)
  })
})
