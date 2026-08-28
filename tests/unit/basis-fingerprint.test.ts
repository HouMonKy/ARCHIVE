import { describe, expect, it } from "vitest"
import { getTestDb, resetTestDb } from "../helpers/db"
import { generateReport, computeSnapshotVersion } from "@/lib/services/report"
import { recordFeedback } from "@/lib/services/feedback"
import { recommendationBasisFingerprint } from "@/lib/report/basis"
import { demoNow } from "@/lib/clock"

/**
 * 负反馈依据指纹（返工任务 3 / FR-09）：
 * - “不感兴趣”保存反馈时点的推荐依据指纹；
 * - 30 天内依据未变 → 继续抑制；依据实质变化（分数/理由码/事件价格/来源/日期）→ 允许重新推荐。
 */
describe("推荐依据指纹", () => {
  it("指纹由 productId/score/reasonCodes/价格/来源/日期决定；任一变化则指纹变化", () => {
    const base = {
      productId: "P02",
      score: 90,
      reasonCodes: ["PREF_CATEGORY", "BUDGET_OK"],
      eventPriceMinor: 70000,
      sourceUrl: "/demo/sources/E01",
      sourceDate: new Date("2026-08-20T00:00:00+08:00"),
    }
    const fingerprint = recommendationBasisFingerprint(base)
    expect(fingerprint).toBe(recommendationBasisFingerprint({ ...base }))
    // 分数变化（依据变化）
    expect(recommendationBasisFingerprint({ ...base, score: 75 })).not.toBe(fingerprint)
    // 理由码变化
    expect(recommendationBasisFingerprint({ ...base, reasonCodes: ["PREF_CATEGORY"] })).not.toBe(fingerprint)
    // 理由码顺序无关（同一依据集合）
    expect(recommendationBasisFingerprint({ ...base, reasonCodes: ["BUDGET_OK", "PREF_CATEGORY"] })).toBe(fingerprint)
    // 事件价格变化（依据实质变化）
    expect(recommendationBasisFingerprint({ ...base, eventPriceMinor: 90000 })).not.toBe(fingerprint)
    // 价格为 null 与有值不同
    expect(recommendationBasisFingerprint({ ...base, eventPriceMinor: null })).not.toBe(fingerprint)
    // 来源日期变化
    expect(
      recommendationBasisFingerprint({ ...base, sourceDate: new Date("2026-08-21T00:00:00+08:00") }),
    ).not.toBe(fingerprint)
  })

  it("记录“不感兴趣”反馈时保存依据指纹；有用/行动反馈不保存", async () => {
    await resetTestDb()
    const db = getTestDb()
    await generateReport(db, "kai", demoNow())
    const rec = await db.insight.findFirstOrThrow({ where: { type: "NEW_PRODUCT_RECOMMENDATION" } })

    const notInterested = await recordFeedback(db, "kai", rec.id, { value: "NOT_INTERESTED" })
    expect(notInterested.basisFingerprint).toMatch(/^[0-9a-f]{64}$/)

    const useful = await recordFeedback(db, "kai", rec.id, { value: "USEFUL" })
    expect(useful.basisFingerprint).toBeNull()
  })
})

describe("依据指纹驱动的 30 天抑制", () => {
  it("依据未变：30 天内同商品继续被抑制", async () => {
    await resetTestDb()
    const db = getTestDb()
    await generateReport(db, "kai", demoNow()) // P02 推荐
    const rec = await db.insight.findFirstOrThrow({ where: { type: "NEW_PRODUCT_RECOMMENDATION" } })
    await recordFeedback(db, "kai", rec.id, { value: "NOT_INTERESTED" })

    const nextWeek = new Date("2026-09-01T00:00:00+08:00")
    await generateReport(db, "kai", nextWeek)
    const newReport = await db.insightReport.findFirstOrThrow({
      where: { periodEnd: new Date("2026-09-01T00:00:00+08:00") },
      include: { insights: true },
    })
    const nextRec = newReport.insights.find((i) => i.type === "NEW_PRODUCT_RECOMMENDATION")!
    expect(nextRec.productId).toBe("P06") // P02 依据未变被抑制，P06 顶上
    expect(newReport.insights.some((i) => i.productId === "P02")).toBe(false)
  })

  it("依据实质变化：事件价格改变后 P02 允许重新推荐", async () => {
    await resetTestDb()
    const db = getTestDb()
    await generateReport(db, "kai", demoNow())
    const rec = await db.insight.findFirstOrThrow({ where: { type: "NEW_PRODUCT_RECOMMENDATION" } })
    await recordFeedback(db, "kai", rec.id, { value: "NOT_INTERESTED" })

    // 反馈依据（E01 事件价格）实质变化：70,000 → 90,000（仍在预算内，但指纹必变）
    await db.releaseEvent.update({ where: { id: "E01" }, data: { priceMinor: 90000 } })

    const nextWeek = new Date("2026-09-01T00:00:00+08:00")
    await generateReport(db, "kai", nextWeek)
    const newReport = await db.insightReport.findFirstOrThrow({
      where: { periodEnd: new Date("2026-09-01T00:00:00+08:00") },
      include: { insights: true },
    })
    const nextRec = newReport.insights.find((i) => i.type === "NEW_PRODUCT_RECOMMENDATION")!
    expect(nextRec.productId).toBe("P02") // 依据变化 → 重新推荐 P02
    expect(nextRec.score).toBe(90) // 价格仍在预算内，分数不变
  })

  it("无指纹的旧反馈数据按“依据未变”保守抑制（向后兼容）", async () => {
    await resetTestDb()
    const db = getTestDb()
    await generateReport(db, "kai", demoNow())
    const rec = await db.insight.findFirstOrThrow({ where: { type: "NEW_PRODUCT_RECOMMENDATION" } })
    // 模拟迁移前的旧数据：basisFingerprint 为 null
    await db.insightFeedback.create({
      data: { insightId: rec.id, userId: "kai", value: "NOT_INTERESTED", actedAt: demoNow(), basisFingerprint: null },
    })
    const nextWeek = new Date("2026-09-01T00:00:00+08:00")
    await generateReport(db, "kai", nextWeek)
    const newReport = await db.insightReport.findFirstOrThrow({
      where: { periodEnd: new Date("2026-09-01T00:00:00+08:00") },
      include: { insights: true },
    })
    expect(newReport.insights.some((i) => i.productId === "P02")).toBe(false)
  })

  it("反馈抑制已过期后，仍不把 90 天窗口外的旧事件重新包装成新品", async () => {
    await resetTestDb()
    const db = getTestDb()
    await generateReport(db, "kai", demoNow())
    const rec = await db.insight.findFirstOrThrow({ where: { type: "NEW_PRODUCT_RECOMMENDATION" } })
    await recordFeedback(db, "kai", rec.id, { value: "NOT_INTERESTED" })

    const farFuture = new Date("2026-12-15T00:00:00+08:00") // 反馈过期，且事件已超过 90 天新品窗口
    await generateReport(db, "kai", farFuture)
    const newReport = await db.insightReport.findFirstOrThrow({
      where: { periodEnd: new Date("2026-12-15T00:00:00+08:00") },
      include: { insights: true },
    })
    const nextRec = newReport.insights.find((i) => i.type === "NEW_PRODUCT_RECOMMENDATION")
    expect(nextRec).toBeUndefined()
  })
})

describe("周报真实快照标识", () => {
  it("同一输入数据得到相同快照标识；数据变化得到不同标识", async () => {
    await resetTestDb()
    const db = getTestDb()

    const first = await generateReport(db, "kai", new Date("2026-08-25T00:00:00+08:00"))
    const second = await generateReport(db, "kai", new Date("2026-09-01T00:00:00+08:00"))
    // 跨期两份报告：输入数据相同（含反馈累计差异？second 生成时无新反馈）——注意第二期多了一份反馈记录吗？
    // 第一期生成后没有记录反馈，因此两期读取的 feedbacks 相同 → 快照相同
    expect(first.snapshotVersion).toMatch(/^demo-v1:snap-[0-9a-f]{12}$/)
    expect(second.snapshotVersion).toBe(first.snapshotVersion)

    // 数据变化：新增一件实体 → 下一期快照标识变化
    await db.collectionAsset.create({
      data: {
        userId: "kai",
        catalogProductId: "P05",
        dispositionState: "ACTIVE",
        buildState: "UNOPENED",
        progress: 0,
        confirmedAt: new Date("2026-09-02T00:00:00+08:00"),
        lastActivityAt: new Date("2026-09-02T00:00:00+08:00"),
      },
    })
    const third = await generateReport(db, "kai", new Date("2026-09-08T00:00:00+08:00"))
    expect(third.snapshotVersion).not.toBe(second.snapshotVersion)
    expect(third.snapshotVersion).toMatch(/^demo-v1:snap-[0-9a-f]{12}$/)
  })

  it("computeSnapshotVersion 对字段级变化敏感（纯函数）", () => {
    const base = {
      events: [{ id: "E01", announcedAt: new Date("2026-08-20T00:00:00+08:00"), priceMinor: 70000, catalogProductId: "P02" }],
      preferences: [{ kind: "GRADE", value: "MG" }],
      assets: [{ id: "A01", catalogProductId: "P01", dispositionState: "ACTIVE", buildState: "COMPLETED", progress: 100, lastActivityAt: new Date("2026-08-10T00:00:00+08:00") }],
      feedbacks: [] as { id: string; value: string; actedAt: Date; basisFingerprint: string | null }[],
    }
    const v1 = computeSnapshotVersion(base)
    // 同构输入（Date 对象独立实例）得到相同标识
    const sameData = {
      events: [{ id: "E01", announcedAt: new Date("2026-08-20T00:00:00+08:00"), priceMinor: 70000, catalogProductId: "P02" }],
      preferences: [{ kind: "GRADE", value: "MG" }],
      assets: [{ id: "A01", catalogProductId: "P01", dispositionState: "ACTIVE", buildState: "COMPLETED", progress: 100, lastActivityAt: new Date("2026-08-10T00:00:00+08:00") }],
      feedbacks: [] as { id: string; value: string; actedAt: Date; basisFingerprint: string | null }[],
    }
    expect(computeSnapshotVersion(sameData)).toBe(v1)
    expect(computeSnapshotVersion({ ...base, events: [{ ...base.events[0]!, priceMinor: 80000 }] })).not.toBe(v1)
    expect(computeSnapshotVersion({ ...base, assets: [{ ...base.assets[0]!, progress: 99 }] })).not.toBe(v1)
    // （返工轮任务 3）反馈不参与过期标识：反馈只影响后续打分（30 天抑制），
    // 不构成建议过期——否则每次反馈都会触发原位替换并丢失反馈历史
    expect(
      computeSnapshotVersion({ ...base, feedbacks: [{ id: "f1", value: "USEFUL", actedAt: new Date("2026-08-24T00:00:00+08:00"), basisFingerprint: null }] }),
    ).toBe(v1)
  })
})
