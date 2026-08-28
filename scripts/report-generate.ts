import { PrismaClient } from "@prisma/client"
import { generateReport } from "../src/lib/services/report"
import { demoNow } from "../src/lib/clock"
import { resolveDatabaseUrl } from "../src/lib/prisma"
import { DEMO_USER } from "../src/lib/demo-dataset"

/**
 * 手动触发周报生成（同一周期幂等：连跑两次只产生一期）。
 */

async function main(): Promise<void> {
  const db = new PrismaClient({ datasources: { db: { url: resolveDatabaseUrl() } } })
  try {
    const result = await generateReport(db, DEMO_USER.id, demoNow())
    const suffix = result.reportId ? `（report=${result.reportId}，洞察 ${result.insightCount} 条）` : ""
    console.log(`[report:generate] ${result.status}：${result.message}${suffix}`)
    if (result.status !== "OK" && result.status !== "LOCKED") process.exitCode = 1
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
