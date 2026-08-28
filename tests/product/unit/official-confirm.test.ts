import { describe, expect, it, beforeAll, afterAll, vi } from "vitest"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import sharp from "sharp"
import { getTestDb, resetTestDb } from "../../helpers/db"
import { upsertSearchedOfficialProduct, confirmAsset } from "@/lib/services/assets"

/**
 * 官网候选确认入库（识别主链路重构）：
 * - 唯一标识：官方页面 ID；官方产品编号精确去重（同品番复用目录行）；
 * - 官网图下载校验（200+image/*+魔数+尺寸）→ 缓存 + imageStatus=OK → 收藏封面；
 * - 页面域名为软校验（用户确认后非官方页面也可录入）；图片域名硬校验（非官方图不作官方声明）；幂等（重复确认不重复建档/下载）；
 * - E2E 模式不联网。
 */

let imagesDir: string
const SAZABI_CANDIDATE = {
  key: "bandai-manual-949",
  officialName: "MG 1/100 MSN-04 サザビーVer.ka",
  nameZh: "MG 1/100 沙扎比Ver.ka",
  productCode: "2204932",
  pageUrl: "https://manual.bandai-hobby.net/menus/detail/949",
  imageUrl: "https://bandai-hobby.net/images/155_1012_s_xxx.jpg",
  sourceDomain: "manual.bandai-hobby.net",
  brand: "Bandai",
  grade: "MG",
  scale: "1/100",
  modelNumber: "MSN-04",
  series: "機動戦士ガンダム 逆襲のシャア",
  releaseYear: 2013,
  line: "UC",
}

beforeAll(async () => {
  imagesDir = mkdtempSync(path.join(tmpdir(), "official-confirm-"))
  process.env.OFFICIAL_IMAGES_DIR = imagesDir
  await resetTestDb()
  const bytes = await sharp({ create: { width: 560, height: 560, channels: 3, background: "#778899" } }).jpeg().toBuffer()
  const pngBytes = await sharp({ create: { width: 500, height: 280, channels: 3, background: "#998877" } }).png().toBuffer()
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input)
    if (url.includes("155_1012_s_xxx.jpg")) {
      return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "image/jpeg" } })
    }
    if (url.includes("42172_Prod.png")) {
      return new Response(new Uint8Array(pngBytes), { status: 200, headers: { "content-type": "image/png" } })
    }
    if (url.includes("403-image.jpg")) {
      return new Response("<html>403</html>", { status: 403, headers: { "content-type": "text/html" } })
    }
    return new Response("nf", { status: 404 })
  }) as typeof fetch
  void originalFetch
})

afterAll(() => {
  delete process.env.OFFICIAL_IMAGES_DIR
  rmSync(imagesDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe("upsertSearchedOfficialProduct", () => {
  it("首次确认：建档（页面 ID 唯一标识）+ 下载校验官网图（缓存/SHA/imageStatus=OK）", async () => {
    const db = getTestDb()
    const id = await upsertSearchedOfficialProduct(db, SAZABI_CANDIDATE)
    expect(id).toBe("bandai-manual-949")
    const product = await db.catalogProduct.findUniqueOrThrow({ where: { id } })
    expect(product.canonicalName).toBe("MG 1/100 MSN-04 サザビーVer.ka")
    expect(product.nameZh).toBe("MG 1/100 沙扎比Ver.ka")
    expect(product.officialProductCode).toBe("2204932")
    expect(product.officialPageUrl).toBe("https://manual.bandai-hobby.net/menus/detail/949")
    expect(product.modelNumber).toBe("MSN-04")
    expect(product.scale).toBe("1/100")
    expect(product.imageStatus).toBe("OK")
    expect(product.imageCacheFile).toBe("bandai-manual-949.jpg")
    expect(product.imageSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(existsSync(path.join(imagesDir, "bandai-manual-949.jpg"))).toBe(true)
  })

  it("幂等：重复确认同候选 → 复用目录行、不重复下载（缓存 SHA 一致）", async () => {
    const db = getTestDb()
    const id = await upsertSearchedOfficialProduct(db, SAZABI_CANDIDATE)
    expect(id).toBe("bandai-manual-949")
    const count = await db.catalogProduct.count({ where: { id: "bandai-manual-949" } })
    expect(count).toBe(1)
    const product = await db.catalogProduct.findUniqueOrThrow({ where: { id } })
    const sha = product.imageSha256!
    const bytes = readFileSync(path.join(imagesDir, product.imageCacheFile!))
    const { createHash } = await import("node:crypto")
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha)
  })

  it("官方产品编号精确去重：同品番不同页面 ID → 复用既有目录行", async () => {
    const db = getTestDb()
    // 沙扎比的商品页（不同页面 ID）+ 同品番 2204932
    const id = await upsertSearchedOfficialProduct(db, {
      ...SAZABI_CANDIDATE,
      key: "bandai-item-01_15",
      pageUrl: "https://bandai-hobby.net/item/01_15/",
      imageUrl: null,
      sourceDomain: "bandai-hobby.net",
    })
    // 复用既有行（品番相同），而不是新建
    expect(id).toBe("bandai-manual-949")
    expect(await db.catalogProduct.count({ where: { officialProductCode: "2204932" } })).toBe(1)
  })

  it("官网图下载失败：imageStatus=FAILED（不冒充成功），商品仍建档", async () => {
    const db = getTestDb()
    const id = await upsertSearchedOfficialProduct(db, {
      ...SAZABI_CANDIDATE,
      key: "bandai-manual-1234",
      productCode: "9999999",
      imageUrl: "https://bandai-hobby.net/images/403-image.jpg",
    })
    const product = await db.catalogProduct.findUniqueOrThrow({ where: { id } })
    expect(product.imageStatus).toBe("FAILED")
    expect(product.imageSha256).toBeNull()
    expect(product.nameZh).toBeTruthy()
  })

  it("非官方页面 URL：用户确认后仍可录入（页面如实记录；官方域图片正常下载）", async () => {
    const db = getTestDb()
    const id = await upsertSearchedOfficialProduct(db, {
      ...SAZABI_CANDIDATE,
      key: "user-confirmed-1",
      productCode: "7777777",
      pageUrl: "https://www.1999.co.jp/item/123",
    })
    expect(id).toBe("user-confirmed-1")
    const product = await db.catalogProduct.findUniqueOrThrow({ where: { id } })
    // 用户确认即放行：页面 URL 如实记录（不再 422 硬拦截）
    expect(product.officialPageUrl).toBe("https://www.1999.co.jp/item/123")
    expect(product.source).toBe("https://www.1999.co.jp/item/123")
    // 图片 URL 为官方域 → 正常下载校验并设为封面
    expect(product.imageStatus).toBe("OK")
    expect(product.imageCacheFile).toBe("user-confirmed-1.jpg")
  })

  it("非官方页面 + 非官方图：录入成功但图片不作官方声明（FAILED → 柜格回退实拍图）", async () => {
    const db = getTestDb()
    const id = await upsertSearchedOfficialProduct(db, {
      ...SAZABI_CANDIDATE,
      key: "user-confirmed-2",
      productCode: "8888888",
      pageUrl: "https://www.1999.co.jp/item/456",
      imageUrl: "https://www.1999.co.jp/images/x.jpg",
    })
    expect(id).toBe("user-confirmed-2")
    const product = await db.catalogProduct.findUniqueOrThrow({ where: { id } })
    // 页面可录入；但非官方图片域不作官方声明（绝不冒充官网图）
    expect(product.officialPageUrl).toBe("https://www.1999.co.jp/item/456")
    expect(product.imageStatus).toBe("FAILED")
    expect(product.officialImageUrl).toBeNull()
    expect(product.imageSourceUrl).toBeNull()
    expect(product.imageSha256).toBeNull()
    expect(product.nameZh).toBeTruthy()
  })

  it("LEGO Set Number 候选：官方标准主图（lego.com/cdn）", async () => {
    const db = getTestDb()
    const id = await upsertSearchedOfficialProduct(db, {
      key: "lego-42172",
      officialName: "McLaren P1（42172）",
      nameZh: "迈凯伦P1",
      productCode: "42172",
      pageUrl: "https://www.lego.com/en-us/product/mclaren-p1-42172",
      imageUrl: "https://www.lego.com/cdn/product-assets/product.img.pri/42172_Prod.png",
      sourceDomain: "www.lego.com",
      brand: "LEGO",
      grade: "TECHNIC",
      scale: null,
      modelNumber: "42172",
      series: null,
      releaseYear: null,
      line: null,
    })
    expect(id).toBe("lego-42172")
    const product = await db.catalogProduct.findUniqueOrThrow({ where: { id } })
    expect(product.brand).toBe("LEGO")
    expect(product.canonicalName).toBe("McLaren P1")
    expect(product.imageStatus).toBe("OK")
    expect(product.imageCacheFile).toBe("lego-42172.png")
  })

  it("已有 LEGO 旧误标：用户确认 Marvel 后覆盖 TECHNIC/SUPERCAR，并把链接切到 en-us", async () => {
    const db = getTestDb()
    await db.catalogProduct.upsert({
      where: { id: "lego-76178" },
      create: {
        id: "lego-76178", brand: "LEGO", category: "Technic", line: "SUPERCAR", grade: "TECHNIC",
        canonicalName: "Daily Bugle（76178）", modelNumber: "76178", series: "Marvel",
        officialProductCode: "76178", officialPageUrl: "https://www.lego.com/zh-cn/product/lego-76178",
        officialImageUrl: null, source: "legacy", catalogVersion: "official-v1",
      },
      update: {},
    })
    process.env.E2E_MODE = "1"
    try {
      await upsertSearchedOfficialProduct(db, {
        key: "lego-76178",
        officialName: "Daily Bugle",
        nameZh: null,
        productCode: "76178",
        pageUrl: "https://www.lego.com/zh-cn/product/lego-76178",
        imageUrl: "https://www.lego.com/cdn/product-assets/product.img.pri/76178_Prod.png",
        sourceDomain: "www.lego.com",
        brand: "LEGO",
        grade: "MARVEL",
        scale: null,
        modelNumber: "76178",
        series: "Marvel",
        releaseYear: 2021,
        line: null,
      })
    } finally {
      delete process.env.E2E_MODE
    }
    const product = await db.catalogProduct.findUniqueOrThrow({ where: { id: "lego-76178" } })
    expect(product.category).toBe("LEGO")
    expect(product.line).toBeNull()
    expect(product.grade).toBe("MARVEL")
    expect(product.series).toBe("Marvel")
    expect(product.canonicalName).toBe("Daily Bugle")
    expect(product.officialPageUrl).toBe("https://www.lego.com/en-us/product/daily-bugle-76178")
  })
})

describe("confirmAsset 官网候选完整链路（非官方页面用户确认可录入）", () => {
  it("确认非官方页面候选：实体创建成功且关联目录商品（不再被域名拦截）", async () => {
    const db = getTestDb()
    const result = await confirmAsset(db, "kai", {
      idempotencyKey: "confirm-nonofficial-page-1",
      officialCandidate: {
        key: "user-confirmed-3",
        officialName: "MG 1/100 MSN-04 サザビーVer.ka",
        nameZh: "MG 1/100 沙扎比Ver.ka",
        productCode: "6666666",
        pageUrl: "https://www.example-retail.jp/product/sazabi",
        imageUrl: "https://www.example-retail.jp/img/sazabi.jpg",
        sourceDomain: "www.example-retail.jp",
        brand: "Bandai",
        grade: "MG",
        scale: "1/100",
        modelNumber: "MSN-04",
        series: "機動戦士ガンダム 逆襲のシャア",
        releaseYear: 2013,
        line: "UC",
      },
      dispositionState: "ACTIVE",
      buildState: "UNOPENED",
      progress: 0,
    })
    expect(result.created).toBe(true)
    expect(result.asset.catalogProductId).toBe("user-confirmed-3")
    expect(result.asset.displayName).toContain("沙扎比")
    const product = await db.catalogProduct.findUniqueOrThrow({ where: { id: "user-confirmed-3" } })
    expect(product.officialPageUrl).toBe("https://www.example-retail.jp/product/sazabi")
    // 非官方图不作官方声明：柜格回退用户实拍图
    expect(product.imageStatus).toBe("FAILED")
  })
})
