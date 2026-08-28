import { PrismaClient } from "@prisma/client"
import { resolveDatabaseUrl } from "./db-url"
import { resolveDatabaseMode, isHostedRuntime, DatabaseModeError } from "./db-mode"

export { resolveDatabaseUrl }
export { resolveDatabaseMode, isHostedRuntime, DatabaseModeError }
export type { DatabaseModeConfig } from "./db-mode"

const globalForPrisma = globalThis as unknown as {
  __modelBasePrisma?: PrismaClient
}

/**
 * 双模式数据库客户端：
 * - LOCAL：标准 Prisma + SQLite（本机长期使用形态）；
 * - HOSTED：Prisma libSQL 驱动适配器（Turso），Vercel 部署形态。
 * 模式错误（缺 URL/TOKEN、Vercel 上 LOCAL）在客户端创建时即抛出，绝不静默降级。
 */
export async function createPrismaClient(): Promise<PrismaClient> {
  const config = resolveDatabaseMode()
  if (config.mode === "HOSTED" && config.libsqlUrl) {
    const [{ createClient }, adapterModule] = await Promise.all([
      import("@libsql/client"),
      import("@prisma/adapter-libsql"),
    ])
    const libsql = createClient({
      url: config.libsqlUrl,
      authToken: config.libsqlAuthToken ?? undefined,
    })
    // 6.19.2：适配器为构造函数（部分版本导出工厂），兼容两种形态
    const PrismaLibSQL = adapterModule.PrismaLibSQL as unknown as
      | (new (client: unknown) => unknown)
      | ((client: unknown) => unknown)
    const adapter =
      typeof PrismaLibSQL === "function"
        // @ts-expect-error 两种签名统一适配
        ? new PrismaLibSQL(libsql)
        : // @ts-expect-error 两种签名统一适配
          PrismaLibSQL(libsql)
    return new PrismaClient({ adapter: adapter as never })
  }
  return new PrismaClient({
    datasources: { db: { url: resolveDatabaseUrl() } },
  })
}

/** 获取单例客户端（异步初始化；HOSTED 模式按需加载 libSQL 适配器） */
export async function getPrismaClientAsync(): Promise<PrismaClient> {
  if (!globalForPrisma.__modelBasePrisma) {
    globalForPrisma.__modelBasePrisma = await createPrismaClient()
  }
  return globalForPrisma.__modelBasePrisma
}
