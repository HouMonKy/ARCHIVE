import { execFileSync } from "node:child_process"
import { existsSync, rmSync } from "node:fs"
import path from "node:path"
import { sleep } from "../src/lib/files"
import { resolveDatabaseUrl, resolveResetDatabaseUrl } from "../src/lib/db-url"

/**
 * 幂等重置（自举安全）：生成客户端 → 删库 → 迁移 → 种子。
 *
 * 目标分库：裸跑重置 demo.db（E2E/演示）；`--app` 或 DATABASE_URL 显式指定时
 * 才允许重置 app.db 等长期库。日常初始化请用 `db:bootstrap`（非破坏，绝不删数据）。
 *
 * 间歇失败治理（返工轮任务 1）：
 * - 删除阶段清理 SQLite sidecar（-journal/-wal/-shm），并等待文件真正消失
 *   （句柄延迟释放/macOS APFS 观察延迟），有限重试；
 * - migrate deploy 的 Schema engine 偶发失败整体有限重试（全新库上重跑安全）；
 * - 连续多次执行结果完全一致。
 *
 * 结构约束：
 * - 本文件顶层只允许 import 无 @prisma/client 依赖的模块（node 内置与纯函数）。
 *   这样在 Prisma Client 尚未生成（如 postinstall 被跳过的环境）时，
 *   第一步仍能先执行 `prisma generate` 自举，之后才动态加载需要客户端的 seed 模块。
 * - 删除数据库前不实例化任何 PrismaClient（无模块级副作用）。
 */

function run(cmd: string, args: string[], env: Record<string, string>): void {
  execFileSync(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...env } as NodeJS.ProcessEnv,
  })
}

const SIDECAR_SUFFIXES = ["-journal", "-wal", "-shm"] as const

/** 删除数据库及其 sidecar；等待文件句柄释放，最多 attempts 次 */
function removeDatabaseFile(dbFile: string, attempts = 10, waitMs = 200): void {
  for (let i = 0; i < attempts; i++) {
    for (const suffix of ["", ...SIDECAR_SUFFIXES]) {
      const f = `${dbFile}${suffix}`
      if (existsSync(f)) rmSync(f, { force: true, retryDelay: 50, maxRetries: 3 } as never)
    }
    const left = ["", ...SIDECAR_SUFFIXES].some((suffix) => existsSync(`${dbFile}${suffix}`))
    if (!left) return
    // 句柄尚未释放：等待后重试（最后一次放弃等待，交给上层整体重试）
    const wait = sleepSync(waitMs)
    if (wait === false) break
  }
  const remaining = ["", ...SIDECAR_SUFFIXES].filter((suffix) => existsSync(`${dbFile}${suffix}`))
  if (remaining.length > 0) {
    throw new Error(`数据库文件仍被占用，无法删除：${remaining.join("、")}`)
  }
}

/** 同步等待（execFileSync 环境下的简单自旋；仅毫秒级） */
function sleepSync(ms: number): boolean {
  const end = Date.now() + ms
  while (Date.now() < end) {
    // 阻塞等待：让 OS 释放句柄
  }
  return true
}

async function resetOnce(url: string, dbFile: string): Promise<void> {
  // 1) 生成客户端（幂等；即使 .prisma/client 完全缺失也能自举）
  run("npx", ["prisma", "generate"], { DATABASE_URL: "file:./dev.db" })
  // 2) 删除旧库 + sidecar（此时仍未实例化任何 PrismaClient）
  removeDatabaseFile(dbFile)

  // 3) 应用迁移（全新库上执行全部迁移；绝对路径避免 CLI 相对 schema 目录的解析歧义）
  // macOS 上 Prisma 6 的 schema engine 偶发在无日志级别时只返回空白的
  // "Schema engine error"；启用 info 级引擎日志后启动稳定，且失败时保留可诊断信息。
  run("npx", ["prisma", "migrate", "deploy"], {
    DATABASE_URL: `file:${dbFile}`,
    RUST_LOG: "info",
  })

  // 4) 种子：动态加载（此刻客户端已生成，import @prisma/client 安全）
  const { PrismaClient } = await import("@prisma/client")
  const { seedDemoData } = await import("../src/lib/services/seed")
  const db = new PrismaClient({ datasources: { db: { url } } })
  try {
    await seedDemoData(db)
    const [assets, products, events, intents] = await Promise.all([
      db.collectionAsset.count(),
      db.catalogProduct.count(),
      db.releaseEvent.count(),
      db.userProductIntent.count(),
    ])
    console.log(`[db:reset] 完成：目录 ${products} 条，实体 ${assets} 件，意向 ${intents} 条，新品事件 ${events} 条 → ${dbFile}`)
  } finally {
    await db.$disconnect()
  }
}

async function main(): Promise<void> {
  const useApp = process.argv.includes("--app")
  const url = useApp ? resolveDatabaseUrlWithAppDefault() : resolveResetDatabaseUrl()
  const dbFile = url.slice("file:".length).split("?")[0]!

  // 整体重试：Schema engine/文件句柄的偶发失败在全新库上重跑是安全的
  const MAX_ATTEMPTS = 3
  let lastError: unknown = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await resetOnce(url, dbFile)
      return
    } catch (e) {
      lastError = e
      console.error(`[db:reset] 第 ${attempt}/${MAX_ATTEMPTS} 次尝试失败：${e instanceof Error ? e.message : String(e)}`)
      if (attempt < MAX_ATTEMPTS) {
        await sleep(500 * attempt)
      }
    }
  }
  console.error(lastError)
  process.exit(1)
}

function resolveDatabaseUrlWithAppDefault(): string {
  // --app：无显式 DATABASE_URL 时目标为 app.db（显式重置长期库）
  if (process.env.DATABASE_URL) return resolveDatabaseUrl()
  const p = path.resolve(process.cwd(), "prisma", "app.db")
  return `file:${p}?connection_limit=32&pool_timeout=60`
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
