import { describe, expect, it, beforeAll } from "vitest"
import { getTestDb, resetTestDb } from "../helpers/db"
import { confirmAsset, updateAsset, getAsset } from "@/lib/services/assets"
import { createRecognitionJob } from "@/lib/services/recognition"
import { demoNow, diffDays } from "@/lib/clock"
import { readSampleFile } from "../helpers/files"

/** 幂等确认、重复第二件、识别修正标记（FR-04 / §8.1 步骤 6-7 / §19 确认幂等键） */
describe("确认入库（幂等与重复）", () => {
  beforeAll(async () => {
    await resetTestDb()
  })

  it("确认候选后创建实体并标记任务 CONFIRMED", async () => {
    const db = getTestDb()
    const job = await createRecognitionJob(db, "kai", readSampleFile("box-unicorn-demo.svg"))
    const before = await db.collectionAsset.count()
    const result = await confirmAsset(db, "kai", {
      idempotencyKey: "confirm-key-0001",
      jobId: job.jobId,
      productId: "P03",
      dispositionState: "ACTIVE",
      buildState: "UNOPENED",
      progress: 0,
      purchasePriceMinor: 130000,
    })
    expect(result.created).toBe(true)
    expect(await db.collectionAsset.count()).toBe(before + 1)
    const jobRow = await db.recognitionJob.findUnique({ where: { id: job.jobId } })
    expect(jobRow?.state).toBe("CONFIRMED")
    expect(jobRow?.confirmedAt).toEqual(demoNow())
    expect(result.asset.confirmedAt).toEqual(demoNow())
    expect(result.asset.recognitionCorrected).toBeNull() // 显式选择候选 → 未修正
  })

  it("同一 idempotency key 重复提交只产生一件实体（重复提交安全）", async () => {
    const db = getTestDb()
    const before = await db.collectionAsset.count()
    const again = await confirmAsset(db, "kai", {
      idempotencyKey: "confirm-key-0001",
      productId: "P03",
      buildState: "UNOPENED",
      progress: 0,
    })
    expect(again.created).toBe(false)
    expect(await db.collectionAsset.count()).toBe(before)
  })

  it("允许同 SKU 新增第二件实体（重复提示不阻断）", async () => {
    const db = getTestDb()
    const before = await db.collectionAsset.count()
    const second = await confirmAsset(db, "kai", {
      idempotencyKey: "confirm-key-0002",
      productId: "P03",
      buildState: "BUILDING",
      progress: 20,
    })
    expect(second.created).toBe(true)
    expect(await db.collectionAsset.count()).toBe(before + 1)
    const p03Count = await db.collectionAsset.count({ where: { catalogProductId: "P03" } })
    expect(p03Count).toBe(3) // A02 + 两件新确认
  })

  it("未选候选而按编辑结果建立自定义收藏时记录“识别被修正”；显式选择候选则未修正", async () => {
    const db = getTestDb()
    const job = await createRecognitionJob(db, "kai", readSampleFile("box-zeta-glare-demo.svg"))
    const result = await confirmAsset(db, "kai", {
      idempotencyKey: "confirm-key-0003",
      jobId: job.jobId,
      custom: { name: "MG Zeta Gundam Ver.Ka（用户修正）", brand: "Bandai" },
      buildState: "UNOPENED",
      progress: 0,
    })
    expect(result.asset.recognitionCorrected).toBe(true)
    // 显式选择候选（Provider/官网候选）→ 未修正
    const job2 = await createRecognitionJob(db, "kai", readSampleFile("box-unicorn-demo.svg"))
    const result2 = await confirmAsset(db, "kai", {
      idempotencyKey: "confirm-key-0003b",
      jobId: job2.jobId,
      productId: "P03",
      buildState: "UNOPENED",
      progress: 0,
    })
    expect(result2.asset.recognitionCorrected).toBeNull()
  })

  it("已完成任务再次确认返回已关联实体，不重复创建", async () => {
    const db = getTestDb()
    const job = await createRecognitionJob(db, "kai", readSampleFile("box-unicorn-demo.svg"))
    const first = await confirmAsset(db, "kai", {
      idempotencyKey: "confirm-key-0004",
      jobId: job.jobId,
      productId: "P03",
      buildState: "UNOPENED",
      progress: 0,
    })
    const before = await db.collectionAsset.count()
    const replay = await confirmAsset(db, "kai", {
      idempotencyKey: "confirm-key-0005",
      jobId: job.jobId,
      productId: "P03",
      buildState: "UNOPENED",
      progress: 0,
    })
    expect(replay.created).toBe(false)
    expect(replay.asset.id).toBe(first.asset.id)
    expect(await db.collectionAsset.count()).toBe(before)
  })

  it("自定义商品（非高达品类）手动确认入库", async () => {
    const db = getTestDb()
    const result = await confirmAsset(db, "kai", {
      idempotencyKey: "confirm-key-0006",
      custom: { name: "Technic Supercar Demo", brand: "LEGO" },
      buildState: "NOT_APPLICABLE",
      progress: 0,
      purchasePriceMinor: 90000,
    })
    expect(result.created).toBe(true)
    expect(result.asset.displayName).toBe("Technic Supercar Demo")
    expect(result.asset.brand).toBe("LEGO")
  })

  it("BUILDING 进度越界被服务端拒绝（422）", async () => {
    const db = getTestDb()
    await expect(
      confirmAsset(db, "kai", {
        idempotencyKey: "confirm-key-0007",
        productId: "P01",
        buildState: "BUILDING",
        progress: 0,
      }),
    ).rejects.toMatchObject({ status: 422 })
  })
})

describe("实体更新（D-04 状态同步与停滞判定基准）", () => {
  beforeAll(async () => {
    await resetTestDb()
  })

  it("未开盒 → 制作中（40%）后详情与统计同步更新", async () => {
    const db = getTestDb()
    const updated = await updateAsset(db, "kai", "A03", { buildState: "BUILDING", progress: 40 })
    expect(updated.buildState).toBe("BUILDING")
    expect(updated.progress).toBe(40)
    expect(updated.lastActivityAt).toEqual(demoNow())
    const fetched = await getAsset(db, "kai", "A03")
    expect(fetched.progress).toBe(40)
    // 更新后 A03 不再是“未开盒”，Dashboard 状态分布应反映新状态
    const { getDashboardStats } = await import("@/lib/services/stats")
    const stats = await getDashboardStats(db, "kai", demoNow())
    expect(stats.buildStateDistribution.find((d) => d.key === "BUILDING")?.count).toBe(2)
    expect(stats.buildStateDistribution.find((d) => d.key === "UNOPENED")?.count).toBe(1)
  })

  it("切换 COMPLETED 自动要求 100% 并写入完成日期", async () => {
    const db = getTestDb()
    const updated = await updateAsset(db, "kai", "A03", { buildState: "COMPLETED", progress: 100 })
    expect(updated.completedAt).toEqual(demoNow())
    await expect(updateAsset(db, "kai", "A06", { buildState: "COMPLETED", progress: 50 })).rejects.toMatchObject({
      status: 422,
    })
  })

  it("A02 更新进度后不再命中 14 天停滞", async () => {
    const db = getTestDb()
    await updateAsset(db, "kai", "A02", { progress: 70 })
    const { getDashboardStats } = await import("@/lib/services/stats")
    const stats = await getDashboardStats(db, "kai", demoNow())
    expect(stats.stalled).toHaveLength(0)
    expect(diffDays(demoNow(), demoNow())).toBe(0)
  })

  it("归档后不计入统计，可再取消归档", async () => {
    const db = getTestDb()
    await updateAsset(db, "kai", "A04", { archived: true })
    const { getDashboardStats } = await import("@/lib/services/stats")
    expect((await getDashboardStats(db, "kai", demoNow())).currentCollection).toBe(6)
    await updateAsset(db, "kai", "A04", { archived: false })
    expect((await getDashboardStats(db, "kai", demoNow())).currentCollection).toBe(7)
  })
})
