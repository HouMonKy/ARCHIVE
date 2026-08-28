import { describe, expect, it, beforeAll, afterAll } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

/**
 * 官网图伺服路由回归（/api/demo-images/[code]）：
 * - 白名单含下划线：bandai-item-01_4230 / bandai-01_6681 等合法 Bandai ID 不被 404；
 * - 路径穿越防护：../evil、a/b、a\b、a..b、URL 编码形态全部 404；
 * - 精确文件名匹配：不做前缀误配（bandai-item-01_4 不得命中 bandai-item-01_4230.jpg）；
 * - 缓存命中：200 + Content-Type + X-Image-Provenance: local-private-cache + 字节一致；
 * - 未命中（合法 ID）：fallback SVG（不破图）。
 */

const REAL_CACHE = path.resolve(process.cwd(), "private-assets", "product-images")
let tmpCache: string

// 路由模块读的是编译期常量 CACHE_DIR（process.cwd() 解析），无法注入。
// 这里通过 chdir 到临时工作区让 CACHE_DIR 指向受控目录：
// 构造 <tmp>/private-assets/product-images + <tmp>/public/demo/fallback.svg。
let originalCwd: string

beforeAll(async () => {
  originalCwd = process.cwd()
  tmpCache = mkdtempSync(path.join(tmpdir(), "demo-images-route-"))
  mkdirSync(path.join(tmpCache, "private-assets", "product-images"), { recursive: true })
  mkdirSync(path.join(tmpCache, "public", "demo"), { recursive: true })
  const fallbackSrc = path.resolve(originalCwd, "public/demo/fallback.svg")
  if (existsSync(fallbackSrc)) copyFileSync(fallbackSrc, path.join(tmpCache, "public/demo/fallback.svg"))
  process.chdir(tmpCache)
  // 延迟 import：路由模块在模块加载期解析 CACHE_DIR/FALLBACK（相对 chdir 后的 cwd）
  await import("@/app/api/demo-images/[code]/route")
})

afterAll(() => {
  process.chdir(originalCwd)
  rmSync(tmpCache, { recursive: true, force: true })
})

async function GET(code: string): Promise<Response> {
  // vitest 模块缓存：chdir 后首次 import 已完成，直接复用（route 模块的 CACHE_DIR 已指向 tmpCache）
  const mod = await import("@/app/api/demo-images/[code]/route")
  return mod.GET(new Request(`http://127.0.0.1:3000/api/demo-images/${code}`), {
    params: Promise.resolve({ code }),
  })
}

function putCache(fileName: string, bytes: Buffer): void {
  writeFileSync(path.join(tmpCache, "private-assets", "product-images", fileName), bytes)
}

describe("官网图伺服路由：白名单与精确匹配", () => {
  it("bandai-item-01_4230 合法：缓存命中返回 200 + image/jpeg + provenance + 字节一致", async () => {
    // 真实缓存字节（不修改真实缓存，只读复制到受控目录）
    const real = path.join(REAL_CACHE, "bandai-item-01_4230.jpg")
    if (!existsSync(real)) throw new Error("前置条件缺失：真实缓存 bandai-item-01_4230.jpg 不存在")
    const bytes = readFileSync(real)
    putCache("bandai-item-01_4230.jpg", bytes)
    const res = await GET("bandai-item-01_4230")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/jpeg")
    expect(res.headers.get("x-image-provenance")).toBe("local-private-cache")
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.byteLength).toBe(bytes.byteLength)
    expect(body.equals(bytes)).toBe(true)
  })

  it("bandai-01_6681 同样不被白名单拒绝（下划线 ID）", async () => {
    putCache("bandai-01_6681.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))
    const res = await GET("bandai-01_6681")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/jpeg")
    expect(res.headers.get("x-image-provenance")).toBe("local-private-cache")
  })

  it("精确文件名匹配：前缀相近的其他商品不被误配", async () => {
    putCache("bandai-item-01_4230.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]))
    // bandai-item-01_4 是合法形态但无同名缓存文件 → fallback（不得命中 01_4230.jpg）
    const res = await GET("bandai-item-01_4")
    expect(res.status).toBe(200)
    expect(res.headers.get("x-image-provenance")).toBe("fallback")
    expect(res.headers.get("content-type")).toBe("image/svg+xml")
  })

  it("多扩展名精确尝试：.png 候选按顺序命中", async () => {
    putCache("lego-test-99999.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]))
    const res = await GET("lego-test-99999")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/png")
    expect(res.headers.get("x-image-provenance")).toBe("local-private-cache")
  })

  it("不存在的合法商品 ID：返回 fallback SVG（不破图）", async () => {
    const res = await GET("bandai-item-99_0000")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/svg+xml")
    expect(res.headers.get("x-image-provenance")).toBe("fallback")
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.byteLength).toBeGreaterThan(0)
  })

  it("路径穿越与非法形态全部 404", async () => {
    // Next.js 动态段会把 %2F 解码为 / 并在路由层 404；这里直调 handler 验证白名单同样拒绝
    const badCodes = ["../evil", "a/b", "a\\b", "a..b", "..", ".", "a/b/../c", "code.js", "a b", "a%2Fb", "bandai-item-01_4230.jpg", "x".repeat(65)]
    for (const code of badCodes) {
      const res = await GET(code)
      expect(res.status, `code=${JSON.stringify(code)} 应 404`).toBe(404)
    }
  })

  it("超长但合法形态的 code（65 字符）被拒绝；64 字符仍在限内", async () => {
    expect((await GET("x".repeat(65))).status).toBe(404)
    // 64 字符合法形态：无缓存 → fallback（证明通过白名单，而非 404）
    const res = await GET("y".repeat(64))
    expect(res.status).toBe(200)
    expect(res.headers.get("x-image-provenance")).toBe("fallback")
  })
})
