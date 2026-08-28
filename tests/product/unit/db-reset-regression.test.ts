import { describe, expect, it, beforeAll, afterAll } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { PrismaClient } from "@prisma/client"

/**
 * db:reset 三连跑回归（返工轮任务 1/5）：
 * 对隔离的临时库（绝不触碰 app.db/demo.db/test.db）连续执行 3 次，
 * 每次必须 EXIT=0 且种子计数完全一致（12 目录 / 8 实体 / 1 意向 / 4 事件）。
 * 隔离方式：DATABASE_URL 指向临时文件（resolveResetDatabaseUrl 尊重显式 DATABASE_URL）。
 */

let tempDb: string
let tempDir: string

beforeAll(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "db-reset-regression-"))
  tempDb = path.join(tempDir, "reset.db")
})

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe("db:reset 三连跑（隔离临时库）", () => {
  it("连续 3 次 EXIT=0 且计数一致", { timeout: 300_000 }, async () => {
    const counts: string[] = []
    for (let i = 1; i <= 3; i++) {
      execFileSync("npm", ["run", "db:reset"], {
        stdio: "pipe",
        env: { ...process.env, DATABASE_URL: `file:${tempDb}` } as NodeJS.ProcessEnv,
      })
      const db = new PrismaClient({ datasources: { db: { url: `file:${tempDb}` } } })
      try {
        const [assets, products, events, intents] = await Promise.all([
          db.collectionAsset.count(),
          db.catalogProduct.count(),
          db.releaseEvent.count(),
          db.userProductIntent.count(),
        ])
        counts.push(`${assets}/${products}/${events}/${intents}`)
      } finally {
        await db.$disconnect()
      }
    }
    expect(counts, `三连跑计数必须一致：${counts.join(" | ")}`).toEqual(["8/12/4/1", "8/12/4/1", "8/12/4/1"])
  })
})
