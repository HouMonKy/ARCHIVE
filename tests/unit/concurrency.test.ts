import { describe, expect, it, beforeAll } from "vitest"
import { getTestDb, resetTestDb } from "../helpers/db"
import { confirmAsset } from "@/lib/services/assets"
import { generateReport } from "@/lib/services/report"
import { demoNow } from "@/lib/clock"
import { readSampleFile } from "../helpers/files"
import { createRecognitionJob } from "@/lib/services/recognition"

/**
 * 并发幂等（返工任务 3）：相同请求并发执行时均得到成功或同一业务结果；
 * 唯一键竞争不得变成未处理异常（500）。每项同时发起 20 次相同请求。
 */
describe("并发幂等：建档确认 20 并发", () => {
  beforeAll(async () => {
    await resetTestDb()
  })

  it("20 个相同 idempotencyKey 的确认并发：无异常、最终仅 1 条实体、同一业务结果", async () => {
    const db = getTestDb()
    const payload = {
      idempotencyKey: "concurrent-key-0001",
      productId: "P05",
      dispositionState: "ACTIVE" as const,
      buildState: "UNOPENED" as const,
      progress: 0,
      purchasePriceMinor: 240000,
    }
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => confirmAsset(db, "kai", payload)))

    const rejected = results.filter((r) => r.status === "rejected")
    expect(rejected, `并发确认不得出现异常（实际 ${rejected.length} 个）：${JSON.stringify(rejected.map((r) => (r as PromiseRejectedResult).reason))}`).toHaveLength(0)

    const fulfilled = results.map((r) => (r as PromiseFulfilledResult<{ asset: { id: string }; created: boolean }>).value)
    // 最终只有一条实体
    expect(await db.collectionAsset.count({ where: { idempotencyKey: "concurrent-key-0001" } })).toBe(1)
    const createdRows = await db.collectionAsset.count({ where: { catalogProductId: "P05" } })
    expect(createdRows).toBe(1)
    // 所有请求得到同一业务结果（同一 assetId），created=true 恰好一次
    const assetIds = new Set(fulfilled.map((r) => r.asset.id))
    expect(assetIds.size).toBe(1)
    expect(fulfilled.filter((r) => r.created)).toHaveLength(1)
    expect(fulfilled.filter((r) => !r.created)).toHaveLength(19)
  })

  it("20 个相同识别任务的确认并发（不同幂等键）：仍只入库一件", async () => {
    await resetTestDb()
    const db = getTestDb()
    const job = await createRecognitionJob(db, "kai", readSampleFile("box-unicorn-demo.svg"))
    const payloads = Array.from({ length: 20 }, (_, i) => ({
      idempotencyKey: `job-race-key-${String(i).padStart(4, "0")}`,
      jobId: job.jobId,
      productId: "P03",
      dispositionState: "ACTIVE" as const,
      buildState: "UNOPENED" as const,
      progress: 0,
    }))
    const results = await Promise.allSettled(payloads.map((p) => confirmAsset(db, "kai", p)))

    const rejected = results.filter((r) => r.status === "rejected")
    expect(rejected, `不得出现异常：${JSON.stringify(rejected.map((r) => (r as PromiseRejectedResult).reason))}`).toHaveLength(0)

    // 同一识别任务只关联一件实体（recognitionJobId 唯一约束兜底）
    expect(await db.collectionAsset.count({ where: { recognitionJobId: job.jobId } })).toBe(1)
    const fulfilled = results.map((r) => (r as PromiseFulfilledResult<{ asset: { id: string } }>).value)
    const assetIds = new Set(fulfilled.map((r) => r.asset.id))
    expect(assetIds.size).toBe(1)
  })
})

describe("并发幂等：周报生成 20 并发", () => {
  beforeAll(async () => {
    await resetTestDb()
  })

  it("20 个同周期生成并发：无异常、最终仅 1 期报告、同一 reportId", { timeout: 60_000 }, async () => {
    const db = getTestDb()
    const now = demoNow()
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => generateReport(db, "kai", now)))

    const rejected = results.filter((r) => r.status === "rejected")
    expect(rejected, `并发生成不得出现异常（实际 ${rejected.length} 个）：${JSON.stringify(rejected.map((r) => (r as PromiseRejectedResult).reason))}`).toHaveLength(0)

    const fulfilled = results.map(
      (r) => (r as PromiseFulfilledResult<{ reportId: string | null; created: boolean; insightCount: number; status: string }>).value,
    )
    expect(await db.insightReport.count()).toBe(1)
    const reportIds = new Set(fulfilled.map((r) => r.reportId))
    expect(reportIds.size).toBe(1)
    expect(fulfilled.every((r) => r.status === "OK")).toBe(true)
    expect(fulfilled.filter((r) => r.created)).toHaveLength(1)
    // 幂等返回者读到的洞察数与胜者一致
    expect(new Set(fulfilled.map((r) => r.insightCount))).toEqual(new Set([3]))
  })

  it("并发后再次串行生成仍幂等（一期）", { timeout: 60_000 }, async () => {
    const db = getTestDb()
    const again = await generateReport(db, "kai", demoNow())
    expect(again.created).toBe(false)
    expect(await db.insightReport.count()).toBe(1)
  })
})
