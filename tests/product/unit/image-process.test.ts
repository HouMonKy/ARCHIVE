import { describe, expect, it } from "vitest"
import sharp from "sharp"
import { processUserImage, normalizeUserRotation } from "@/lib/image-process"

/**
 * 照片处理管线（返工轮任务 2）：EXIF 方向修正 + 用户旋转 + 压缩。
 * 用 sharp withMetadata({orientation}) 生成带 EXIF Orientation 的真实 JPEG 验证端到端行为。
 */

async function jpegWithExifOrientation(orientation: number, width = 320, height = 200): Promise<Buffer> {
  // 4x3 纯色测试图（sharp 写出合法 EXIF；验证读取→自动转正链路）
  return sharp({
    create: { width, height, channels: 3, background: { r: 240, g: 240, b: 240 } },
  })
    .composite([
      { input: Buffer.from(`<svg width='${width / 2}' height='${height}' xmlns='http://www.w3.org/2000/svg'><rect width='100%' height='100%' fill='rgb(220,30,30)'/></svg>`), left: 0, top: 0 },
      { input: Buffer.from(`<svg width='${width / 2}' height='${height}' xmlns='http://www.w3.org/2000/svg'><rect width='100%' height='100%' fill='rgb(30,30,220)'/></svg>`), left: width / 2, top: 0 },
    ])
    .withMetadata({ orientation })
    .jpeg({ quality: 90 })
    .toBuffer()
}

describe("照片处理（EXIF 修正 + 旋转 + 压缩）", () => {
  it("无 EXIF 的 JPEG：直通处理为 JPEG 且保持几何", async () => {
    const src = await sharp({ create: { width: 320, height: 200, channels: 3, background: "#dddddd" } })
      .jpeg()
      .toBuffer()
    const out = await processUserImage(new Uint8Array(src))
    expect(out.mimeType).toBe("image/jpeg")
    expect(out.width).toBe(320)
    expect(out.height).toBe(200)
    expect(out.bytes.byteLength).toBeGreaterThan(0)
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it("EXIF Orientation=6：自动转正（宽高互换）", async () => {
    const src = await jpegWithExifOrientation(6)
    const out = await processUserImage(new Uint8Array(src))
    expect(out.width).toBe(200)
    expect(out.height).toBe(320)
  })

  it("用户旋转 90°：在 EXIF 转正基础上再旋转（宽高互换）", async () => {
    const src = await jpegWithExifOrientation(1, 320, 200)
    const out = await processUserImage(new Uint8Array(src), 90)
    expect(out.width).toBe(200)
    expect(out.height).toBe(320)
  })

  it("大图压缩：最长边 ≤1600 且不放大小图", async () => {
    const big = await sharp({ create: { width: 3200, height: 1800, channels: 3, background: "#cccccc" } })
      .jpeg({ quality: 95 })
      .toBuffer()
    const bigOut = await processUserImage(new Uint8Array(big))
    expect(bigOut.width).toBe(1600)
    expect(bigOut.height).toBe(900)
    expect(bigOut.bytes.byteLength).toBeLessThan(big.byteLength)

    const small = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#cccccc" } })
      .jpeg()
      .toBuffer()
    const smallOut = await processUserImage(new Uint8Array(small))
    expect(smallOut.width).toBe(300)
    expect(smallOut.height).toBe(200)
  })

  it("PNG 输入（RGBA）：统一输出 JPEG", async () => {
    const png = await sharp({ create: { width: 240, height: 160, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } })
      .png()
      .toBuffer()
    const out = await processUserImage(new Uint8Array(png))
    expect(out.mimeType).toBe("image/jpeg")
    expect(out.width).toBe(240)
    const meta = await sharp(out.bytes).metadata()
    expect(meta.format).toBe("jpeg")
  })

  it("旋转角度归一化：非法值回退 0，合法值原样接受", () => {
    expect(normalizeUserRotation(90)).toBe(90)
    expect(normalizeUserRotation("180")).toBe(180)
    expect(normalizeUserRotation(45)).toBe(0)
    expect(normalizeUserRotation(undefined)).toBe(0)
    expect(normalizeUserRotation("abc")).toBe(0)
  })

  it("输出不含 EXIF 方向（重编码后方向已烘焙进像素）", async () => {
    const src = await jpegWithExifOrientation(6)
    const out = await processUserImage(new Uint8Array(src))
    const meta = await sharp(out.bytes).metadata()
    expect(meta.orientation).toBeUndefined()
  })
})
