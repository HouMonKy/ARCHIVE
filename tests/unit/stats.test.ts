import { describe, expect, it } from "vitest"
import { getTestDb, resetTestDb } from "../helpers/db"
import { getDashboardStats } from "@/lib/services/stats"
import { demoNow } from "@/lib/clock"

/**
 * D-05：Dashboard 对 8 条固定种子数据算出确定的数量、成本、缺价数和完成率。
 * 口径见 PRD §7 / §19：实体总记录 8、当前收藏 7、不同 SKU 7、累计成本 372000 分、
 * 缺价 1、可制作 6、完成 2、完成率 33%、品牌 Bandai 6/LEGO 1、A02 停滞。
 */
describe("Dashboard 统计口径（PRD §7/§19）", () => {
  it("固定种子数据得到 D-05 的全部确定数字", async () => {
    await resetTestDb()
    const stats = await getDashboardStats(getTestDb(), "kai", demoNow())
    expect(stats.totalRecords).toBe(8)
    expect(stats.currentCollection).toBe(7)
    expect(stats.distinctSku).toBe(7)
    expect(stats.cumulativeCostMinor).toBe(372000)
    expect(stats.missingPriceCount).toBe(1)
    expect(stats.buildableCount).toBe(6)
    expect(stats.completedCount).toBe(2)
    expect(stats.completionRatePercent).toBe(33)
    expect(stats.completionDisplay).toBe("33%（2/6）")
    const bandai = stats.brandDistribution.find((b) => b.key === "Bandai")
    const lego = stats.brandDistribution.find((b) => b.key === "LEGO")
    expect(bandai?.count).toBe(6)
    expect(lego?.count).toBe(1)
    expect(stats.stalled).toHaveLength(1)
    expect(stats.stalled[0]).toMatchObject({ assetId: "A02", days: 24 })
  })

  it("等级分布为 MG2/RG2/HG1/MGEX1/其他1，且每个分布项带下钻链接", async () => {
    await resetTestDb()
    const stats = await getDashboardStats(getTestDb(), "kai", demoNow())
    const gradeCounts = Object.fromEntries(stats.gradeDistribution.map((g) => [g.key, g.count]))
    expect(gradeCounts).toEqual({ MG: 2, RG: 2, HG: 1, MGEX: 1, 其他: 1 })
    for (const item of [...stats.gradeDistribution, ...stats.brandDistribution, ...stats.buildStateDistribution]) {
      expect(item.href.startsWith("/collection?")).toBe(true)
    }
  })

  it("已售出（SOLD）实体不计入当前收藏、成本与完成率", async () => {
    await resetTestDb()
    const db = getTestDb()
    // A07（P11，SOLD）本来就不计入；再把 A06（P10，ACTIVE）标记为 SOLD 验证动态口径
    await db.collectionAsset.update({ where: { id: "A06" }, data: { dispositionState: "SOLD" } })
    const stats = await getDashboardStats(db, "kai", demoNow())
    expect(stats.currentCollection).toBe(6)
    expect(stats.cumulativeCostMinor).toBe(322000) // 372000 - 50000(A06)
    expect(stats.buildableCount).toBe(5)
    expect(stats.distinctSku).toBe(6)
  })

  it("归档实体不计入当前收藏统计", async () => {
    await resetTestDb()
    const db = getTestDb()
    await db.collectionAsset.update({ where: { id: "A03" }, data: { archivedAt: demoNow() } })
    const stats = await getDashboardStats(db, "kai", demoNow())
    expect(stats.currentCollection).toBe(6)
    expect(stats.distinctSku).toBe(6)
  })

  it("NOT_APPLICABLE 实体不计入完成率分母", async () => {
    await resetTestDb()
    const db = getTestDb()
    await db.collectionAsset.update({ where: { id: "A03" }, data: { buildState: "NOT_APPLICABLE", progress: 0 } })
    const stats = await getDashboardStats(db, "kai", demoNow())
    expect(stats.buildableCount).toBe(5)
    expect(stats.completionDisplay).toBe("40%（2/5）")
  })

  it("同 SKU 多件只计一个 SKU；自定义商品按规范化名称去重", async () => {
    await resetTestDb()
    const db = getTestDb()
    const now = demoNow()
    await db.collectionAsset.create({
      data: {
        id: "A09",
        userId: "kai",
        catalogProductId: "P01",
        dispositionState: "ACTIVE",
        buildState: "UNOPENED",
        progress: 0,
        confirmedAt: now,
        lastActivityAt: now,
      },
    })
    await db.collectionAsset.create({
      data: {
        id: "A10",
        userId: "kai",
        customName: "technic supercar demo",
        customBrand: "LEGO",
        dispositionState: "ACTIVE",
        buildState: "NOT_APPLICABLE",
        progress: 0,
        confirmedAt: now,
        lastActivityAt: now,
      },
    })
    const stats = await getDashboardStats(db, "kai", demoNow())
    // 当前收藏 9（7+2），但 SKU = 6 目录 + 1 自定义（大小写规范化后与 A08 同名）= 7
    expect(stats.currentCollection).toBe(9)
    expect(stats.distinctSku).toBe(7)
  })

  it("空收藏返回 isEmpty 并提供空态入口数据", async () => {
    await resetTestDb({ assets: "none", intents: false })
    const stats = await getDashboardStats(getTestDb(), "kai", demoNow())
    expect(stats.isEmpty).toBe(true)
    expect(stats.currentCollection).toBe(0)
    expect(stats.cumulativeCostMinor).toBe(0)
    expect(stats.completionDisplay).toBe("—")
  })
})
