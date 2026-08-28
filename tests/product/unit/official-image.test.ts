import { describe, expect, it, beforeAll, afterAll } from "vitest"
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import sharp from "sharp"
import {
  officialImageHostCheck,
  sniffImageBytes,
  cacheOfficialImage,
  fetchOfficialImage,
  type OfficialImageResult,
} from "@/lib/services/official-image"

/**
 * 官网原图校验（官网资料闭环）：
 * - 域名白名单：仅 Bandai/Bandai Hobby/LEGO 官方域名与官方 CDN；第三方一律拒绝；
 * - 魔数探测：HTML/403 页面绝不能当图片（Content-Type 也不可信）；
 * - 尺寸/大小校验；缓存写入与旧扩展清理。
 */

let tmpDir: string

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "official-image-"))
  process.env.OFFICIAL_IMAGES_DIR = tmpDir
})

afterAll(() => {
  delete process.env.OFFICIAL_IMAGES_DIR
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("官方图片域名白名单", () => {
  it("接受 Bandai / Bandai Hobby / LEGO 官方域名与官方 CDN", () => {
    expect(officialImageHostCheck("https://bandai-hobby.net/images/x.jpg").ok).toBe(true)
    expect(officialImageHostCheck("https://manual.bandai-hobby.net/images/y.jpg").ok).toBe(true)
    expect(officialImageHostCheck("https://d3bk8pkqsprcvh.cloudfront.net/hobby/jp/product/z.jpeg").ok).toBe(true)
    expect(officialImageHostCheck("https://www.lego.com/cdn/product-assets/product.img.pri/42172_Prod.png").ok).toBe(true)
  })

  it("拒绝第三方图床与协议（Rebrickable/HobbySearch/HTTP 等）", () => {
    expect(officialImageHostCheck("https://cdn.rebrickable.com/media/sets/42172-1.jpg")).toMatchObject({ ok: false, reason: "BANNED_THIRD_PARTY_HOST" })
    expect(officialImageHostCheck("https://www.1999.co.jp/image/x.jpg")).toMatchObject({ ok: false })
    expect(officialImageHostCheck("https://hobbysearch.co.jp/image/x.jpg")).toMatchObject({ ok: false })
    expect(officialImageHostCheck("https://example.com/x.jpg")).toMatchObject({ ok: false, reason: "NOT_OFFICIAL_HOST" })
    expect(officialImageHostCheck("http://bandai-hobby.net/x.jpg")).toMatchObject({ ok: false, reason: "NOT_HTTPS" })
    expect(officialImageHostCheck("not-a-url")).toMatchObject({ ok: false, reason: "INVALID_URL" })
  })
})

describe("魔数探测", () => {
  it("JPEG/PNG/WebP 与非图片", () => {
    expect(sniffImageBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg")
    expect(sniffImageBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png")
    expect(sniffImageBytes(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]))).toBe("webp")
    expect(sniffImageBytes(new TextEncoder().encode("<html>403</html>"))).toBe("unknown")
  })
})

describe("fetchOfficialImage 校验链", () => {
  it("HTML 响应（403 页面）即使伪造 image/* 头也拒绝（魔数校验）", async () => {
    const html = "<html><body>Just a moment...</body></html>"
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(html, { status: 200, headers: { "content-type": "image/jpeg" } })) as typeof fetch
    try {
      const result = await fetchOfficialImage("https://bandai-hobby.net/images/fake.jpg")
      expect(result.status).toBe("FAILED")
      expect(result.reason).toBe("NOT_IMAGE_MAGIC_BYTES")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("非 200 / 非 image Content-Type 拒绝", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response("nope", { status: 403, headers: { "content-type": "text/html" } })) as typeof fetch
    try {
      const r1 = await fetchOfficialImage("https://www.lego.com/cdn/product-assets/x.png")
      expect(r1.status).toBe("FAILED")
      expect(r1.reason).toBe("HTTP_403")
      globalThis.fetch = (async () => new Response("nope", { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch
      const r2 = await fetchOfficialImage("https://www.lego.com/cdn/product-assets/x.png")
      expect(r2.status).toBe("FAILED")
      expect(r2.reason).toContain("CONTENT_TYPE")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("真实图片字节通过校验（sharp 解码尺寸 + SHA-256）", async () => {
    // 本地生成 600×400 JPEG（非任何官方素材；只验证校验链逻辑）
    const bytes = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#336699" } }).jpeg().toBuffer()
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "image/jpeg" } })) as typeof fetch
    try {
      const result = await fetchOfficialImage("https://bandai-hobby.net/images/test-ok.jpg")
      expect(result.status).toBe("OK")
      expect(result.width).toBe(600)
      expect(result.height).toBe(400)
      expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(result.ext).toBe("jpg")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("尺寸过小拒绝（如 150×150 占位图）", async () => {
    // 加噪声确保字节数 > 1KB（先过大小校验，专门检验尺寸校验：宽 280 < 300）
    const noise = Buffer.alloc(280 * 160 * 3)
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919) % 256
    const bytes = await sharp(noise, { raw: { width: 280, height: 160, channels: 3 } }).jpeg().toBuffer()
    expect(bytes.byteLength).toBeGreaterThan(1024)
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "image/jpeg" } })) as typeof fetch
    try {
      const result = await fetchOfficialImage("https://bandai-hobby.net/images/tiny.jpg")
      expect(result.status).toBe("FAILED")
      expect(result.reason).toBe("DIMENSION_TOO_SMALL")
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe("缓存写入", () => {
  it("写入 {productId}.{ext} 并清理旧扩展名文件（Rebrickable .jpg → 官方 .png）", () => {
    const productId = "lego-42172"
    // 旧 Rebrickable 时代缓存（.jpg）
    writeFileSync(path.join(tmpDir, `${productId}.jpg`), Buffer.from("old-rebrickable-bytes"))
    const image: OfficialImageResult = {
      status: "OK",
      url: "https://www.lego.com/cdn/product-assets/product.img.pri/42172_Prod.png",
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]),
      mime: "image/png",
      ext: "png",
      sha256: "a".repeat(64),
      width: 500,
      height: 280,
      reason: null,
    }
    const cached = cacheOfficialImage(productId, image)
    expect("skipped" in cached).toBe(false)
    expect(existsSync(path.join(tmpDir, `${productId}.png`))).toBe(true)
    // 旧 .jpg 被清理：缓存目录该商品只留官方 .png
    expect(existsSync(path.join(tmpDir, `${productId}.jpg`))).toBe(false)
    expect(readFileSync(path.join(tmpDir, `${productId}.png`)).byteLength).toBe(16)
  })

  it("非 OK 结果不得缓存", () => {
    expect(() =>
      cacheOfficialImage("x", {
        status: "FAILED",
        url: "https://bandai-hobby.net/x.jpg",
        bytes: null,
        mime: null,
        ext: null,
        sha256: null,
        width: null,
        height: null,
        reason: "HTTP_403",
      }),
    ).toThrow()
  })
})
