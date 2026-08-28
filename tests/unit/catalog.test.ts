import { describe, expect, it, beforeAll } from "vitest"
import { getTestDb, resetTestDb } from "../helpers/db"
import { listCatalogWithOwnedCounts } from "@/lib/services/catalog"

describe("商品目录（版本化与图片来源记录）", () => {
  beforeAll(async () => {
    await resetTestDb()
  })

  it("目录固定 12 条且每条都有 Bandai 官网来源记录（PRD §19）", async () => {
    const catalog = await listCatalogWithOwnedCounts(getTestDb(), "kai")
    expect(catalog).toHaveLength(12)
    expect(catalog.map((c) => c.id)).toEqual([
      "P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10", "P11", "P12",
    ])
    for (const c of catalog) {
      expect(c.brand).toBe("Bandai")
      expect(c.category).toBe("Gundam")
      expect(c.imageSourcePage).toMatch(/^https:\/\/bandai-hobby\.net\/item\//)
      expect(c.imageSourceUrl).toMatch(/^https:\/\/(bandai-hobby\.net|bandai-a\.akamaihd\.net)\//)
      expect(c.rightsBasis).toBe("personal-use")
    }
  })

  it("ownedCount 只统计当前收藏：P03=1、P11=0（A07 已售出不计）", async () => {
    const catalog = await listCatalogWithOwnedCounts(getTestDb(), "kai")
    const byId = Object.fromEntries(catalog.map((c) => [c.id, c.ownedCount]))
    expect(byId["P03"]).toBe(1)
    expect(byId["P11"]).toBe(0)
    expect(byId["P01"]).toBe(1)
    expect(byId["P02"]).toBe(0)
  })
})
