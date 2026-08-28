import { describe, expect, it } from "vitest"
import { getTestDb, resetTestDb } from "../../helpers/db"
import { migrateOwnerSeeds } from "@/lib/services/owner-seed-migration"
import { ensureBaseRows } from "@/lib/services/bootstrap"

/**
 * Owner 库治理回归（返工轮任务 1/5）：
 * - migrateOwnerSeeds：删 A01–A08 种子及派生建议/假偏好；保留随机 ID 真实资产/识别任务/AI 台账；
 *   demo-v1 引用转 official 或自定义快照；幂等可重跑；
 * - ensureBaseRows（db:bootstrap 核心）：只补缺失基础行，绝不删既有数据。
 */

describe("Owner 种子迁移（migrateOwnerSeeds）", () => {
  it("删除种子 A01–A08 与派生数据；保留真实资产/识别任务/AI 台账；demo-v1 清零", async () => {
    await resetTestDb() // kai 含 A01–A08 种子 + demo 目录
    const db = getTestDb()

    // 制造"真实"数据：随机 ID 资产（引用 demo-v1 P05）、识别任务、AI 台账、会话
    await db.collectionAsset.create({
      data: {
        id: "real-asset-0001",
        userId: "kai",
        catalogProductId: "P05",
        dispositionState: "ACTIVE",
        buildState: "COMPLETED",
        progress: 100,
        confirmedAt: new Date("2026-08-24T00:00:00+08:00"),
        lastActivityAt: new Date("2026-08-24T00:00:00+08:00"),
      },
    })
    await db.recognitionJob.create({
      data: {
        id: "real-job-0001",
        userId: "kai",
        state: "SUCCEEDED",
        provider: "kimi",
        providerVersion: "kimi/kimi-k2.6",
        fileSha256: "a".repeat(64),
      },
    })
    await db.aiUsageLog.create({
      data: { provider: "moonshot", model: "kimi-k2.6", kind: "RECOGNITION", latencyMs: 100, costMinor: 10 },
    })

    const result = await migrateOwnerSeeds(db)

    expect(result.deletedSeedAssets).toBe(8) // A01–A08
    expect(result.deletedSeedPreferences).toBe(4) // 种子假偏好
    expect(result.deletedDemoProducts).toBe(12) // demo-v1 目录
    expect(result.deletedDemoEvents).toBe(4) // 演示事件
    // 种子快照报告（demo-v1:snap-*）被删
    expect(await db.insightReport.findMany({ where: { snapshotVersion: { startsWith: "demo-v1:" } } })).toHaveLength(0)
    // 真实数据保留
    expect(await db.collectionAsset.findUnique({ where: { id: "real-asset-0001" } })).not.toBeNull()
    expect(await db.recognitionJob.findUnique({ where: { id: "real-job-0001" } })).not.toBeNull()
    expect(await db.aiUsageLog.count()).toBeGreaterThanOrEqual(1)
    // P05 无 official 匹配 → 转自定义快照
    const real = await db.collectionAsset.findUniqueOrThrow({ where: { id: "real-asset-0001" } })
    expect(real.catalogProductId).toBeNull()
    expect(real.customName).toBe("PG Unleashed RX-78-2 Gundam")
    expect(real.customBrand).toBe("Bandai")
    // demo-v1 清零
    expect(await db.catalogProduct.count({ where: { catalogVersion: "demo-v1" } })).toBe(0)
  })

  it("幂等：重跑全 0（不重复删除、不误删真实数据）", async () => {
    const db = getTestDb()
    const again = await migrateOwnerSeeds(db)
    expect(again.deletedSeedAssets).toBe(0)
    expect(again.deletedDemoProducts).toBe(0)
    expect(again.deletedSeedReports).toBe(0)
    expect(await db.collectionAsset.findUnique({ where: { id: "real-asset-0001" } })).not.toBeNull()
    expect(await db.recognitionJob.findUnique({ where: { id: "real-job-0001" } })).not.toBeNull()
  })
})

describe("db:bootstrap 非破坏（ensureBaseRows）", () => {
  it("已有数据时：不新建、不更新、不删除任何行", async () => {
    const db = getTestDb()
    const before = {
      users: await db.user.count(),
      assets: await db.collectionAsset.count(),
      products: await db.catalogProduct.count(),
      jobs: await db.recognitionJob.count(),
      preferences: await db.userPreference.count(),
    }
    expect(before.assets).toBeGreaterThan(0) // 前一用例保留的真实资产

    const result = await ensureBaseRows(db)
    expect(result.createdOwner).toBe(false)
    expect(result.createdDemoTenant).toBe(false)

    const after = {
      users: await db.user.count(),
      assets: await db.collectionAsset.count(),
      products: await db.catalogProduct.count(),
      jobs: await db.recognitionJob.count(),
      preferences: await db.userPreference.count(),
    }
    expect(after).toEqual(before)
  })

  it("空库（仅基础行缺失时）：创建 Owner/Demo 租户与路线；已有资产绝不删除", async () => {
    const db = getTestDb()
    // 清空用户（级联会清资产——换成仅验证创建路径：先删 users 之外不动资产的场景由上例覆盖）
    await db.userPreference.deleteMany()
    await db.collectionAsset.deleteMany()
    await db.recognitionJob.deleteMany()
    await db.userProductIntent.deleteMany()
    await db.releaseEvent.deleteMany()
    await db.catalogProduct.deleteMany()
    await db.assetCover.deleteMany()
    await db.insightFeedback.deleteMany()
    await db.insight.deleteMany()
    await db.insightReport.deleteMany()
    await db.session.deleteMany()
    await db.user.deleteMany()

    const result = await ensureBaseRows(db)
    expect(result.createdOwner).toBe(true)
    expect(result.createdDemoTenant).toBe(true)
    expect(await db.user.count()).toBe(2)
    expect(result.routeNodes).toBeGreaterThan(0)
    expect(result.routeEdges).toBeGreaterThan(0)
  })
})
