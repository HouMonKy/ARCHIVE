/**
 * 修复历史 LEGO 误标与地区链接（幂等）：
 * - 主题只取关联 RecognitionJob.extractionJson.series，不按套装编号猜测；
 * - 将旧 Technic/SUPERCAR 通用值改成真实主题（如 MARVEL），无法确认则不改主题；
 * - 商品页统一规范为 lego.com/en-us，并用已知 set slug 修复旧的错误路径；
 * - 仅修 CatalogProduct，不改用户资产、照片或识别审计记录。
 *
 * 用法：npm run backfill:lego -- --db prisma/app.db
 */
import path from "node:path"
import { PrismaClient } from "@prisma/client"
import { resolveDatabaseUrl } from "../src/lib/prisma"
import { legoThemeLabel, normalizeLegoOfficialPageUrl } from "../src/lib/names/zh"

interface ExtractionShape {
  name?: string | null
  series?: string | null
}

function parseExtraction(json: string | null): ExtractionShape | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as ExtractionShape
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dbIdx = args.indexOf("--db")
  const dbUrl = dbIdx >= 0 ? `file:${path.resolve(args[dbIdx + 1] ?? "prisma/app.db")}` : resolveDatabaseUrl()
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } })

  try {
    const products = await db.catalogProduct.findMany({
      where: { brand: "LEGO" },
      include: {
        assets: {
          where: { recognitionJobId: { not: null } },
          orderBy: { createdAt: "desc" },
          include: { recognitionJob: { select: { extractionJson: true } } },
        },
      },
    })

    let themeFixed = 0
    let urlFixed = 0
    for (const product of products) {
      const setNumber = (product.modelNumber ?? product.id.replace(/^lego-/, "")).replace(/\D/g, "")
      const extraction = product.assets
        .map((asset) => parseExtraction(asset.recognitionJob?.extractionJson ?? null))
        .find((value) => Boolean(value?.series?.trim()))
      const series = extraction?.series?.trim() || null
      const theme = series ? legoThemeLabel(series, null) : null
      const officialPageUrl = normalizeLegoOfficialPageUrl(product.officialPageUrl, setNumber)
      const data = {
        category: theme ? "LEGO" : product.category,
        line: theme && theme !== "TECHNIC" ? null : product.line,
        grade: theme ?? product.grade,
        series: series ?? product.series,
        officialPageUrl,
        imageSourcePage: product.imageSourcePage?.includes("lego.com/")
          ? (officialPageUrl ?? product.imageSourcePage)
          : product.imageSourcePage,
      }
      const changedTheme = data.category !== product.category
        || data.line !== product.line
        || data.grade !== product.grade
        || data.series !== product.series
      const changedUrl = data.officialPageUrl !== product.officialPageUrl
        || data.imageSourcePage !== product.imageSourcePage
      if (!changedTheme && !changedUrl) continue

      await db.catalogProduct.update({ where: { id: product.id }, data })
      if (changedTheme) themeFixed++
      if (changedUrl) urlFixed++
      console.log(`[backfill:lego] ${product.id}: ${product.grade} → ${data.grade}; ${product.officialPageUrl ?? "(empty)"} → ${data.officialPageUrl ?? "(empty)"}`)
    }
    console.log(`[backfill:lego] 完成：主题修复 ${themeFixed}，en-us 链接修复 ${urlFixed}，扫描 ${products.length}`)
  } finally {
    await db.$disconnect()
  }
}

main().catch((error) => {
  console.error(`[backfill:lego] 异常：${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
