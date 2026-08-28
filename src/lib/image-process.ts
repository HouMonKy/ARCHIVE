import sharp from "sharp"

/**
 * 用户上传照片处理（返工轮任务 2）：
 * - EXIF 方向自动修正（sharp rotate() 按方向标签转正）；
 * - 追加用户在预览中手动旋转的角度（0/90/180/270）；
 * - 最长边压到 ≤1600px（不放大小图），统一重编码 JPEG（质量 85）；
 * - 输出恒为 JPEG（封面是照片；PNG/WebP 透明无意义）。
 * 纯本地处理，原图/中间数据不落库、不打日志（仅返回尺寸与字节）。
 */

export const COVER_MAX_DIMENSION = 1600
export const COVER_JPEG_QUALITY = 85

export interface ProcessedImage {
  bytes: Uint8Array
  mimeType: "image/jpeg"
  width: number
  height: number
  /** 处理后字节的 SHA-256（hex） */
  sha256: string
}

export const USER_ROTATIONS = [0, 90, 180, 270] as const
export type UserRotation = (typeof USER_ROTATIONS)[number]

export function normalizeUserRotation(raw: unknown): UserRotation {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10)
  if ((USER_ROTATIONS as readonly number[]).includes(n)) return n as UserRotation
  return 0
}

export async function processUserImage(
  input: Uint8Array,
  userRotation: UserRotation = 0,
): Promise<ProcessedImage> {
  const pipeline = sharp(Buffer.from(input.buffer, input.byteOffset, input.byteLength), { failOn: "none" })
  const meta = await pipeline.metadata()
  // EXIF 方向（1..8）换算为角度；sharp rotate() 无参调用即按 EXIF 转正，
  // 显式角度时需要把 EXIF 角度叠加进来（rotate(angle) 会覆盖自动行为）
  const exifDegrees = exifOrientationDegrees(meta.orientation ?? 1)
  const total = (exifDegrees + userRotation) % 360
  const output = await pipeline
    .rotate(total)
    .resize(COVER_MAX_DIMENSION, COVER_MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: COVER_JPEG_QUALITY, mozjpeg: true })
    .toBuffer({ resolveWithObject: true })
  const { createHash } = await import("node:crypto")
  return {
    bytes: new Uint8Array(output.data),
    mimeType: "image/jpeg",
    width: output.info.width,
    height: output.info.height,
    sha256: createHash("sha256").update(output.data).digest("hex"),
  }
}

function exifOrientationDegrees(orientation: number | undefined): number {
  switch (orientation) {
    case 3:
    case 4:
      return 180
    case 5:
    case 6:
      return 90
    case 7:
    case 8:
      return 270
    default:
      return 0
  }
}
