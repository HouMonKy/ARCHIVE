/**
 * 现有 MGEX 自定义收藏的幂等 backfill（官网资料闭环）：
 * - 依据 manual.bandai-hobby.net 商品详情（/menus/detail/646，品番 2583176）创建正式
 *   CatalogProduct（bandai-manual-646：日文名/中文名/等级/系列/型号/官网页/官网原图）；
 * - 把现有「MGEX 1/100 ストライクフリーダムガンダム」自定义实体关联到正式目录商品：
 *   保留资产 ID、状态、确认/创建时间与用户上传图，只补 catalogProductId；
 * - 幂等：目录商品已存在且资产已关联时直接跳过（不重复创建/更新）。
 *
 * 用法：npm run backfill:mgex [-- --db prisma/app.db]
 */
import { existsSync } from "node:fs"
import path from "node:path"
import { PrismaClient } from "@prisma/client"
import { resolveDatabaseUrl } from "../src/lib/prisma"

const MGEX_ASSET_CUSTOM_NAME = "MGEX 1/100 ストライクフリーダムガンダム"
const MGEX_ASSET_CUSTOM_BRAND = "Bandai"

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dbIdx = args.indexOf("--db")
  const dbUrl = dbIdx >= 0 ? `file:${path.resolve(args[dbIdx + 1] ?? "prisma/app.db")}` : resolveDatabaseUrl()
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } })
  const { lookupBandai } = await import("../src/lib/services/official-lookup")
  const { upsertOfficialProduct } = await import("../src/lib/services/catalog-official")

  try {
    // 1) 幂等：已有 bandai-manual-646（或任何关联到 MGEX 实体的正式目录商品）则跳过建档
    const existingLinkedAsset = await db.collectionAsset.findFirst({
      where: {
        customName: MGEX_ASSET_CUSTOM_NAME,
        customBrand: MGEX_ASSET_CUSTOM_BRAND,
        catalogProductId: { not: null },
      },
      include: { product: true },
    })
    if (existingLinkedAsset) {
      console.log(`[backfill:mgex] 已关联（${existingLinkedAsset.id} → ${existingLinkedAsset.catalogProductId}），跳过`)
      return
    }

    const asset = await db.collectionAsset.findFirst({
      where: {
        customName: MGEX_ASSET_CUSTOM_NAME,
        customBrand: MGEX_ASSET_CUSTOM_BRAND,
        catalogProductId: null,
      },
    })
    if (!asset) {
      console.log("[backfill:mgex] 未找到 MGEX 自定义实体（无需 backfill）")
      return
    }
    const before = { id: asset.id, buildState: asset.buildState, confirmedAt: asset.confirmedAt, createdAt: asset.createdAt, coverId: (await db.assetCover.findFirst({ where: { assetId: asset.id } }))?.id ?? null }

    // 2) 官网查询建档（manual.bandai-hobby.net 商品详情 646：品番 2583176；
    //    机体型号 ZGMF-X20A 来自既有识别任务的 Kimi 提取（盒面可见事实））
    const priorJob = await db.recognitionJob.findFirst({
      where: { extractionJson: { contains: "ZGMF-X20A" } },
      orderBy: { createdAt: "desc" },
    })
    const draft = await lookupBandai({
      name: "MGEX 1/100 ストライクフリーダムガンダム",
      grade: "MGEX",
      modelNumber: priorJob ? "ZGMF-X20A" : undefined,
    })
    if (!draft || draft.id !== "bandai-manual-646") {
      console.error(`[backfill:mgex] 官网查询结果不符合预期（得到 ${draft?.id ?? "null"}）`)
      process.exit(1)
    }
    const { product, imageStatus } = await upsertOfficialProduct(db, draft)
    console.log(
      `[backfill:mgex] 目录商品 ${product.id}：${product.canonicalName} / ${product.nameZh}（${product.grade}/${product.line}/${product.modelNumber}，品番 ${product.officialProductCode}）官网图 ${imageStatus}`,
    )

    // 3) 关联既有资产（只补 catalogProductId，其余全部保留）
    await db.collectionAsset.update({
      where: { id: asset.id },
      data: { catalogProductId: product.id },
    })
    const after = await db.collectionAsset.findUniqueOrThrow({ where: { id: asset.id } })
    const afterCoverId = (await db.assetCover.findFirst({ where: { assetId: asset.id } }))?.id ?? null
    const preserved =
      after.buildState === before.buildState &&
      after.confirmedAt.getTime() === before.confirmedAt.getTime() &&
      after.createdAt.getTime() === before.createdAt.getTime() &&
      afterCoverId === before.coverId
    console.log(
      `[backfill:mgex] 实体 ${asset.id} 已关联 ${product.id}（资产 ID/状态/时间/上传图保留：${preserved ? "OK" : "FAIL"}）`,
    )
    if (!preserved) {
      process.exit(1)
    }
    if (imageStatus !== "OK" && existsSync(path.join(process.cwd(), "private-assets"))) {
      console.warn(`[backfill:mgex] 官网图状态 ${imageStatus}（收藏柜将回退用户上传图）`)
    }
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => {
  console.error(`[backfill:mgex] 异常：${(e as Error).message}`)
  process.exit(1)
})
