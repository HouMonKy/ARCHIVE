import { PrismaClient } from "@prisma/client"
import { seedDemoData } from "../src/lib/services/seed"
import { resolveDatabaseUrl } from "../src/lib/prisma"
import { DATASET_VERSION, DEMO_USER } from "../src/lib/demo-dataset"

/**
 * 便捷入口：以默认数据库执行完整演示数据 seed（幂等）。
 * 实际逻辑位于 src/lib/services/seed.ts，供脚本与 E2E 状态路由共用。
 */

async function main(): Promise<void> {
  const db = new PrismaClient({ datasources: { db: { url: resolveDatabaseUrl() } } })
  try {
    await seedDemoData(db)
    const [assets, products, events] = await Promise.all([
      db.collectionAsset.count(),
      db.catalogProduct.count(),
      db.releaseEvent.count(),
    ])
    console.log(
      `[seed] 完成：目录 ${products} 条，实体 ${assets} 件，新品事件 ${events} 条（dataset=${DATASET_VERSION}，user=${DEMO_USER.id}）`,
    )
  } finally {
    await db.$disconnect()
  }
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")
if (isDirectRun) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
