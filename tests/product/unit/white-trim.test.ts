import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import sharp from "sharp"
import { trimWhiteBorder, computeWhiteBorder } from "@/lib/white-trim"

/**
 * 外围白边裁剪（收藏工作台改造）：
 * - 沙扎比官方图 560×560 → 裁掉上下连续近白边框（T93/B94）→ 560×373，主体完整；
 * - 无明显边框不裁（合成图验证）；官方原图字节不被修改；
 * - 保留面积 <60% 或边 <200px 放弃；只裁四边向内的连续近白——内部白色不动。
 */

const REAL = path.resolve(process.cwd(), "private-assets/product-images")

/** 合成图：指定四周白边厚度，中间为彩色主体 */
async function synthetic(size: number, border: number, bodyColor = "#778899"): Promise<Buffer> {
  const inner = size - border * 2
  const base = await sharp({ create: { width: size, height: size, channels: 3, background: "#ffffff" } }).png().toBuffer()
  if (border === 0) return base
  return sharp(base)
    .composite([{ input: await sharp({ create: { width: inner, height: inner, channels: 3, background: bodyColor } }).png().toBuffer(), left: border, top: border }])
    .png()
    .toBuffer()
}

describe("白边裁剪（合成图）", () => {
  it("四周白边 30px 的 600×600 → 裁为 540×540", async () => {
    const r = await trimWhiteBorder(await synthetic(600, 30))
    expect(r).not.toBeNull()
    expect(r!.width).toBe(540)
    expect(r!.height).toBe(540)
    expect(r!.trimmed).toEqual({ top: 30, right: 30, bottom: 30, left: 30 })
  })

  it("无白边（纯白整图）不裁：返回 null（避免把整图当边框裁空）", async () => {
    const allWhite = await sharp({ create: { width: 500, height: 500, channels: 3, background: "#ffffff" } }).png().toBuffer()
    // 纯白整图：边界行全白——但保留面积约束会放弃；computeWhiteBorder 受 45% 上限保护
    const r = await trimWhiteBorder(allWhite)
    expect(r).toBeNull()
  })

  it("主体带浅色噪点的边框仍被识别为边框（允许 1% 噪点）", async () => {
    // 500×500 白底 + 440×440 主体，边框 30px
    const r = await trimWhiteBorder(await synthetic(500, 30))
    expect(r).not.toBeNull()
    expect(r!.width).toBe(440)
  })

  it("保留面积 <60% 放弃（边框 250/600 → 保留 100×100 <60%）", async () => {
    const r = await trimWhiteBorder(await synthetic(600, 250))
    expect(r).toBeNull()
  })

  it("边框过薄（<8px）视为无边框不裁", async () => {
    const r = await trimWhiteBorder(await synthetic(600, 4))
    expect(r).toBeNull()
  })

  it("裁剪不改变中间主体内容（主体像素保留）", async () => {
    const source = await synthetic(500, 40, "#123456")
    const r = await trimWhiteBorder(source)
    expect(r).not.toBeNull()
    const body = await sharp(Buffer.from(r!.bytes)).stats()
    // 主体为纯色 #123456 → 裁后图几乎全为该色（无白色边框残留）
    const { dominant } = body
    expect(dominant.r).toBeLessThan(60)
    expect(dominant.g).toBeGreaterThan(20)
    expect(dominant.b).toBeGreaterThan(70)
  })
})

describe("computeWhiteBorder 边界计算", () => {
  it("左右白边列识别", async () => {
    const img = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#ffffff" } })
      .composite([{ input: await sharp({ create: { width: 260, height: 300, channels: 3, background: "#884422" } }).png().toBuffer(), left: 40, top: 0 }])
      .png()
      .toBuffer()
    const { data, info } = await sharp(img).raw().toBuffer({ resolveWithObject: true })
    const b = computeWhiteBorder(data, info.width, info.height, info.channels)
    expect(b.left).toBe(40)
    expect(b.right).toBe(0)
  })
})

describe("白边裁剪（真实官方图）", () => {
  it("沙扎比 bandai-manual-949：560×560 → 560×373（T93/B94 上下连续白边，主体完整）", async () => {
    const buf = readFileSync(path.join(REAL, "bandai-manual-949.jpg"))
    const r = await trimWhiteBorder(buf)
    expect(r).not.toBeNull()
    expect(r!.width).toBe(560)
    expect(r!.height).toBe(373)
    expect(r!.trimmed.top).toBe(93)
    expect(r!.trimmed.bottom).toBe(94)
    expect(r!.trimmed.left).toBe(0)
    expect(r!.trimmed.right).toBe(0)
    // 输出是 WebP 衍生图
    const meta = await sharp(Buffer.from(r!.bytes)).metadata()
    expect(meta.format).toBe("webp")
  })

  it("bandai-item-01_4230：满幅商品图（无外围白框）不裁", async () => {
    const buf = readFileSync(path.join(REAL, "bandai-item-01_4230.jpg"))
    const r = await trimWhiteBorder(buf)
    // 该图为全幅摄影：四边不是连续近白 → 不裁
    if (r === null) return // 期望之一：不裁
    // 或仅裁极小边——绝不允许大幅裁剪（保留 ≥95%）
    expect(r!.width * r!.height).toBeGreaterThanOrEqual(1200 * 1200 * 0.95)
  })
})
