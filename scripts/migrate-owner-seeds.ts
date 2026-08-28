import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, cpSync } from "node:fs"
import path from "node:path"
import { resolveDatabaseUrl } from "../src/lib/db-url"

/**
 * Owner 种子迁移入口（返工轮任务 1）：对默认库（app.db）执行幂等迁移。
 * 执行前必须备份到 private-assets/backups/ 并校验可打开，失败即中止（绝不先删后验）。
 * 核心逻辑在 src/lib/services/owner-seed-migration.ts（可单测）。
 */

function run(cmd: string, args: string[], env: Record<string, string>): void {
  execFileSync(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...env } as NodeJS.ProcessEnv,
  })
}

async function verifyBackupOpens(backupFile: string): Promise<boolean> {
  const { PrismaClient } = await import("@prisma/client")
  const db = new PrismaClient({ datasources: { db: { url: `file:${backupFile}` } } })
  try {
    const [users, assets, products, jobs] = await Promise.all([
      db.user.count(),
      db.collectionAsset.count(),
      db.catalogProduct.count(),
      db.recognitionJob.count(),
    ])
    console.log(`[migrate-owner-seeds] 备份校验通过（可打开）：users=${users} assets=${assets} catalog=${products} jobs=${jobs}`)
    return true
  } catch (e) {
    console.error(`[migrate-owner-seeds] 备份校验失败：${e instanceof Error ? e.message : String(e)}`)
    return false
  } finally {
    await db.$disconnect().catch(() => undefined)
  }
}

async function main(): Promise<void> {
  if (process.env.E2E_MODE === "1") {
    console.error("[migrate-owner-seeds] 拒绝在 E2E_MODE=1 下运行（目标应是本机长期库 app.db）")
    process.exit(1)
  }
  const url = resolveDatabaseUrl()
  const dbFile = url.slice("file:".length).split("?")[0]!
  if (!existsSync(dbFile)) {
    console.error(`[migrate-owner-seeds] 目标库不存在：${dbFile}（先运行 npm run db:bootstrap）`)
    process.exit(1)
  }

  // 0) 生成客户端（自举安全）
  run("npx", ["prisma", "generate"], { DATABASE_URL: "file:./dev.db" })

  const { PrismaClient } = await import("@prisma/client")
  const { migrateOwnerSeeds } = await import("../src/lib/services/owner-seed-migration")

  // 1) 备份 + 校验（清理数据前必须完成）
  const backupDir = path.resolve(process.cwd(), "private-assets", "backups")
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
  const backupFile = path.join(backupDir, `pre-migrate-${stamp}.db`)
  cpSync(dbFile, backupFile)
  if (!(await verifyBackupOpens(backupFile))) {
    console.error("[migrate-owner-seeds] 备份不可用，已中止（未做任何修改）")
    process.exit(1)
  }

  const db = new PrismaClient({ datasources: { db: { url } } })
  try {
    const before = {
      assets: await db.collectionAsset.count(),
      products: await db.catalogProduct.count(),
      jobs: await db.recognitionJob.count(),
      usage: await db.aiUsageLog.count(),
      reports: await db.insightReport.count(),
    }
    console.log(`[migrate-owner-seeds] 迁移前：assets=${before.assets} catalog=${before.products} jobs=${before.jobs} aiUsage=${before.usage} reports=${before.reports}`)

    const result = await migrateOwnerSeeds(db)

    console.log(
      `[migrate-owner-seeds] 完成：删除种子实体 ${result.deletedSeedAssets} 件（A01–A08）、报告 ${result.deletedSeedReports} 期、偏好 ${result.deletedSeedPreferences} 条、意向 ${result.deletedSeedIntents} 条、演示事件 ${result.deletedDemoEvents} 条、demo-v1 目录 ${result.deletedDemoProducts} 条；` +
        `重指向 official ${result.repointedToOfficial} 件、转自定义 ${result.convertedToCustom} 件`,
    )
    console.log(
      `[migrate-owner-seeds] 迁移后：assets=${result.keptAssets} jobs=${result.keptRecognitionJobs} aiUsage=${result.keptAiUsageLogs}（识别任务与 AI 台账完整保留）`,
    )
  } finally {
    await db.$disconnect()
  }
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
