import { describe, expect, it, beforeAll, afterAll, vi } from "vitest"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import sharp from "sharp"

/**
 * 官方目录商品落库（catalog-official）：
 * - 幂等 upsert（重复执行不重复打官网、不回退已有事实）；
 * - 图片抓取失败记 FAILED（不把 HTML/403 写成成功）；
 * - 成功记 OK + 缓存文件 + SHA-256。
 */

vi.mock("@/lib/services/official-image", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/official-image")>()
  return actual
})

let imagesDir: string
let fetchCalls: string[] = []

beforeAll(async () => {
  imagesDir = mkdtempSync(path.join(tmpdir(), "catalog-official-"))
  process.env.OFFICIAL_IMAGES_DIR = imagesDir
  const { resetTestDb } = await import("../../helpers/db")
  await resetTestDb()
  // 拦截网络层（业务逻辑不 mock）：返回真实图片字节
  const bytes = await sharp({ create: { width: 500, height: 400, channels: 3, background: "#445566" } }).png().toBuffer()
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    fetchCalls.push(url)
    if (url.includes("fail.example")) {
      return new Response("<html>403</html>", { status: 403, headers: { "content-type": "text/html" } })
    }
    return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "image/png" } })
  }) as typeof fetch
  void originalFetch
})

afterAll(() => {
  delete process.env.OFFICIAL_IMAGES_DIR
  rmSync(imagesDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

import { upsertOfficialProduct } from "@/lib/services/catalog-official"
import type { OfficialProductDraft } from "@/lib/services/official-lookup"
import { getTestDb } from "../../helpers/db"

const draft: OfficialProductDraft = {
  id: "bandai-manual-646",
  brand: "Bandai",
  category: "Gundam",
  line: "CE",
  grade: "MGEX",
  series: "機動戦士ガンダムSEED DESTINY",
  canonicalName: "MGEX 1/100 ストライクフリーダムガンダム",
  nameZh: "MGEX 1/100 强袭自由高达",
  nameZhSource: "dict:bandai-official-ja",
  modelNumber: "ZGMF-X20A",
  officialProductCode: "2583176",
  officialPageUrl: "https://manual.bandai-hobby.net/menus/detail/646",
  officialImageUrl: "https://bandai-hobby.net/images/196_5149_s_4h4ix8i0czfctrqhwa4e0dygycqs.jpg",
  releaseYear: 2022,
  source: "https://manual.bandai-hobby.net/menus/detail/646",
  manualPdfUrl: "https://manual.bandai-hobby.net/viewer.php?file=/pdf/646.pdf",
}

describe("upsertOfficialProduct", () => {
  it("建档：全字段 + 官网图 OK（缓存 + SHA-256）", async () => {
    const db = getTestDb()
    fetchCalls = []
    const { product, imageStatus } = await upsertOfficialProduct(db, draft)
    expect(product.nameZh).toBe("MGEX 1/100 强袭自由高达")
    expect(product.modelNumber).toBe("ZGMF-X20A")
    expect(product.officialProductCode).toBe("2583176")
    expect(product.officialPageUrl).toBe("https://manual.bandai-hobby.net/menus/detail/646")
    expect(product.officialImageUrl).toContain("bandai-hobby.net")
    expect(imageStatus).toBe("OK")
    expect(product.imageStatus).toBe("OK")
    expect(product.imageCacheFile).toBe("bandai-manual-646.png")
    expect(product.imageSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(existsSync(path.join(imagesDir, "bandai-manual-646.png"))).toBe(true)
    expect(fetchCalls).toHaveLength(1)
  })

  it("幂等：重复执行不打官网（缓存 SHA 一致即跳过）", async () => {
    const db = getTestDb()
    fetchCalls = []
    const { imageStatus } = await upsertOfficialProduct(db, draft)
    expect(imageStatus).toBe("SKIPPED_EXISTING")
    expect(fetchCalls).toHaveLength(0)
    const count = await db.catalogProduct.count({ where: { id: "bandai-manual-646" } })
    expect(count).toBe(1)
  })

  it("图片抓取失败：imageStatus=FAILED，商品仍建档（中文名/官网页保留）", async () => {
    const db = getTestDb()
    const badImage = { ...draft, id: "bandai-manual-999", officialImageUrl: "https://bandai-hobby.net/images/fail.example.jpg" }
    const { product, imageStatus, imageReason } = await upsertOfficialProduct(db, badImage)
    expect(imageStatus).toBe("FAILED")
    expect(imageReason).toBe("HTTP_403")
    expect(product.imageStatus).toBe("FAILED")
    expect(product.imageSha256).toBeNull()
    expect(product.nameZh).toBeTruthy()
  })

  it("无官网图 URL：FAILED + NO_OFFICIAL_IMAGE_URL（不虚构）", async () => {
    const db = getTestDb()
    const noImage = { ...draft, id: "lego-99999", officialImageUrl: null, brand: "LEGO" as const }
    const { imageStatus, imageReason } = await upsertOfficialProduct(db, noImage)
    expect(imageStatus).toBe("FAILED")
    expect(imageReason).toBe("NO_OFFICIAL_IMAGE_URL")
  })

  it("LEGO 写入时移除与 modelNumber 重复的末尾括号编号", async () => {
    const db = getTestDb()
    const legoDraft: OfficialProductDraft = {
      ...draft,
      id: "lego-76269",
      brand: "LEGO",
      category: "LEGO",
      grade: "MARVEL",
      series: "Marvel",
      canonicalName: "Avengers Tower（76269）",
      nameZh: null,
      nameZhSource: null,
      modelNumber: "76269",
      officialProductCode: "76269",
      officialPageUrl: "https://www.lego.com/en-us/product/avengers-tower-76269",
      officialImageUrl: null,
    }
    const { product } = await upsertOfficialProduct(db, legoDraft, { fetchImage: false })
    expect(product.canonicalName).toBe("Avengers Tower")
  })
})
