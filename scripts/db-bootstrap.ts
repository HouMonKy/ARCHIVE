import { execFileSync } from "node:child_process"
import { resolveDatabaseUrl } from "../src/lib/db-url"

/**
 * 非破坏性引导（返工轮任务 1）：只做迁移 + 确保身份/路线存在，绝不删除任何数据。
 * - `npm run db:bootstrap` / `npm run db:init`：本机长期库（app.db）日常引导；
 * - 重复执行幂等；已有资产/识别任务/AI 台账一概不动；
 * - 与 db:reset 的区别：reset 会删库重建（演示库专用），bootstrap 永不删。
 *
 * 结构约束（同 db-reset）：顶层只 import 无 @prisma/client 依赖的模块，
 * 先 prisma generate 自举，再动态加载需要客户端的模块。
 */

function run(cmd: string, args: string[], env: Record<string, string>): void {
  execFileSync(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...env } as NodeJS.ProcessEnv,
  })
}

async function main(): Promise<void> {
  const url = resolveDatabaseUrl()
  const dbFile = url.slice("file:".length).split("?")[0]!

  // 1) 生成客户端（幂等；Prisma Client 缺失时自举）
  run("npx", ["prisma", "generate"], { DATABASE_URL: "file:./dev.db" })

  // 2) 应用迁移（只前进，不回滚，不删除数据）
  run("npx", ["prisma", "migrate", "deploy"], { DATABASE_URL: `file:${dbFile}` })

  // 3) 确保身份、路线与 Visitor 脱敏样例存在（只创建缺失项，绝不修改/删除既有行）
  const { PrismaClient } = await import("@prisma/client")
  const { ensureBaseRows } = await import("../src/lib/services/bootstrap")
  const { ensureVisitorShowcase } = await import("../src/lib/services/visitor-seed")
  const db = new PrismaClient({ datasources: { db: { url } } })
  try {
    const result = await ensureBaseRows(db)
    const visitor = await ensureVisitorShowcase(db)
    const [assets, products, jobs] = await Promise.all([
      db.collectionAsset.count(),
      db.catalogProduct.count(),
      db.recognitionJob.count(),
    ])
    console.log(
      `[db:bootstrap] 完成（非破坏）：${result.createdOwner ? "新建" : "已有"} Owner、${result.createdDemoTenant ? "新建" : "已有"} Visitor、路线 ${result.routeNodes} 节点 ${result.routeEdges} 边；` +
        `Visitor 样例新增 ${visitor.createdAssets} 件/现有 ${visitor.totalAssets} 件；当前库：目录 ${products} 条，实体 ${assets} 件，识别任务 ${jobs} 条 → ${dbFile}`,
    )
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
