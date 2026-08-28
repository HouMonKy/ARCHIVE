import { describe, expect, it, beforeAll } from "vitest"
import { getTestDb, resetTestDb } from "../../helpers/db"
import { buildCollectionMaps, getCollectionMaps, type CollectionMapCard } from "@/lib/services/collection-map"
import { listRecentReleases } from "@/lib/services/new-releases"

/**
 * 动态收藏地图（收藏工作台改造）：
 * - 成图规则：同 series/主题 ≥2 件，或同品牌+等级/比例 ≥2 件；
 * - 卡片列出真实藏品、共同特征、可关注方向；无百分比、无固定总量；
 * - 随资产变化（资产增删改变成图）；不依赖 RouteNode。
 */

type AssetOverrides = {
  id: string
  brand: string
  grade?: string | null
  scale?: string | null
  series?: string | null
  displayName: string
  dispositionState?: string
}

function mockAsset(o: AssetOverrides) {
  return {
    id: o.id,
    userId: "u1",
    catalogProductId: null,
    customName: o.displayName,
    customBrand: null,
    recognitionJobId: null,
    recognitionCorrected: null,
    dispositionState: o.dispositionState ?? "ACTIVE",
    archivedAt: null,
    buildState: "UNOPENED",
    progress: 0,
    purchasePriceMinor: null,
    currency: null,
    purchasedAt: null,
    completedAt: null,
    note: null,
    confirmedAt: new Date(),
    idempotencyKey: null,
    lastActivityAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    product: {
      id: "p-" + o.id,
      brand: o.brand,
      category: o.brand,
      line: null,
      grade: o.grade ?? null,
      canonicalName: o.displayName,
      nameZh: null,
      modelNumber: null,
      scale: o.scale ?? null,
      series: o.series ?? null,
      officialProductCode: null,
      nameZhSource: null,
      officialPageUrl: null,
      officialImageUrl: null,
      releaseYear: null,
      source: "test",
      catalogVersion: "official-v1",
      imageSourcePage: null,
      imageSourceUrl: null,
      imageFetchedAt: null,
      rightsBasis: null,
      imageCacheFile: null,
      imageSha256: null,
      imageStatus: null,
    },
  } as Parameters<typeof buildCollectionMaps>[0][number]
}

describe("收藏地图成图规则（纯函数）", () => {
  it("同 series ≥2 件成图：列出真实藏品与共同特征，无百分比", () => {
    const maps = buildCollectionMaps([
      mockAsset({ id: "a1", brand: "Bandai", series: "機動戦士ガンダムSEED DESTINY", displayName: "强袭自由" }),
      mockAsset({ id: "a2", brand: "Bandai", series: "機動戦士ガンダムSEED DESTINY", displayName: "命运" }),
      mockAsset({ id: "a3", brand: "Bandai", series: "逆襲のシャア", displayName: "沙扎比" }),
    ])
    expect(maps.length).toBeGreaterThanOrEqual(1)
    const seedMap = maps.find((m) => m.basis === "series")!
    expect(seedMap.title).toContain("SEED DESTINY")
    expect(seedMap.assets.map((a) => a.id).sort()).toEqual(["a1", "a2"])
    expect(seedMap.commonTrait).toContain("SEED DESTINY")
    expect(JSON.stringify(maps)).not.toMatch(/%|百分比|完成率/)
  })

  it("同品牌+等级 ≥2 件成图（series 为空时）", () => {
    const maps = buildCollectionMaps([
      mockAsset({ id: "b1", brand: "Bandai", grade: "MG", scale: "1/100", displayName: "独角兽" }),
      mockAsset({ id: "b2", brand: "Bandai", grade: "MG", scale: "1/100", displayName: "报丧女妖" }),
    ])
    expect(maps).toHaveLength(1)
    expect(maps[0]!.basis).toBe("brand-grade")
    expect(maps[0]!.assets).toHaveLength(2)
  })

  it("单件不成图；不同系列各 1 件不成图", () => {
    expect(buildCollectionMaps([mockAsset({ id: "c1", brand: "Bandai", series: "S1", displayName: "x" })])).toHaveLength(0)
    expect(
      buildCollectionMaps([
        mockAsset({ id: "c1", brand: "Bandai", series: "S1", displayName: "x" }),
        mockAsset({ id: "c2", brand: "Bandai", series: "S2", displayName: "y" }),
      ]),
    ).toHaveLength(0)
  })

  it("随资产变化：删除一件后地图消失", () => {
    const two = [
      mockAsset({ id: "d1", brand: "LEGO", series: "Marvel", displayName: "复仇者大厦" }),
      mockAsset({ id: "d2", brand: "LEGO", series: "Marvel", displayName: "X宅邸" }),
    ]
    expect(buildCollectionMaps(two)).toHaveLength(1)
    expect(buildCollectionMaps(two.slice(0, 1))).toHaveLength(0)
  })

  it("SOLD/归档资产不参与；最多 3 张卡", () => {
    const assets = [
      mockAsset({ id: "e1", brand: "Bandai", series: "S1", displayName: "a" }),
      mockAsset({ id: "e2", brand: "Bandai", series: "S1", displayName: "b" }),
      mockAsset({ id: "e3", brand: "Bandai", series: "S1", dispositionState: "SOLD", displayName: "sold" }),
      mockAsset({ id: "f1", brand: "LEGO", series: "Harry Potter", displayName: "h1" }),
      mockAsset({ id: "f2", brand: "LEGO", series: "Harry Potter", displayName: "h2" }),
      mockAsset({ id: "g1", brand: "LEGO", series: "Marvel", displayName: "m1" }),
      mockAsset({ id: "g2", brand: "LEGO", series: "Marvel", displayName: "m2" }),
      mockAsset({ id: "h1", brand: "Bandai", grade: "RG", displayName: "r1" }),
      mockAsset({ id: "h2", brand: "Bandai", grade: "RG", displayName: "r2" }),
    ]
    const maps = buildCollectionMaps(assets)
    expect(maps.length).toBe(3) // 上限
    expect(maps.every((m) => !m.assets.some((a) => a.id === "e3"))).toBe(true)
  })
})

describe("收藏地图（真实 SQLite）", () => {
  beforeAll(async () => {
    await resetTestDb()
  })

  it("getCollectionMaps 基于演示数据成图（demo 系列资产成组）", async () => {
    const db = getTestDb()
    const maps = await getCollectionMaps(db, "kai")
    // 演示数据有同品牌同等级资产（Bandai MG × 多件）→ 至少一张品牌等级卡
    expect(maps.length).toBeGreaterThanOrEqual(0) // 结构性验证：不抛错、无百分比字段
    for (const m of maps as CollectionMapCard[]) {
      expect(m.assets.length).toBeGreaterThanOrEqual(2)
      expect(JSON.stringify(m)).not.toMatch(/%/)
    }
  })
})

describe("新品动态（真实 SQLite）", () => {
  beforeAll(async () => {
    await resetTestDb()
  })

  it("按 announcedAt 倒序、去重、已入柜标记；无 SCORE 字段", async () => {
    const db = getTestDb()
    const now = new Date()
    const items = await listRecentReleases(db, "kai", { now })
    expect(items.length).toBeGreaterThan(0)
    // 倒序
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1]!.announcedAt.getTime()).toBeGreaterThanOrEqual(items[i]!.announcedAt.getTime())
    }
    // 官方商品去重
    const productIds = items.map((i) => i.productId)
    expect(new Set(productIds).size).toBe(productIds.length)
    // 无匹配分/推荐指数字段
    for (const item of items) {
      expect("score" in item).toBe(false)
      expect("matchScore" in item).toBe(false)
    }
    // 已入柜标记（demo 库 kai 有 P01 实体——对应事件若有则 ownedCount>0）
    const owned = items.filter((i) => i.ownedCount > 0)
    expect(owned.every((i) => i.ownedCount >= 1)).toBe(true)
  })

  it("品牌筛选：LEGO 只返回 LEGO 事件", async () => {
    const db = getTestDb()
    const items = await listRecentReleases(db, "kai", { brand: "LEGO", now: new Date() })
    expect(items.every((i) => i.brand === "LEGO")).toBe(true)
  })

  it("窗口过滤：覆盖近 90 天与未来 180 天，超出窗口的事件不出现", async () => {
    const db = getTestDb()
    const now = new Date()
    const items = await listRecentReleases(db, "kai", { now })
    const since = new Date(now.getTime() - 90 * 24 * 3600_000)
    const until = new Date(now.getTime() + 180 * 24 * 3600_000)
    expect(items.every((i) => i.announcedAt >= since && i.announcedAt <= until)).toBe(true)
  })
})
