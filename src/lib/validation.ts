import { createHash } from "node:crypto"
import { z } from "zod"
import { AppError } from "./errors"
import { validateJpegStructure, validatePngStructure, validateWebpStructure } from "./image-structure"
import { BUILD_STATES, DISPOSITION_STATES, type BuildState } from "./asset-states"

export { BUILD_STATES, DISPOSITION_STATES, type BuildState, type DispositionState } from "./asset-states"

/** FR-02：单文件 ≤10MB；常规支持 JPEG/PNG/WebP；SVG 仅放行已知演示样例（按内容哈希） */
export const MAX_UPLOAD_FILE_SIZE = 10 * 1024 * 1024

export type UploadImageKind = "jpeg" | "png" | "webp" | "svg"

export interface UploadFileInput {
  name: string
  mimeType: string
  bytes: Uint8Array
}

export type FileValidationOk = { ok: true; kind: UploadImageKind; sha256: string }
export type FileValidationErr = { ok: false; code: "FILE_TOO_LARGE" | "UNSUPPORTED_TYPE" | "CORRUPT_FILE"; message: string }
export type FileValidationResult = FileValidationOk | FileValidationErr

/** 文件头（magic number）识别，权威于扩展名与 MIME 声明 */
export function detectImageKind(bytes: Uint8Array): UploadImageKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg"
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "webp"
  }
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 512)).trimStart()
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "svg"
  return null
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

export function validateUploadFile(file: UploadFileInput, allowedSvgHashes: ReadonlySet<string>): FileValidationResult {
  if (file.bytes.byteLength <= 0) {
    return { ok: false, code: "CORRUPT_FILE", message: "文件为空或已损坏，无法识别" }
  }
  if (file.bytes.byteLength > MAX_UPLOAD_FILE_SIZE) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: `文件超过 10MB 上限（当前 ${(file.bytes.byteLength / 1024 / 1024).toFixed(1)}MB），请压缩后重试`,
    }
  }
  const kind = detectImageKind(file.bytes)
  if (kind == null) {
    return { ok: false, code: "CORRUPT_FILE", message: "文件已损坏或格式不受支持，请改用清晰的 JPEG/PNG/WebP 盒面照" }
  }
  // 结构完整性校验：拒绝“仅合法文件头/截断/伪造长度/CRC 损坏”的伪图片
  const structureOk =
    kind === "jpeg"
      ? validateJpegStructure(file.bytes)
      : kind === "png"
        ? validatePngStructure(file.bytes)
        : kind === "webp"
          ? validateWebpStructure(file.bytes)
          : true
  if (!structureOk) {
    return { ok: false, code: "CORRUPT_FILE", message: "文件已损坏或图片数据不完整（无法解码），请重新导出后上传" }
  }
  const sha256 = sha256Hex(file.bytes)
  if (kind === "svg" && !allowedSvgHashes.has(sha256)) {
    return { ok: false, code: "UNSUPPORTED_TYPE", message: "暂不支持该格式：请上传 JPEG/PNG/WebP 盒面照（SVG 仅限内置演示样例）" }
  }
  return { ok: true, kind, sha256 }
}

export function validateBuildProgress(buildState: BuildState, progress: number): { ok: true; progress: number } | { ok: false; message: string } {
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
    return { ok: false, message: "进度必须为 0–100 的整数" }
  }
  switch (buildState) {
    case "BUILDING":
      if (progress < 1 || progress > 99) return { ok: false, message: "制作中的进度必须为 1–99%" }
      return { ok: true, progress }
    case "COMPLETED":
      if (progress !== 100) return { ok: false, message: "已完成时进度必须为 100%" }
      return { ok: true, progress }
    case "NOT_APPLICABLE":
      if (progress !== 0) return { ok: false, message: "不适用制作的实体进度必须为 0%" }
      return { ok: true, progress }
    default:
      return { ok: true, progress }
  }
}

export function assertBuildProgress(buildState: BuildState, progress: number): number {
  const r = validateBuildProgress(buildState, progress)
  if (!r.ok) throw new AppError(r.message, { status: 422, code: "INVALID_PROGRESS" })
  return r.progress
}

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/
const isoDateSchema = z.string().regex(isoDatePattern, "日期格式应为 YYYY-MM-DD")

export function parseIsoDateToUtc(value: string | null | undefined): Date | null {
  if (!value) return null
  if (!isoDatePattern.test(value)) throw new AppError("日期格式应为 YYYY-MM-DD", { status: 422, code: "INVALID_DATE" })
  return new Date(`${value}T00:00:00+08:00`)
}

const buildStateSchema = z.enum(BUILD_STATES)
const dispositionSchema = z.enum(DISPOSITION_STATES)

/** 识别结果编辑（重搜/自定义入库用）：Kimi 原始提取 + 用户修正 */
export const extractionEditSchema = z.object({
  brand: z.string().trim().min(1, "请填写品牌").max(40),
  name: z.string().trim().min(1, "请填写商品完整名称").max(200),
  nameZh: z.string().trim().max(120).optional().default(""),
  series: z.string().trim().max(120).optional().default(""),
  grade: z.string().trim().max(40).optional().default(""),
  scale: z.string().trim().max(20).optional().default(""),
  modelNumber: z.string().trim().max(120).optional().default(""),
})
export type ExtractionEditInput = z.infer<typeof extractionEditSchema>

/** 官网搜索候选（确认入库）：来自已验证的官网候选（key = 官方页面 ID/产品编号派生） */
export const officialCandidateSchema = z.object({
  key: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  officialName: z.string().trim().min(1).max(200),
  nameZh: z.string().trim().max(120).nullish(),
  productCode: z.string().trim().max(40).nullish(),
  pageUrl: z.string().url().max(500),
  imageUrl: z.string().url().max(1000).nullish(),
  sourceDomain: z.string().trim().max(100).nullish(),
  brand: z.string().trim().min(1).max(40),
  grade: z.string().trim().max(40).nullish(),
  scale: z.string().trim().max(20).nullish(),
  modelNumber: z.string().trim().max(120).nullish(),
  series: z.string().trim().max(120).nullish(),
  releaseYear: z.number().int().min(1980).max(2100).nullish(),
  line: z.string().trim().max(40).nullish(),
})
export type OfficialCandidateInput = z.infer<typeof officialCandidateSchema>

export const confirmAssetSchema = z
  .object({
    idempotencyKey: z.string().min(8).max(64),
    jobId: z.string().min(1).max(64).nullish(),
    // 目录商品 id：Provider（E2E 演示）候选或既有官方目录商品的精确键
    productId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).nullish(),
    coverId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/).nullish(),
    // 官网搜索候选（生产主链路：确认后建档官方商品并下载官网图）
    officialCandidate: officialCandidateSchema.nullish(),
    custom: z
      .object({
        name: z.string().trim().min(1, "请填写商品名").max(80),
        brand: z.string().trim().min(1, "请填写品牌").max(40),
      })
      .nullish(),
    dispositionState: dispositionSchema.default("ACTIVE"),
    buildState: buildStateSchema,
    progress: z.number().int().min(0).max(100).default(0),
    purchasePriceMinor: z.number().int().min(0).max(100_000_000).nullish(),
    purchasedAt: isoDateSchema.nullish(),
    note: z.string().max(500).nullish(),
  })
  .refine((d) => (d.productId != null ? d.officialCandidate == null && d.custom == null : d.officialCandidate != null || d.custom != null), {
    message: "必须选择目录商品、官网候选或填写自定义商品之一",
  })

export type ConfirmAssetInput = z.infer<typeof confirmAssetSchema>

export const updateAssetSchema = z
  .object({
    dispositionState: dispositionSchema.optional(),
    archived: z.boolean().optional(),
    buildState: buildStateSchema.optional(),
    progress: z.number().int().min(0).max(100).optional(),
    purchasePriceMinor: z.number().int().min(0).max(100_000_000).nullish(),
    purchasedAt: isoDateSchema.nullish(),
    note: z.string().max(500).nullish(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "没有需要更新的字段" })

export type UpdateAssetInput = z.infer<typeof updateAssetSchema>

export const feedbackSchema = z.object({
  value: z.enum(["USEFUL", "NOT_INTERESTED", "ACTED"]),
})

export const intentSchema = z.object({
  productId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  state: z.literal("WISHLIST"),
})
