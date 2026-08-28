import type { PrismaClient } from "@prisma/client"
import { DEMO_TENANT_USER_ID } from "../auth/service"
import { VISITOR_ASSETS, VISITOR_CATALOG_PRODUCTS } from "../visitor-dataset"

export interface VisitorSeedResult {
  createdProducts: number
  createdAssets: number
  totalAssets: number
}

/**
 * 幂等创建 Visitor 的 5 + 5 面试样例。
 * 只创建固定 ID 的缺失行，绝不更新或删除 Owner / Visitor 已有数据。
 */
export async function ensureVisitorShowcase(db: PrismaClient): Promise<VisitorSeedResult> {
  await db.user.upsert({
    where: { id: DEMO_TENANT_USER_ID },
    update: {},
    create: { id: DEMO_TENANT_USER_ID, displayName: "Visitor", role: "DEMO" },
  })

  let createdProducts = 0
  for (const product of VISITOR_CATALOG_PRODUCTS) {
    const exists = await db.catalogProduct.findUnique({ where: { id: product.id }, select: { id: true } })
    if (exists) continue
    await db.catalogProduct.create({
      data: {
        ...product,
        source: product.officialPageUrl,
        catalogVersion: "visitor-showcase-v1",
        imageStatus: "PENDING",
        imageSourcePage: product.officialPageUrl,
        imageSourceUrl: product.officialImageUrl,
        rightsBasis: "personal-use",
      },
    })
    createdProducts++
  }

  let createdAssets = 0
  const seededAt = new Date("2026-08-27T00:00:00.000Z")
  for (const asset of VISITOR_ASSETS) {
    const exists = await db.collectionAsset.findUnique({ where: { id: asset.id }, select: { id: true } })
    if (exists) continue
    await db.collectionAsset.create({
      data: {
        id: asset.id,
        userId: DEMO_TENANT_USER_ID,
        catalogProductId: asset.catalogProductId,
        dispositionState: "ACTIVE",
        buildState: "COMPLETED",
        progress: 100,
        purchasePriceMinor: asset.purchasePriceMinor,
        currency: "CNY",
        purchasedAt: new Date(asset.purchasedAtIso),
        completedAt: seededAt,
        confirmedAt: seededAt,
        lastActivityAt: seededAt,
      },
    })
    createdAssets++
  }

  const totalAssets = await db.collectionAsset.count({ where: { userId: DEMO_TENANT_USER_ID, dispositionState: "ACTIVE" } })
  return { createdProducts, createdAssets, totalAssets }
}
