/**
 * series 幂等 backfill（收藏地图改造）：
 * - CatalogProduct.series 可空字段：对已有目录商品，从关联 RecognitionJob.extractionJson
 *   的 Kimi 提取 series（作品/主题）补齐；无法确认则留空——绝不猜；
 * - 幂等：只补 series 为空的行，已有值不覆盖；重复执行无副作用；
 * - 不修改其他任何字段；不触碰用户资产/识别任务。
 *
 * 用法：npx tsx scripts/backfill-series.ts [--db prisma/app.db]
 */
import path from "node:path"
import { PrismaClient } from "@prisma/client"
import { resolveDatabaseUrl } from "../src/lib/prisma"

interface ExtractionShape {
  series?: string | null
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dbIdx = args.indexOf("--db")
  const dbUrl = dbIdx >= 0 ? `file:${path.resolve(args[dbIdx + 1] ?? "prisma/app.db")}` : resolveDatabaseUrl()
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } })
  try {
    // 找 series 为空、且被真实资产引用的目录商品（演示 P 编码也一并处理：其产品名可映射时同样补齐）
    const products = await db.catalogProduct.findMany({ where: { series: null } })
    let filled = 0
    let skipped = 0
    for (const product of products) {
      // 依据 1：引用该商品的资产 → 其识别任务的 extractionJson.series
      const asset = await db.collectionAsset.findFirst({
        where: { catalogProductId: product.id, recognitionJobId: { not: null } },
        select: { recognitionJobId: true },
      })
      let series: string | null = null
      if (asset?.recognitionJobId) {
        const job = await db.recognitionJob.findUnique({ where: { id: asset.recognitionJobId }, select: { extractionJson: true } })
        if (job?.extractionJson) {
          try {
            const extraction = JSON.parse(job.extractionJson) as ExtractionShape
            const candidate = extraction.series?.trim()
            if (candidate) series = candidate.slice(0, 120)
          } catch {
            // 解析失败留空
          }
        }
      }
      if (series) {
        await db.catalogProduct.update({ where: { id: product.id }, data: { series } })
        filled++
        console.log(`[backfill:series] ${product.id} ← "${series}"（识别提取）`)
      } else {
        skipped++
      }
    }
    const withSeries = await db.catalogProduct.count({ where: { series: { not: null } } })
    const total = await db.catalogProduct.count()
    console.log(`[backfill:series] 完成：补齐 ${filled}，无法确认留空 ${skipped}；当前有 series ${withSeries}/${total}`)
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => {
  console.error(`[backfill:series] 异常：${(e as Error).message}`)
  process.exit(1)
})
