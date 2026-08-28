import { existsSync } from "node:fs"
import path from "node:path"
import { PrismaClient } from "@prisma/client"
import { resolveDatabaseUrl } from "../src/lib/db-url"
import { isHostedRuntime } from "../src/lib/db-mode"
import { cacheOfficialImage, fetchOfficialImage, officialImagesDir } from "../src/lib/services/official-image"
import { VISITOR_CATALOG_PRODUCTS } from "../src/lib/visitor-dataset"

async function main(): Promise<void> {
  if (isHostedRuntime()) throw new Error("visitor:images 只用于本地缓存；托管模式请使用远端对象存储或界面占位图")

  const db = new PrismaClient({ datasources: { db: { url: resolveDatabaseUrl() } } })
  let downloaded = 0
  let skipped = 0
  let failed = 0

  try {
    for (const seed of VISITOR_CATALOG_PRODUCTS) {
      const product = await db.catalogProduct.findUnique({ where: { id: seed.id } })
      if (!product) {
        console.error(`[visitor:images] 缺少 ${seed.id}，请先执行 npm run visitor:seed`)
        failed++
        continue
      }
      if (
        product.imageStatus === "OK" &&
        product.imageCacheFile &&
        existsSync(path.join(officialImagesDir(), product.imageCacheFile))
      ) {
        skipped++
        continue
      }

      const image = await fetchOfficialImage(seed.officialImageUrl)
      if (image.status !== "OK") {
        await db.catalogProduct.update({
          where: { id: seed.id },
          data: {
            imageStatus: "FAILED",
            officialImageUrl: seed.officialImageUrl,
            imageSourcePage: seed.officialPageUrl,
            imageSourceUrl: seed.officialImageUrl,
          },
        })
        console.error(`[visitor:images] ${seed.id} 下载失败：${image.reason ?? "UNKNOWN"}`)
        failed++
        continue
      }

      const cached = cacheOfficialImage(seed.id, image)
      if (!("fileName" in cached)) throw new Error(`${seed.id} 未能写入本地缓存`)
      await db.catalogProduct.update({
        where: { id: seed.id },
        data: {
          officialPageUrl: seed.officialPageUrl,
          officialImageUrl: seed.officialImageUrl,
          imageStatus: "OK",
          imageSourcePage: seed.officialPageUrl,
          imageSourceUrl: seed.officialImageUrl,
          imageCacheFile: cached.fileName,
          imageSha256: image.sha256,
          imageFetchedAt: new Date(),
          rightsBasis: "personal-use",
        },
      })
      downloaded++
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  } finally {
    await db.$disconnect()
  }

  console.log(`[visitor:images] 完成：下载 ${downloaded}，复用缓存 ${skipped}，失败 ${failed}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
