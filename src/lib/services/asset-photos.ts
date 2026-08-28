import type { PrismaClient, AssetPhoto } from "@prisma/client"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { isHostedRuntime } from "../db-mode"
import { demoNow } from "../clock"
import { processUserImage } from "../image-process"
import { AppError } from "../errors"

/**
 * 藏品照片（收藏工作台改造）：
 * - 一对多：识别图（AssetCover 入柜识别图）永久首位 + 用户追加本人拍摄照片；
 * - 每件 ≤MAX_ASSET_PHOTOS 张、单张上传 ≤10MB（复用上传校验后的处理：EXIF 转正/最长边1600/JPEG85）；
 * - 文件存本机私有目录 private-assets/asset-photos/（gitignored；HOSTED 不落盘），
 *   数据库只存元数据/SHA——原图/Base64 不进库；
 * - 每个读写删除都校验 session 用户与 asset.userId（防越权枚举）；识别图不从照片区删除。
 */

export const MAX_ASSET_PHOTOS = 20
export const MAX_PHOTO_UPLOAD_BYTES = 10 * 1024 * 1024

/** 照片目录：默认 private-assets/asset-photos/；测试可用 ASSET_PHOTOS_DIR 覆盖 */
export function assetPhotosDir(): string {
  return process.env.ASSET_PHOTOS_DIR
    ? path.resolve(process.env.ASSET_PHOTOS_DIR)
    : path.resolve(process.cwd(), "private-assets", "asset-photos")
}

export interface AssetPhotoDTO {
  id: string
  assetId: string
  url: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  createdAt: Date
}

export function toPhotoDTO(photo: AssetPhoto): AssetPhotoDTO {
  return {
    id: photo.id,
    assetId: photo.assetId,
    url: `/api/assets/${photo.assetId}/photos/${photo.id}`,
    mimeType: photo.mimeType,
    sizeBytes: photo.sizeBytes,
    width: photo.width,
    height: photo.height,
    createdAt: photo.createdAt,
  }
}

/** 资产归属校验：不存在或非本人 → null（调用方给 404/403） */
async function ownedAsset(db: PrismaClient, userId: string, assetId: string) {
  const asset = await db.collectionAsset.findUnique({ where: { id: assetId }, select: { id: true, userId: true } })
  if (!asset || asset.userId !== userId) return null
  return asset
}

/** 追加用户照片（EXIF 转正+压缩后落盘；满额 422） */
export async function addAssetPhoto(
  db: PrismaClient,
  userId: string,
  assetId: string,
  file: { name: string; mimeType: string; bytes: Uint8Array },
): Promise<AssetPhotoDTO> {
  const asset = await ownedAsset(db, userId, assetId)
  if (!asset) throw new AppError("藏品不存在", { status: 404, code: "ASSET_NOT_FOUND" })
  if (file.bytes.byteLength > MAX_PHOTO_UPLOAD_BYTES) {
    throw new AppError(`单张照片超过 10MB 上限（当前 ${(file.bytes.byteLength / 1024 / 1024).toFixed(1)}MB）`, { status: 400, code: "PHOTO_TOO_LARGE" })
  }
  const count = await db.assetPhoto.count({ where: { assetId } })
  if (count >= MAX_ASSET_PHOTOS) {
    throw new AppError(`每件藏品最多 ${MAX_ASSET_PHOTOS} 张照片，可删除旧照片后重试`, { status: 422, code: "PHOTO_LIMIT_REACHED" })
  }
  if (isHostedRuntime()) {
    throw new AppError("托管模式暂不支持照片落盘", { status: 501, code: "HOSTED_NO_PHOTOS" })
  }
  // 复用入柜识别图处理管线：EXIF 转正 + 最长边 1600 + JPEG 85
  const processed = await processUserImage(file.bytes, 0)
  mkdirSync(assetPhotosDir(), { recursive: true })
  const id = randomUUID().replace(/-/g, "")
  const fileName = `${id}.jpg`
  writeFileSync(path.join(assetPhotosDir(), fileName), processed.bytes)
  const row = await db.assetPhoto.create({
    data: {
      id,
      userId,
      assetId,
      fileName,
      mimeType: processed.mimeType,
      sizeBytes: processed.bytes.byteLength,
      width: processed.width,
      height: processed.height,
      sha256: processed.sha256,
    },
  })
  return toPhotoDTO(row)
}

/** 列出藏品照片（createdAt 倒序；越权 404） */
export async function listAssetPhotos(db: PrismaClient, userId: string, assetId: string): Promise<AssetPhotoDTO[]> {
  const asset = await ownedAsset(db, userId, assetId)
  if (!asset) throw new AppError("藏品不存在", { status: 404, code: "ASSET_NOT_FOUND" })
  const rows = await db.assetPhoto.findMany({ where: { assetId }, orderBy: { createdAt: "desc" } })
  return rows.map(toPhotoDTO)
}

/** 读取照片文件（逐级越权校验：资产归属 + 照片归属） */
export async function readAssetPhotoFile(
  db: PrismaClient,
  userId: string,
  assetId: string,
  photoId: string,
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const asset = await ownedAsset(db, userId, assetId)
  if (!asset) return null
  const photo = await db.assetPhoto.findUnique({ where: { id: photoId } })
  if (!photo || photo.assetId !== assetId || photo.userId !== userId) return null
  const filePath = path.join(assetPhotosDir(), photo.fileName)
  if (!filePath.startsWith(assetPhotosDir() + path.sep) || !existsSync(filePath)) return null
  return { bytes: new Uint8Array(readFileSync(filePath)), mimeType: photo.mimeType }
}

/** 删除用户照片（识别图不在此区——AssetCover 与照片表无关，天然不可误删；越权 404） */
export async function deleteAssetPhoto(
  db: PrismaClient,
  userId: string,
  assetId: string,
  photoId: string,
): Promise<void> {
  const asset = await ownedAsset(db, userId, assetId)
  if (!asset) throw new AppError("藏品不存在", { status: 404, code: "ASSET_NOT_FOUND" })
  const photo = await db.assetPhoto.findUnique({ where: { id: photoId } })
  if (!photo || photo.assetId !== assetId || photo.userId !== userId) {
    throw new AppError("照片不存在", { status: 404, code: "PHOTO_NOT_FOUND" })
  }
  await db.assetPhoto.delete({ where: { id: photoId } })
  const filePath = path.join(assetPhotosDir(), photo.fileName)
  if (filePath.startsWith(assetPhotosDir() + path.sep) && existsSync(filePath)) {
    rmSync(filePath, { force: true })
  }
  void demoNow
}
