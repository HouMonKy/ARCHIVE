import { describe, expect, it, beforeAll, afterAll } from "vitest"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getTestDb, resetTestDb } from "../../helpers/db"
import { storePendingCover, bindCoverToAsset, readCoverFile, sweepPendingCovers, coversDir } from "@/lib/services/covers"
import { processUserImage } from "@/lib/image-process"
import { confirmAsset } from "@/lib/services/assets"
import sharp from "sharp"

/**
 * 封面生命周期（返工轮任务 2）：存储 → 24h 待确认清理 → 确认绑定 → 租户隔离读取。
 * 测试用独立临时 COVERS_DIR（不污染真实 private-assets/user-covers/）。
 */

let testCoversDir: string

beforeAll(() => {
  testCoversDir = mkdtempSync(path.join(tmpdir(), "covers-test-"))
  process.env.COVERS_DIR = testCoversDir
})

afterAll(() => {
  process.env.COVERS_DIR = undefined
  rmSync(testCoversDir, { recursive: true, force: true })
})

function coversPath(fileName: string): string {
  return path.join(coversDir(), fileName)
}

async function fixtureImage(w = 200, h = 120): Promise<ReturnType<typeof processUserImage>> {
  const png = await sharp({ create: { width: w, height: h, channels: 3, background: "#ababab" } }).png().toBuffer()
  return processUserImage(new Uint8Array(png))
}

describe("封面存储与租户隔离", () => {
  it("待确认封面：文件落盘 + 行入库；数据库无 Base64/原图字节", async () => {
    await resetTestDb()
    const db = getTestDb()
    const image = await fixtureImage()
    const stored = (await storePendingCover(db, "kai", image))!
    expect(stored).not.toBeNull()
    expect(existsSync(coversPath(stored.fileName))).toBe(true)
    const row = await db.assetCover.findUnique({ where: { id: stored.id } })
    expect(row?.userId).toBe("kai")
    expect(row?.assetId).toBeNull()
    expect(row?.sha256).toBe(image.sha256)
    expect(row?.sizeBytes).toBe(image.bytes.byteLength)
    // 数据库只存元数据：序列化后不得出现 base64 图像数据
    expect(JSON.stringify(row)).not.toContain("base64")
  })

  it("租户隔离：他人读取返回 null；本人可读且字节一致", async () => {
    await resetTestDb()
    const db = getTestDb()
    const image = await fixtureImage()
    const stored = (await storePendingCover(db, "kai", image))!
    const stranger = await readCoverFile(db, "demo-guest", stored.id)
    expect(stranger).toBeNull()
    const mine = await readCoverFile(db, "kai", stored.id)
    expect(mine?.provenance).toBe("local")
    expect(Array.from(mine!.bytes)).toEqual(Array.from(image.bytes))
  })

  it("24 小时清理：过期未确认的删除（文件 + 行），已绑定与未过期保留", async () => {
    await resetTestDb()
    const db = getTestDb()
    const now = new Date("2026-08-25T12:00:00+08:00")
    // 过期待确认（26 小时前创建）
    const stale = (await storePendingCover(db, "kai", await fixtureImage()))!
    await db.assetCover.update({ where: { id: stale.id }, data: { createdAt: new Date(now.getTime() - 26 * 3600_000) } })
    // 新鲜待确认（1 小时前）
    const fresh = (await storePendingCover(db, "kai", await fixtureImage()))!
    // 已绑定（30 小时前创建但已确认绑定到 A01）
    const bound = (await storePendingCover(db, "kai", await fixtureImage()))!
    await db.assetCover.update({
      where: { id: bound.id },
      data: { createdAt: new Date(now.getTime() - 30 * 3600_000), assetId: "A01", confirmedAt: now },
    })

    const deleted = await sweepPendingCovers(db, now)
    expect(deleted).toBe(1)
    expect(existsSync(coversPath(stale.fileName))).toBe(false)
    expect(await db.assetCover.findUnique({ where: { id: stale.id } })).toBeNull()
    expect(await db.assetCover.findUnique({ where: { id: fresh.id } })).not.toBeNull()
    expect(existsSync(coversPath(fresh.fileName))).toBe(true)
    expect(await db.assetCover.findUnique({ where: { id: bound.id } })).not.toBeNull()
    expect(existsSync(coversPath(bound.fileName))).toBe(true)
  })

  it("确认入库带 coverId：封面绑定 Asset + confirmedAt 落库；重复绑定幂等", async () => {
    await resetTestDb()
    const db = getTestDb()
    const image = await fixtureImage()
    const stored = (await storePendingCover(db, "kai", image))!
    const result = await confirmAsset(db, "kai", {
      idempotencyKey: "cover-bind-test-0001",
      productId: "P02",
      coverId: stored.id,
      buildState: "UNOPENED",
      progress: 0,
    })
    expect(result.created).toBe(true)
    const cover = await db.assetCover.findUnique({ where: { id: stored.id } })
    expect(cover?.assetId).toBe(result.asset.id)
    expect(cover?.confirmedAt).not.toBeNull()
    // DTO 侧：重新读取实体可见已绑定封面
    const { getAsset } = await import("@/lib/services/assets")
    const refetched = await getAsset(db, "kai", result.asset.id)
    expect(refetched.cover?.id).toBe(stored.id)
    // 幂等：再次绑定同一封面无害
    expect(await bindCoverToAsset(db, "kai", stored.id, result.asset.id)).toBe(true)
    // 他人封面不得绑定到他人实体
    expect(await bindCoverToAsset(db, "demo-guest", stored.id, result.asset.id)).toBe(false)
  })

  it("他人 coverId 确认：403 拒绝（不静默忽略越权引用）", async () => {
    await resetTestDb()
    const db = getTestDb()
    const stored = (await storePendingCover(db, "kai", await fixtureImage()))!
    await expect(
      confirmAsset(db, "demo-guest", {
        idempotencyKey: "cover-forbid-test-01",
        productId: "P02",
        coverId: stored.id,
        buildState: "UNOPENED",
        progress: 0,
      }),
    ).rejects.toMatchObject({ status: 403 })
  })
})
