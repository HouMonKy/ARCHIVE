import path from "node:path"

/**
 * SQLite 数据库 URL 解析（纯函数，无 Prisma 依赖，可在客户端生成前安全 import）。
 *
 * 数据库分库策略（升级轮起：E2E/演示重置绝不能清空本机长期数据）：
 * - app.db：本机应用的长期数据库（Owner 真实收藏，默认）；
 * - demo.db：E2E 测试服务器与演示重置库（db:reset 裸跑的目标）；
 * - test.db：单元/组件测试（vitest 显式 DATABASE_URL）；
 * - DATABASE_URL 显式指定时始终优先（也用于 prisma migrate dev 等工具场景）。
 *
 * 连接参数：放宽连接池上限与等待时间——SQLite 写入由文件锁串行，但并发事务
 * （如 20 个并发的报告生成/确认请求）应排队等锁而非在连接池处直接超时（P1008）。
 */

function fileUrl(relPath: string): string {
  const p = path.isAbsolute(relPath) ? relPath : path.resolve(process.cwd(), "prisma", relPath)
  return `file:${p}?connection_limit=32&pool_timeout=60`
}

/** 应用运行时数据库：E2E 测试服务器固定 demo.db，其余默认 app.db */
export function resolveDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL
  if (raw && !raw.startsWith("file:")) return raw
  if (raw) {
    const queryIndex = raw.indexOf("?")
    const rel = queryIndex >= 0 ? raw.slice("file:".length, queryIndex) : raw.slice("file:".length)
    return fileUrl(rel)
  }
  return fileUrl(process.env.E2E_MODE === "1" ? "./demo.db" : "./app.db")
}

/** db:reset 裸跑（无显式 DATABASE_URL）的目标：仅演示库，绝不触碰 app.db */
export function resolveResetDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return resolveDatabaseUrl()
  return fileUrl("./demo.db")
}
