import { beforeEach, describe, expect, it } from "vitest"
import { getTestDb, resetTestDb } from "../../helpers/db"
import { DEMO_TENANT_USER_ID, OWNER_USER_ID } from "@/lib/auth/service"
import { ensureVisitorShowcase } from "@/lib/services/visitor-seed"

describe("Visitor 面试样例", () => {
  beforeEach(async () => {
    await resetTestDb()
  })

  it("创建 5 件 LEGO + 5 件 Bandai，且不复制 Owner 私有数据", async () => {
    const db = getTestDb()
    const ownerBefore = await db.collectionAsset.count({ where: { userId: OWNER_USER_ID } })

    const result = await ensureVisitorShowcase(db)
    expect(result.createdAssets).toBe(10)
    expect(result.totalAssets).toBe(10)

    const assets = await db.collectionAsset.findMany({
      where: { userId: DEMO_TENANT_USER_ID },
      include: { product: true, cover: true, photos: true },
    })
    expect(assets.filter((asset) => asset.product?.brand === "LEGO")).toHaveLength(5)
    expect(assets.filter((asset) => asset.product?.brand === "Bandai")).toHaveLength(5)
    expect(
      assets.every(
        (asset) =>
          asset.cover === null &&
          asset.photos.length === 0 &&
          asset.note === null &&
          asset.recognitionJobId === null &&
          asset.recognitionCorrected === null,
      ),
    ).toBe(true)
    expect(await db.collectionAsset.count({ where: { userId: OWNER_USER_ID } })).toBe(ownerBefore)
  })

  it("重复执行幂等，不覆盖或重复创建样例", async () => {
    const db = getTestDb()
    await ensureVisitorShowcase(db)
    const second = await ensureVisitorShowcase(db)

    expect(second.createdProducts).toBe(0)
    expect(second.createdAssets).toBe(0)
    expect(second.totalAssets).toBe(10)
  })
})
