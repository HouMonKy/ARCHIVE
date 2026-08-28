import type { PrismaClient, AssetCover } from "@prisma/client"
import { createHash, randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { isHostedRuntime } from "../db-mode"
import { demoNow } from "../clock"
import type { ProcessedImage } from "../image-process"

/**
 * 实体封面存储（返工轮任务 2）：
 * - 文件只落本机 private-assets/user-covers/（gitignored；HOSTED 模式不落盘）；
 * - 数据库只存元数据（文件名/尺寸/SHA-256），绝不存 Base64/原图字节；
 * - 待确认（未绑定 Asset）超过 24 小时的封面由清理任务删除（文件+行）；
 * - 读取强制租户校验：只能读当前用户自己的封面。
 */

/** 封面目录：默认 private-assets/user-covers/；测试可用 COVERS_DIR 覆盖到临时目录 */
export function coversDir(): string {
  return process.env.COVERS_DIR
    ? path.resolve(process.env.COVERS_DIR)
    : path.resolve(process.cwd(), "private-assets", "user-covers")
}
export const PENDING_COVER_TTL_MS = 24 * 3600_000

export interface StoredCover {
  id: string
  fileName: string
  url: string
}

/** 存储待确认封面；HOSTED 模式返回 null（占位图兜底，不落盘） */
export async function storePendingCover(
  db: PrismaClient,
  userId: string,
  image: ProcessedImage,
): Promise<StoredCover | null> {
  if (isHostedRuntime()) return null
  mkdirSync(coversDir(), { recursive: true })
  const id = randomUUID().replace(/-/g, "")
  const fileName = `${id}.jpg`
  const filePath = path.join(coversDir(), fileName)
  writeFileSync(filePath, image.bytes)
  await db.assetCover.create({
    data: {
      id,
      userId,
      fileName,
      mimeType: image.mimeType,
      sizeBytes: image.bytes.byteLength,
      width: image.width,
      height: image.height,
      sha256: image.sha256,
    },
  })
  return { id, fileName, url: `/api/covers/${id}` }
}

/** 确认时绑定：封面归属校验 + 关联 Asset（幂等：重复绑定同一封面无害） */
export async function bindCoverToAsset(
  db: PrismaClient,
  userId: string,
  coverId: string,
  assetId: string,
): Promise<boolean> {
  const cover = await db.assetCover.findUnique({ where: { id: coverId } })
  if (!cover || cover.userId !== userId) return false
  if (cover.assetId && cover.assetId !== assetId) return false
  if (!cover.assetId) {
    await db.assetCover.update({
      where: { id: coverId },
      data: { assetId, confirmedAt: demoNow() },
    })
  }
  return true
}

/** 读取封面文件（租户校验：仅当前用户自己的封面；HOSTED 返回 null → 路由层给占位图） */
export async function readCoverFile(
  db: PrismaClient,
  userId: string,
  coverId: string,
): Promise<{ bytes: Uint8Array; mimeType: string; provenance: "local" | "hosted-placeholder" } | null> {
  if (isHostedRuntime()) return { bytes: new Uint8Array(), mimeType: "image/svg+xml", provenance: "hosted-placeholder" }
  const cover = await db.assetCover.findUnique({ where: { id: coverId } })
  if (!cover || cover.userId !== userId) return null
  const filePath = path.join(coversDir(), cover.fileName)
  if (!filePath.startsWith(coversDir() + path.sep) || !existsSync(filePath)) return null
  return { bytes: new Uint8Array(readFileSync(filePath)), mimeType: cover.mimeType, provenance: "local" }
}

/** 清理超过 24 小时仍未确认的待定封面（文件 + 行）；返回删除数量 */
export async function sweepPendingCovers(db: PrismaClient, now: Date = demoNow()): Promise<number> {
  const deadline = new Date(now.getTime() - PENDING_COVER_TTL_MS)
  const stale = await db.assetCover.findMany({
    where: { assetId: null, createdAt: { lt: deadline } },
    select: { id: true, fileName: true },
  })
  for (const cover of stale) {
    const filePath = path.join(coversDir(), cover.fileName)
    if (filePath.startsWith(coversDir() + path.sep) && existsSync(filePath)) {
      rmSync(filePath, { force: true })
    }
    await db.assetCover.deleteMany({ where: { id: cover.id, assetId: null } })
  }
  return stale.length
}

/** 封面 DTO（识别响应/草稿恢复用；不含文件路径等内部细节） */
export function toCoverDTO(cover: AssetCover | null): { id: string; url: string } | null {
  if (!cover) return null
  return { id: cover.id, url: `/api/covers/${cover.id}` }
}
