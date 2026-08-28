import { PrismaClient } from "@prisma/client"
import { resolveDatabaseUrl } from "../src/lib/db-url"
import { ensureVisitorShowcase } from "../src/lib/services/visitor-seed"

async function main(): Promise<void> {
  const url = resolveDatabaseUrl()
  const db = new PrismaClient({ datasources: { db: { url } } })
  try {
    const result = await ensureVisitorShowcase(db)
    console.log(
      `[visitor:seed] 完成：新建目录 ${result.createdProducts} 条、新建藏品 ${result.createdAssets} 件；Visitor 当前共 ${result.totalAssets} 件藏品`,
    )
  } finally {
    await db.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
