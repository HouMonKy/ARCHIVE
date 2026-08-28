import { describe, expect, it, beforeAll, afterAll } from "vitest"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import sharp from "sharp"
import { getTestDb, resetTestDb } from "../../helpers/db"
import {
  addAssetPhoto,
  listAssetPhotos,
  readAssetPhotoFile,
  deleteAssetPhoto,
  MAX_ASSET_PHOTOS,
} from "@/lib/services/asset-photos"
import { AppError } from "@/lib/errors"

/**
 * 藏品照片（收藏工作台改造）：
 * - 上传复用 EXIF 转正/最长边1600/JPEG85；文件落私有目录、库内只存元数据/SHA；
 * - 每件 ≤20 张；单张 >10MB 拒绝；
 * - 列表 createdAt 倒序；删除移除文件+行；
 * - 越权：非所属用户读/删 404；Visitor 沙箱同理（不同 userId 隔离）。
 */

let photosDir: string

beforeAll(async () => {
  photosDir = mkdtempSync(path.join(tmpdir(), "asset-photos-"))
  process.env.ASSET_PHOTOS_DIR = photosDir
  await resetTestDb()
})

afterAll(() => {
  delete process.env.ASSET_PHOTOS_DIR
  rmSync(photosDir, { recursive: true, force: true })
})

async function jpegBytes(width = 800, height = 600): Promise<Uint8Array> {
  const buf = await sharp({ create: { width, height, channels: 3, background: "#445566" } }).jpeg().toBuffer()
  return new Uint8Array(buf)
}

describe("藏品照片增删与读取", () => {
  it("上传 → 列表倒序 → 读取字节与库内元数据一致", async () => {
    const db = getTestDb()
    // demo 库 kai 有资产 A01..A08；取 A01
    const first = await listAssetPhotos(db, "kai", "A01")
    const before = first.length
    const photo = await addAssetPhoto(db, "kai", "A01", { name: "p1.jpg", mimeType: "image/jpeg", bytes: await jpegBytes() })
    expect(photo.assetId).toBe("A01")
    expect(photo.width).toBe(800)
    expect(photo.height).toBe(600)
    // 文件落盘
    expect(existsSync(path.join(photosDir, photo.id + ".jpg"))).toBe(true)
    // 列表含新照片
    const list = await listAssetPhotos(db, "kai", "A01")
    expect(list.length).toBe(before + 1)
    expect(list[0]!.id).toBe(photo.id)
    // 读取字节
    const file = await readAssetPhotoFile(db, "kai", "A01", photo.id)
    expect(file).not.toBeNull()
    expect(file!.mimeType).toBe("image/jpeg")
    expect(file!.bytes.byteLength).toBe(photo.sizeBytes)
  })

  it("多张照片按 createdAt 倒序（新上传在前）", async () => {
    const db = getTestDb()
    const p2 = await addAssetPhoto(db, "kai", "A01", { name: "p2.jpg", mimeType: "image/jpeg", bytes: await jpegBytes(600, 400) })
    const list = await listAssetPhotos(db, "kai", "A01")
    expect(list[0]!.id).toBe(p2.id)
    expect(list.length).toBeGreaterThanOrEqual(2)
  })

  it("EXIF 方向转正：Orientation=6 的竖拍横存图上传后宽高已转正", async () => {
    const db = getTestDb()
    const oriented = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#667788" } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer()
    const photo = await addAssetPhoto(db, "kai", "A02", { name: "exif.jpg", mimeType: "image/jpeg", bytes: new Uint8Array(oriented) })
    // Orientation=6：视觉 200×400 → 转正后 width=200 height=400
    expect(photo.width).toBe(200)
    expect(photo.height).toBe(400)
  })

  it("删除照片：行与文件移除", async () => {
    const db = getTestDb()
    const photo = await addAssetPhoto(db, "kai", "A03", { name: "tmp.jpg", mimeType: "image/jpeg", bytes: await jpegBytes(300, 300) })
    const filePath = path.join(photosDir, photo.id + ".jpg")
    expect(existsSync(filePath)).toBe(true)
    await deleteAssetPhoto(db, "kai", "A03", photo.id)
    expect(existsSync(filePath)).toBe(false)
    expect(await readAssetPhotoFile(db, "kai", "A03", photo.id)).toBeNull()
    // 二次删除 404
    await expect(deleteAssetPhoto(db, "kai", "A03", photo.id)).rejects.toMatchObject({ status: 404 })
  })

  it("超过 20 张拒绝（PHOTO_LIMIT_REACHED）", async () => {
    const db = getTestDb()
    const existing = await listAssetPhotos(db, "kai", "A04")
    for (let i = existing.length; i < MAX_ASSET_PHOTOS; i++) {
      await addAssetPhoto(db, "kai", "A04", { name: `fill-${i}.jpg`, mimeType: "image/jpeg", bytes: await jpegBytes(120, 120) })
    }
    await expect(
      addAssetPhoto(db, "kai", "A04", { name: "over.jpg", mimeType: "image/jpeg", bytes: await jpegBytes(120, 120) }),
    ).rejects.toMatchObject({ status: 422, code: "PHOTO_LIMIT_REACHED" })
  })

  it("单张 >10MB 拒绝（PHOTO_TOO_LARGE）", async () => {
    const db = getTestDb()
    const huge = new Uint8Array(10 * 1024 * 1024 + 100)
    await expect(
      addAssetPhoto(db, "kai", "A05", { name: "huge.jpg", mimeType: "image/jpeg", bytes: huge }),
    ).rejects.toMatchObject({ status: 400, code: "PHOTO_TOO_LARGE" })
  })
})

describe("跨用户越权（含 Visitor 沙箱）", () => {
  it("其他用户读取/删除/列表 → 404（不泄露存在性）", async () => {
    const db = getTestDb()
    const photo = await addAssetPhoto(db, "kai", "A06", { name: "mine.jpg", mimeType: "image/jpeg", bytes: await jpegBytes(200, 200) })
    // demo-guest（Visitor 沙箱）访问 kai 的照片
    await expect(listAssetPhotos(db, "demo-guest", "A06")).rejects.toMatchObject({ status: 404 })
    await expect(readAssetPhotoFile(db, "demo-guest", "A06", photo.id)).resolves.toBeNull()
    await expect(deleteAssetPhoto(db, "demo-guest", "A06", photo.id)).rejects.toMatchObject({ status: 404 })
    // 原主人仍可读
    expect(await readAssetPhotoFile(db, "kai", "A06", photo.id)).not.toBeNull()
  })

  it("照片 id 跨资产使用 → 404（photo.assetId 不匹配）", async () => {
    const db = getTestDb()
    const photo = await addAssetPhoto(db, "kai", "A07", { name: "a7.jpg", mimeType: "image/jpeg", bytes: await jpegBytes(200, 200) })
    // 同一用户但用别的资产 id 取这张照片
    await expect(readAssetPhotoFile(db, "kai", "A08", photo.id)).resolves.toBeNull()
    await expect(deleteAssetPhoto(db, "kai", "A08", photo.id)).rejects.toMatchObject({ status: 404 })
  })

  it("不存在的资产 → 404", async () => {
    const db = getTestDb()
    await expect(listAssetPhotos(db, "kai", "NO-SUCH-ASSET")).rejects.toMatchObject({ status: 404 })
    await expect(
      addAssetPhoto(db, "kai", "NO-SUCH-ASSET", { name: "x.jpg", mimeType: "image/jpeg", bytes: await jpegBytes() }),
    ).rejects.toMatchObject({ status: 404 })
    void AppError
  })
})
