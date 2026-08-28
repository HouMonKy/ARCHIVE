import { PrismaClient } from "@prisma/client"
import { resolveDatabaseUrl } from "@/lib/prisma"
import { seedDemoData, type SeedOptions } from "@/lib/services/seed"

const globalForTest = globalThis as unknown as { __mbTestDb?: PrismaClient }

export function getTestDb(): PrismaClient {
  if (!globalForTest.__mbTestDb) {
    globalForTest.__mbTestDb = new PrismaClient({ datasources: { db: { url: resolveDatabaseUrl() } } })
  }
  return globalForTest.__mbTestDb
}

/** 重置为 PRD §19 演示数据（幂等）；可按需选择资产/事件子集 */
export async function resetTestDb(options?: SeedOptions): Promise<void> {
  await seedDemoData(getTestDb(), options)
}
