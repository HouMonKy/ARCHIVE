import type { PrismaClient } from "@prisma/client"
import { DEMO_ASSETS, DEMO_PREFERENCES, DATASET_VERSION } from "../demo-dataset"
import { matchCatalogTop3 } from "../ai/matcher"

/**
 * Owner 库种子迁移核心（返工轮任务 1/5，幂等可重跑；scripts/migrate-owner-seeds.ts 的薄封装）：
 * 1. 删除明确的 Owner 种子 A01–A08 及其派生建议（demo-v1 快照的报告/洞察/反馈）、
 *    种子假偏好（DEMO_PREFERENCES 精确匹配）与指向 demo-v1 的种子意向；
 * 2. 保留随机 ID 真实资产/识别任务/AI 台账/会话/路线等一切非种子数据；
 * 3. 非种子资产若引用 demo-v1 目录：先尝试确定性匹配 official-v1（Top-1 ≥ 0.9），
 *    匹配不到则保留名称/品牌快照转为自定义资产；
 * 4. 删除 demo-v1 目录及其演示事件（种子只存在于隔离的 E2E/Demo 库）。
 */

export interface OwnerSeedMigrationResult {
  deletedSeedAssets: number
  deletedSeedReports: number
  deletedSeedPreferences: number
  deletedSeedIntents: number
  deletedDemoEvents: number
  deletedDemoProducts: number
  repointedToOfficial: number
  convertedToCustom: number
  keptAssets: number
  keptRecognitionJobs: number
  keptAiUsageLogs: number
}

export async function migrateOwnerSeeds(db: PrismaClient): Promise<OwnerSeedMigrationResult> {
  const seedAssetIds = DEMO_ASSETS.map((a) => a.id)
  const demoProducts = await db.catalogProduct.findMany({ where: { catalogVersion: DATASET_VERSION } })
  const demoProductIds = new Set(demoProducts.map((p) => p.id))

  // 1a) 种子实体的派生洞察与反馈 → 删除
  const seedInsights = await db.insight.findMany({ where: { assetId: { in: seedAssetIds } }, select: { id: true } })
  if (seedInsights.length > 0) {
    await db.insightFeedback.deleteMany({ where: { insightId: { in: seedInsights.map((i) => i.id) } } })
    await db.insight.deleteMany({ where: { id: { in: seedInsights.map((i) => i.id) } } })
  }

  // 1b) 演示快照（demo-v1:*）的报告 = 种子派生建议 → 连同洞察/反馈删除
  const seedReports = await db.insightReport.findMany({
    where: { snapshotVersion: { startsWith: `${DATASET_VERSION}:` } },
    select: { id: true },
  })
  for (const report of seedReports) {
    const insights = await db.insight.findMany({ where: { reportId: report.id }, select: { id: true } })
    await db.insightFeedback.deleteMany({ where: { insightId: { in: insights.map((i) => i.id) } } })
    await db.insight.deleteMany({ where: { reportId: report.id } })
    await db.insightReport.delete({ where: { id: report.id } })
  }

  // 1c) 种子实体 A01–A08 → 删除（仅这些明确 ID；随机 ID 真实资产保留）
  const deletedAssets = await db.collectionAsset.deleteMany({ where: { id: { in: seedAssetIds } } })

  // 1d) 种子假偏好（DEMO_PREFERENCES 精确 kind+value 匹配）→ 删除
  let deletedPrefs = 0
  for (const p of DEMO_PREFERENCES) {
    const r = await db.userPreference.deleteMany({ where: { kind: p.kind, value: p.value } })
    deletedPrefs += r.count
  }

  // 1e) 指向 demo-v1 的意向（种子）→ 删除
  const deletedIntents = await db.userProductIntent.deleteMany({
    where: { catalogProductId: { in: [...demoProductIds] } },
  })

  // 2) 非种子资产引用 demo-v1 → 匹配 official-v1 或转自定义快照
  const officialProducts = await db.catalogProduct.findMany({ where: { catalogVersion: "official-v1" } })
  const officialMatchers = officialProducts.map((p) => ({
    id: p.id,
    brand: p.brand,
    category: p.category,
    line: p.line,
    grade: p.grade,
    canonicalName: p.canonicalName,
    matchText: null as string | null,
  }))
  const stragglers = await db.collectionAsset.findMany({
    where: { catalogProductId: { in: [...demoProductIds] } },
  })
  let repointed = 0
  let converted = 0
  for (const asset of stragglers) {
    const demoProduct = demoProducts.find((p) => p.id === asset.catalogProductId)!
    const extraction = {
      brand: demoProduct.brand,
      name: demoProduct.canonicalName,
      series: demoProduct.line ?? "",
      grade: demoProduct.grade,
      scale: "",
      modelNumber: "",
      visibleText: demoProduct.canonicalName,
      confidence: 1,
      evidence: "seed-migration",
    }
    const matched = matchCatalogTop3(extraction, officialMatchers)
    const top = matched[0]
    if (top && top.confidence >= 0.9) {
      await db.collectionAsset.update({ where: { id: asset.id }, data: { catalogProductId: top.productId } })
      repointed++
    } else {
      await db.collectionAsset.update({
        where: { id: asset.id },
        data: {
          catalogProductId: null,
          customName: demoProduct.canonicalName,
          customBrand: demoProduct.brand,
        },
      })
      converted++
    }
  }

  // 3) 演示事件 + demo-v1 目录 → 删除（此刻应已无引用）
  const deletedEvents = await db.releaseEvent.deleteMany({
    where: { catalogProductId: { in: [...demoProductIds] } },
  })
  const remainingRefs = await db.collectionAsset.count({
    where: { catalogProductId: { in: [...demoProductIds] } },
  })
  const remainingIntentRefs = await db.userProductIntent.count({
    where: { catalogProductId: { in: [...demoProductIds] } },
  })
  if (remainingRefs > 0 || remainingIntentRefs > 0) {
    throw new Error(`demo-v1 目录仍有引用未清理（assets=${remainingRefs}, intents=${remainingIntentRefs}），已中止删除目录`)
  }
  const deletedProducts = await db.catalogProduct.deleteMany({ where: { catalogVersion: DATASET_VERSION } })

  return {
    deletedSeedAssets: deletedAssets.count,
    deletedSeedReports: seedReports.length,
    deletedSeedPreferences: deletedPrefs,
    deletedSeedIntents: deletedIntents.count,
    deletedDemoEvents: deletedEvents.count,
    deletedDemoProducts: deletedProducts.count,
    repointedToOfficial: repointed,
    convertedToCustom: converted,
    keptAssets: await db.collectionAsset.count(),
    keptRecognitionJobs: await db.recognitionJob.count(),
    keptAiUsageLogs: await db.aiUsageLog.count(),
  }
}
