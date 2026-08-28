import { describe, expect, it, vi, afterEach, beforeAll, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import sharp from "sharp"
import { getTestDb, resetTestDb } from "../../helpers/db"
import {
  extractBandaiCnMainImage,
  isValidBandaiCnImageUrl,
  resolveLegoMainImage,
  resolveReleaseMainImage,
  syncReleaseImage,
  backfillReleaseImages,
} from "@/lib/services/release-image-sync"

/**
 * 新品官方主图解析与补全（release-image-sync）：
 * - LEGO：套装编号 → lego.com 官方 CDN 标准地址；
 * - Bandai 中国官网：只从 .pg-products__sliderMain 主轮播首图提取（页面 Logo 干扰排除）；
 * - 图片 URL 校验：HTTPS + exact host staticcdn.bandaihobbysite.cn + 无凭据/端口；
 * - 页面请求边界（超时/状态码/Content-Type/体积）；HTML 冒充图片 → FAILED 无缓存；
 * - 下载走完整校验链（200+image/*+魔数+尺寸+SHA）并落全部图片元数据；
 * - 历史 PENDING/null 补全（近 30 天窗口）；OK 且缓存 SHA 有效跳过；
 * - 失败写 FAILED 不动旧缓存。
 * HTTP 边界 mock 响应；解析、校验、缓存、数据库更新全部真实执行。
 */

const FIXTURES = path.resolve(process.cwd(), "tests/product/fixtures")
const BANDAI_CN_HTML = readFileSync(path.join(FIXTURES, "bandai-cn-detail-3425.html"), "utf-8")

let imagesDir: string

beforeAll(async () => {
  imagesDir = mkdtempSync(path.join(tmpdir(), "release-image-sync-"))
  process.env.OFFICIAL_IMAGES_DIR = imagesDir
  await resetTestDb()
})

afterAll(() => {
  delete process.env.OFFICIAL_IMAGES_DIR
  rmSync(imagesDir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 真实 PNG 字节（本地生成，非官方素材；仅驱动校验链） */
async function pngBytes(width = 500, height = 300): Promise<Uint8Array> {
  const buf = await sharp({ create: { width, height, channels: 3, background: "#556677" } }).png().toBuffer()
  return new Uint8Array(buf)
}

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => handler(String(input))),
  )
}

describe("LEGO 主图解析", () => {
  it("套装编号 → lego.com 官方 CDN 标准地址", () => {
    const r = resolveLegoMainImage("10337")
    expect(r.status).toBe("RESOLVED")
    expect(r.imageUrl).toBe("https://www.lego.com/cdn/product-assets/product.img.pri/10337_Prod.png")
  })

  it("非法编号拒绝", () => {
    expect(resolveLegoMainImage("abc").status).toBe("FAILED")
    expect(resolveLegoMainImage("").status).toBe("FAILED")
  })
})

describe("Bandai 中国官网图片 URL 校验", () => {
  it("HTTPS + exact host staticcdn.bandaihobbysite.cn 通过", () => {
    expect(isValidBandaiCnImageUrl("https://staticcdn.bandaihobbysite.cn/www/uploads/x.jpg")).toBe(true)
  })

  it("HTTP/端口/凭据/其他域名/子域全部拒绝（恶意域名）", () => {
    expect(isValidBandaiCnImageUrl("http://staticcdn.bandaihobbysite.cn/x.jpg")).toBe(false)
    expect(isValidBandaiCnImageUrl("https://staticcdn.bandaihobbysite.cn:8443/x.jpg")).toBe(false)
    expect(isValidBandaiCnImageUrl("https://user:pass@staticcdn.bandaihobbysite.cn/x.jpg")).toBe(false)
    expect(isValidBandaiCnImageUrl("https://evil.example.com/x.jpg")).toBe(false)
    expect(isValidBandaiCnImageUrl("https://fake.staticcdn.bandaihobbysite.cn.evil.com/x.jpg")).toBe(false)
    expect(isValidBandaiCnImageUrl("https://cdn.bandaihobbysite.cn/x.jpg")).toBe(false)
    expect(isValidBandaiCnImageUrl("not-a-url")).toBe(false)
  })
})

describe("Bandai 中国官网主轮播提取（真实页面快照）", () => {
  it("提取 .pg-products__sliderMain 首图（uploads 主图，非页面 Logo）", () => {
    const url = extractBandaiCnMainImage(BANDAI_CN_HTML)
    expect(url).toBeTruthy()
    expect(url).toMatch(/^https:\/\/staticcdn\.bandaihobbysite\.cn\/www\/uploads\//)
    // 页面第一张图是 Logo（cmn/img/apple-touch-icon）——不得取它
    expect(url).not.toContain("/cmn/")
    expect(url).not.toContain("apple-touch-icon")
  })

  it("无 sliderMain 容器 / 首图域名非法 → null", () => {
    expect(extractBandaiCnMainImage("<html><body><img src='https://staticcdn.bandaihobbysite.cn/x.jpg'></body></html>")).toBeNull()
    // 容器内首图为恶意域名 → 拒绝（不从第三方取图）
    const evil = '<div class="js-swiper__main pg-products__sliderMain"><div class="swiper-wrapper"><a class="swiper-slide"><img src="https://evil.example.com/main.jpg" alt="x"></a></div></div>'
    expect(extractBandaiCnMainImage(evil)).toBeNull()
  })
})

describe("resolveReleaseMainImage（页面请求边界）", () => {
  it("Bandai：请求详情页并解析主图", async () => {
    stubFetch((url) => {
      if (url.includes("bandaihobbysite.cn/index/index/detail/id/3425")) {
        return new Response(BANDAI_CN_HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })
      }
      return new Response("nf", { status: 404 })
    })
    const r = await resolveReleaseMainImage({
      brand: "Bandai",
      modelNumber: "MSN-04",
      officialPageUrl: "https://www.bandaihobbysite.cn/index/index/detail/id/3425",
      officialImageUrl: null,
    })
    expect(r.status).toBe("RESOLVED")
    expect(r.imageUrl).toMatch(/^https:\/\/staticcdn\.bandaihobbysite\.cn\/www\/uploads\//)
  })

  it("页面非 200 / 非 HTML / 无主图 → FAILED", async () => {
    stubFetch(() => new Response("err", { status: 503, headers: { "content-type": "text/html" } }))
    const r1 = await resolveReleaseMainImage({ brand: "Bandai", modelNumber: "x", officialPageUrl: "https://www.bandaihobbysite.cn/index/index/detail/id/3425", officialImageUrl: null })
    expect(r1.status).toBe("FAILED")
    expect(r1.reason).toBe("PAGE_HTTP_503")

    stubFetch(() => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }))
    const r2 = await resolveReleaseMainImage({ brand: "Bandai", modelNumber: "x", officialPageUrl: "https://www.bandaihobbysite.cn/index/index/detail/id/3425", officialImageUrl: null })
    expect(r2.status).toBe("FAILED")
    expect(r2.reason).toContain("PAGE_CONTENT_TYPE")

    stubFetch(() => new Response("<html><body>empty</body></html>", { status: 200, headers: { "content-type": "text/html" } }))
    const r3 = await resolveReleaseMainImage({ brand: "Bandai", modelNumber: "x", officialPageUrl: "https://www.bandaihobbysite.cn/index/index/detail/id/3425", officialImageUrl: null })
    expect(r3.status).toBe("FAILED")
    expect(r3.reason).toBe("MAIN_IMAGE_NOT_FOUND")
  })

  it("非 bandaihobbysite.cn 页面 / 无页面 URL → FAILED", async () => {
    const r = await resolveReleaseMainImage({ brand: "Bandai", modelNumber: "x", officialPageUrl: "https://evil.example.com/detail/1", officialImageUrl: null })
    expect(r.status).toBe("FAILED")
    expect(r.reason).toBe("NOT_BANDAI_CN_PAGE")
    const r2 = await resolveReleaseMainImage({ brand: "Bandai", modelNumber: "x", officialPageUrl: null, officialImageUrl: null })
    expect(r2.reason).toBe("NO_PAGE_URL")
  })

  it("已有 officialImageUrl 直接复用（不重复请求页面）", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const r = await resolveReleaseMainImage({ brand: "Bandai", modelNumber: "x", officialPageUrl: "https://www.bandaihobbysite.cn/index/index/detail/id/3425", officialImageUrl: "https://staticcdn.bandaihobbysite.cn/www/uploads/old.jpg" })
    expect(r.status).toBe("RESOLVED")
    expect(r.imageUrl).toBe("https://staticcdn.bandaihobbysite.cn/www/uploads/old.jpg")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

async function seedProduct(db: ReturnType<typeof getTestDb>, overrides: Record<string, unknown> = {}) {
  return db.catalogProduct.create({
    data: {
      id: "lego-99901",
      brand: "LEGO",
      category: "LEGO",
      line: null,
      grade: "ICONS",
      canonicalName: "Test Set（99901）",
      modelNumber: "99901",
      officialPageUrl: "https://www.lego.com/en-us/product/test-set-99901",
      source: "https://www.lego.com/en-us/product/test-set-99901",
      catalogVersion: "official-v1",
      imageStatus: "PENDING",
      ...overrides,
    },
  })
}

describe("syncReleaseImage（下载/缓存/落库全链路，HTTP 边界 mock）", () => {
  it("LEGO PENDING → 解析+下载+缓存：全字段落库 imageStatus=OK", async () => {
    const db = getTestDb()
    await resetTestDb()
    const product = await seedProduct(db)
    const bytes = await pngBytes(500, 210)
    stubFetch((url) => {
      if (url.includes("99901_Prod.png")) {
        return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "image/png" } })
      }
      return new Response("nf", { status: 404 })
    })
    const r = await syncReleaseImage(db, product)
    expect(r.status).toBe("OK")
    expect(r.imageUrl).toBe("https://www.lego.com/cdn/product-assets/product.img.pri/99901_Prod.png")
    const row = await db.catalogProduct.findUniqueOrThrow({ where: { id: "lego-99901" } })
    expect(row.imageStatus).toBe("OK")
    expect(row.officialImageUrl).toBe("https://www.lego.com/cdn/product-assets/product.img.pri/99901_Prod.png")
    expect(row.imageSourcePage).toBe("https://www.lego.com/en-us/product/test-set-99901")
    expect(row.imageSourceUrl).toBe("https://www.lego.com/cdn/product-assets/product.img.pri/99901_Prod.png")
    expect(row.imageCacheFile).toBe("lego-99901.png")
    expect(row.imageSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(row.imageFetchedAt).not.toBeNull()
    expect(row.rightsBasis).toBe("personal-use")
    expect(existsSync(path.join(imagesDir, "lego-99901.png"))).toBe(true)
  })

  it("OK 且缓存 SHA 有效 → 跳过下载（SKIPPED_OK）", async () => {
    const db = getTestDb()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const product = await db.catalogProduct.findUniqueOrThrow({ where: { id: "lego-99901" } })
    const r = await syncReleaseImage(db, product)
    expect(r.status).toBe("SKIPPED_OK")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("HTML 冒充图片（200 + text/html）→ FAILED 无缓存文件、不动旧字段", async () => {
    const db = getTestDb()
    await resetTestDb()
    const product = await seedProduct(db, {
      // 预置上次有效缓存（失败不得删除）
      officialImageUrl: "https://www.lego.com/cdn/product-assets/product.img.pri/99901_Prod.png",
      imageStatus: "FAILED", // 缓存失效（imageStatus≠OK）触发重下
      imageCacheFile: "lego-99901.png",
      imageSha256: "a".repeat(64),
    })
    // 写入旧缓存文件（重下失败后必须保留）
    const { writeFileSync } = await import("node:fs")
    writeFileSync(path.join(imagesDir, "lego-99901.png"), Buffer.from("old-valid-cache"))
    stubFetch((url) => {
      if (url.includes("99901_Prod.png")) {
        return new Response("<html>blocked</html>", { status: 200, headers: { "content-type": "text/html" } })
      }
      return new Response("nf", { status: 404 })
    })
    const r = await syncReleaseImage(db, product)
    expect(r.status).toBe("FAILED")
    expect(r.reason).toContain("CONTENT_TYPE")
    const row = await db.catalogProduct.findUniqueOrThrow({ where: { id: "lego-99901" } })
    expect(row.imageStatus).toBe("FAILED")
    expect(row.imageSha256).toBe("a".repeat(64)) // 旧字段未动
    expect(existsSync(path.join(imagesDir, "lego-99901.png"))).toBe(true) // 旧缓存未删
  })

  it("页面 404（Bandai）→ FAILED 无缓存", async () => {
    const db = getTestDb()
    const product = await seedProduct(db, {
      id: "bandai-cn-99999",
      brand: "Bandai",
      modelNumber: "XYZ",
      officialPageUrl: "https://www.bandaihobbysite.cn/index/index/detail/id/99999",
    })
    stubFetch(() => new Response("nf", { status: 404 }))
    const r = await syncReleaseImage(db, product)
    expect(r.status).toBe("FAILED")
    expect(r.reason).toBe("PAGE_HTTP_404")
    const row = await db.catalogProduct.findUniqueOrThrow({ where: { id: "bandai-cn-99999" } })
    expect(row.imageStatus).toBe("FAILED")
    expect(row.imageCacheFile).toBeNull()
  })
})

describe("backfillReleaseImages（历史 PENDING 补全）", () => {
  it("只补近 30 天事件关联的 PENDING/null 商品；OK 跳过；无事件商品不扫", async () => {
    const db = getTestDb()
    await resetTestDb()
    const now = new Date("2026-08-26T12:00:00+08:00")
    // 两个 PENDING：一个有近期事件、一个无事件
    await seedProduct(db, { id: "lego-99901" })
    await db.releaseEvent.create({
      data: {
        id: "official-live-lego-99901",
        catalogProductId: "lego-99901",
        title: "Test Set 发售",
        announcedAt: new Date("2026-08-20T00:00:00+08:00"),
        sourceUrl: "https://www.lego.com/en-us/categories/new-sets-and-products",
        sourceName: "LEGO 官网新品",
        datasetVersion: "official-v1",
      },
    })
    await seedProduct(db, { id: "lego-99902", modelNumber: "99902" })
    // OK 商品（跳过）
    await seedProduct(db, { id: "lego-99903", modelNumber: "99903", imageStatus: "OK", imageCacheFile: "lego-99903.png", imageSha256: "b".repeat(64) })
    await db.releaseEvent.create({
      data: {
        id: "official-live-lego-99903",
        catalogProductId: "lego-99903",
        title: "OK Set",
        announcedAt: new Date("2026-08-20T00:00:00+08:00"),
        sourceUrl: "https://www.lego.com/en-us/categories/new-sets-and-products",
        sourceName: "LEGO 官网新品",
        datasetVersion: "official-v1",
      },
    })

    const bytes = await pngBytes(500, 300)
    stubFetch((url) => {
      if (url.includes("99901_Prod.png") || url.includes("99903_Prod.png")) {
        return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "image/png" } })
      }
      return new Response("nf", { status: 404 })
    })
    const results = await backfillReleaseImages(db, { now, limit: 50 })
    // 目标两件必被处理：lego-99901（PENDING→OK）+ lego-99903（OK 但缓存 SHA 不匹配→重下 OK）
    // （demo 种子商品 P0x 也在窗口内且无图——mock 404 下如实 FAILED，符合"不伪装 OK"）
    const handled = results.map((r) => r.productId)
    expect(handled).toContain("lego-99901")
    expect(handled).toContain("lego-99903")
    expect(results.find((r) => r.productId === "lego-99901")!.status).toBe("OK")
    const row = await db.catalogProduct.findUniqueOrThrow({ where: { id: "lego-99901" } })
    expect(row.imageStatus).toBe("OK")
    // 无事件商品未被动过
    const noEvent = await db.catalogProduct.findUniqueOrThrow({ where: { id: "lego-99902" } })
    expect(noEvent.imageStatus).toBe("PENDING")
  })
})
