import { describe, expect, it } from "vitest"
import {
  detectImageKind,
  validateBuildProgress,
  validateUploadFile,
  parseIsoDateToUtc,
  confirmAssetSchema,
} from "@/lib/validation"
import { getKnownDemoSampleHashes } from "@/lib/ai/fixture"
import { fakeJpegBytes, fakePngBytesCorrupted, readSampleFile } from "../helpers/files"

describe("文件上传校验（FR-02：JPEG/PNG/WebP，≤10MB；SVG 仅限演示样例）", () => {
  const svgHashes = getKnownDemoSampleHashes()

  it("识别 JPEG/PNG/WebP 文件头", () => {
    expect(detectImageKind(fakeJpegBytes())).toBe("jpeg")
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    expect(detectImageKind(png)).toBe("png")
    const webp = new Uint8Array(12)
    webp.set([0x52, 0x49, 0x46, 0x46], 0) // RIFF
    webp.set([0x57, 0x45, 0x42, 0x50], 8) // WEBP
    expect(detectImageKind(webp)).toBe("webp")
  })

  it("损坏文件（扩展名 png 但文件头非法）被拒绝", () => {
    const result = validateUploadFile(
      { name: "fake.png", mimeType: "image/png", bytes: fakePngBytesCorrupted() },
      svgHashes,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("CORRUPT_FILE")
      expect(result.message).toContain("损坏")
    }
  })

  it("超过 10MB 的文件被拒绝", () => {
    const result = validateUploadFile(
      { name: "big.jpg", mimeType: "image/jpeg", bytes: new Uint8Array(10 * 1024 * 1024 + 1) },
      svgHashes,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("FILE_TOO_LARGE")
  })

  it("未知内容的 SVG 被拒绝（仅内置演示样例放行）", () => {
    const randomSvg = new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'))
    const result = validateUploadFile({ name: "evil.svg", mimeType: "image/svg+xml", bytes: randomSvg }, svgHashes)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("UNSUPPORTED_TYPE")
  })

  it("内置演示样例 SVG 通过（按内容哈希白名单）", () => {
    const sample = readSampleFile("box-unicorn-demo.svg")
    const result = validateUploadFile({ name: sample.name, mimeType: sample.mimeType, bytes: sample.bytes }, svgHashes)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.kind).toBe("svg")
  })

  it("常规 JPEG 通过校验", () => {
    const result = validateUploadFile({ name: "box.jpg", mimeType: "image/jpeg", bytes: fakeJpegBytes() }, svgHashes)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.kind).toBe("jpeg")
  })
})

describe("制作状态约束（PRD §7）", () => {
  it("BUILDING 进度必须为 1–99%", () => {
    expect(validateBuildProgress("BUILDING", 0).ok).toBe(false)
    expect(validateBuildProgress("BUILDING", 100).ok).toBe(false)
    expect(validateBuildProgress("BUILDING", 1).ok).toBe(true)
    expect(validateBuildProgress("BUILDING", 99).ok).toBe(true)
    expect(validateBuildProgress("BUILDING", 65).ok).toBe(true)
  })

  it("COMPLETED 必须为 100%，NOT_APPLICABLE 必须为 0%", () => {
    expect(validateBuildProgress("COMPLETED", 99).ok).toBe(false)
    expect(validateBuildProgress("COMPLETED", 100).ok).toBe(true)
    expect(validateBuildProgress("NOT_APPLICABLE", 30).ok).toBe(false)
    expect(validateBuildProgress("NOT_APPLICABLE", 0).ok).toBe(true)
  })

  it("UNOPENED/OPENED 允许 0–100", () => {
    expect(validateBuildProgress("UNOPENED", 0).ok).toBe(true)
    expect(validateBuildProgress("OPENED", 50).ok).toBe(true)
    expect(validateBuildProgress("UNOPENED", 101).ok).toBe(false)
  })
})

describe("确认入库输入校验", () => {
  it("目录商品与自定义商品必须二选一", () => {
    const result = confirmAssetSchema.safeParse({
      idempotencyKey: "key-12345678",
      buildState: "UNOPENED",
      progress: 0,
    })
    expect(result.success).toBe(false)
  })

  it("合法目录商品输入通过", () => {
    const result = confirmAssetSchema.safeParse({
      idempotencyKey: "key-12345678",
      productId: "P03",
      dispositionState: "ACTIVE",
      buildState: "BUILDING",
      progress: 40,
      purchasePriceMinor: 120000,
      purchasedAt: "2026-08-01",
    })
    expect(result.success).toBe(true)
  })

  it("非法日期格式被拒绝", () => {
    expect(() => parseIsoDateToUtc("2026/08/01")).toThrow()
    expect(parseIsoDateToUtc("2026-08-01")?.toISOString()).toContain("2026-07-31T16:00:00.000Z")
    expect(parseIsoDateToUtc(null)).toBeNull()
  })
})
