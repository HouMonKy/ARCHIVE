import { describe, expect, it, beforeAll } from "vitest"
import { getTestDb, resetTestDb } from "../helpers/db"
import { listCatalogWithOwnedCounts } from "@/lib/services/catalog"
import { validateUploadFile } from "@/lib/validation"
import { getKnownDemoSampleHashes } from "@/lib/ai/fixture"
import { deflateSync } from "node:zlib"
import { readSampleFile } from "../helpers/files"

/** PNG CRC32（测试侧自实现，避免依赖被测实现） */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: number[]): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: number[]): number[] {
  const len = data.length
  const typeBytes = [...type].map((ch) => ch.charCodeAt(0))
  const crc = crc32([...typeBytes, ...data])
  return [
    (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff,
    ...typeBytes,
    ...data,
    (crc >>> 24) & 0xff, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff,
  ]
}

function makeValidPng(): Uint8Array {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const ihdr = pngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])
  const raw = new Uint8Array([0, 10, 20, 30])
  const idat = pngChunk("IDAT", Array.from(deflateSync(raw)))
  const iend = pngChunk("IEND", [])
  return new Uint8Array([...signature, ...ihdr, ...idat, ...iend])
}

/** 结构完整的 JPEG（SOI + APP0 + SOF0 + SOS + 熵 + EOI） */
function makeValidJpeg(): Uint8Array {
  const parts: number[] = [0xff, 0xd8]
  parts.push(0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00)
  parts.push(0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00)
  parts.push(0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00)
  parts.push(0x12, 0x34, 0x56) // 熵数据
  parts.push(0xff, 0xd9)
  return new Uint8Array(parts)
}

/** 结构完整的 WebP（RIFF + WEBP + VP8L chunk） */
function makeValidWebp(): Uint8Array {
  const payload = [0x2f, 0x00, 0x00, 0x00, 0x00, 0x00] // signature + 32bit header + transform-present=0
  const riffSize = 4 + 8 + payload.length
  const bytes = [
    0x52, 0x49, 0x46, 0x46,
    riffSize & 0xff, (riffSize >>> 8) & 0xff, (riffSize >>> 16) & 0xff, (riffSize >>> 24) & 0xff,
    0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x4c, // "VP8L"
    payload.length & 0xff, (payload.length >>> 8) & 0xff, (payload.length >>> 16) & 0xff, (payload.length >>> 24) & 0xff,
    ...payload,
  ]
  return new Uint8Array(bytes)
}

describe("目录数据正确性（返工：P02 发布年）", () => {
  beforeAll(async () => {
    await resetTestDb()
  })

  it("P02 MG Zeta Gundam Ver.Ka 的发布年为 2023（官方 gundam-official.com/feature/mgka/zeta/）", async () => {
    const catalog = await listCatalogWithOwnedCounts(getTestDb(), "kai")
    const p02 = catalog.find((c) => c.id === "P02")
    expect(p02?.canonicalName).toBe("MG Zeta Gundam Ver.Ka")
    expect(p02?.releaseYear).toBe(2023)
  })
})

describe("图片结构完整性校验（返工：不能只认 magic number）", () => {
  const svgHashes = getKnownDemoSampleHashes()

  it("伪 JPEG（合法文件头 + 全零内容）返回 CORRUPT_FILE", () => {
    const fake = new Uint8Array(1024)
    fake.set([0xff, 0xd8, 0xff], 0)
    const result = validateUploadFile({ name: "fake.jpg", mimeType: "image/jpeg", bytes: fake }, svgHashes)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("CORRUPT_FILE")
  })

  it("截断 JPEG（有头有段但无 SOS/EOI）返回 CORRUPT_FILE", () => {
    const parts: number[] = [0xff, 0xd8]
    parts.push(0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00)
  parts.push(0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00)
    const result = validateUploadFile({ name: "cut.jpg", mimeType: "image/jpeg", bytes: new Uint8Array(parts) }, svgHashes)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("CORRUPT_FILE")
  })

  it("伪造长度的 PNG（chunk 长度越界）返回 CORRUPT_FILE", () => {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    // IHDR 声称长度 0x7FFFFFFF，实际只有 13 字节数据
    const forged = [
      ...signature,
      0x7f, 0xff, 0xff, 0xff,
      0x49, 0x48, 0x44, 0x52,
      0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0,
      0, 0, 0, 0,
    ]
    const result = validateUploadFile({ name: "forged.png", mimeType: "image/png", bytes: new Uint8Array(forged) }, svgHashes)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("CORRUPT_FILE")
  })

  it("截断 PNG（无 IEND）返回 CORRUPT_FILE", () => {
    const full = makeValidPng()
    const truncated = full.slice(0, full.length - 12) // 去掉 IEND
    const result = validateUploadFile({ name: "cut.png", mimeType: "image/png", bytes: truncated }, svgHashes)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("CORRUPT_FILE")
  })

  it("仅 IHDR + IEND、无 IDAT 图像数据的伪 PNG 返回 CORRUPT_FILE（W3C 要求至少一个 IDAT）", () => {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    const ihdr = pngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])
    const iend = pngChunk("IEND", [])
    const fake = new Uint8Array([...signature, ...ihdr, ...iend])
    expect(fake.length).toBe(45) // 与暗查样本一致：8 + 25 + 12
    const result = validateUploadFile({ name: "no-idat.png", mimeType: "image/png", bytes: fake }, svgHashes)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("CORRUPT_FILE")
  })

  it("零长度 IDAT（无任何图像数据）返回 CORRUPT_FILE", () => {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    const ihdr = pngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])
    const emptyIdat = pngChunk("IDAT", [])
    const iend = pngChunk("IEND", [])
    const fake = new Uint8Array([...signature, ...ihdr, ...emptyIdat, ...iend])
    const result = validateUploadFile({ name: "empty-idat.png", mimeType: "image/png", bytes: fake }, svgHashes)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("CORRUPT_FILE")
  })

  it("CRC 损坏的 PNG（内容与格式不符）返回 CORRUPT_FILE", () => {
    const full = makeValidPng()
    const corrupted = new Uint8Array(full)
    corrupted[full.length - 2] ^= 0xff // 破坏 IEND 的 CRC
    const result = validateUploadFile({ name: "badcrc.png", mimeType: "image/png", bytes: corrupted }, svgHashes)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("CORRUPT_FILE")
  })

  it("伪造 WebP（RIFF size 与实际不符）返回 CORRUPT_FILE", () => {
    const bytes = new Uint8Array(makeValidWebp())
    bytes[7] += 1 // RIFF size 比实际内容大
    const result = validateUploadFile({ name: "fake.webp", mimeType: "image/webp", bytes }, svgHashes)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("CORRUPT_FILE")
  })

  it("结构完整的 JPEG / PNG / WebP 通过校验（不误杀）", () => {
    for (const [name, bytes] of [
      ["valid.jpg", makeValidJpeg()],
      ["valid.png", makeValidPng()],
      ["valid.webp", makeValidWebp()],
    ] as const) {
      const result = validateUploadFile({ name, mimeType: "application/octet-stream", bytes: bytes as Uint8Array }, svgHashes)
      expect(result.ok, name).toBe(true)
    }
  })

  it("内置演示样例 SVG 仍按内容哈希白名单放行", () => {
    const sample = readSampleFile("box-unicorn-demo.svg")
    const result = validateUploadFile({ name: sample.name, mimeType: sample.mimeType, bytes: sample.bytes }, svgHashes)
    expect(result.ok).toBe(true)
  })
})
