/**
 * 官方目录补全（官网资料闭环，幂等）：
 * 1. Bandai（official-v1）：中文标准名（词典转写）+ 型号 + 官网商品页 + 官网原图
 *    （bandai-hobby.net / 官方 CloudFront）；已缓存且 SHA 一致时跳过网络。
 * 2. LEGO（official-v1）：中文标准名（人工清单）+ 套装编号 + 美国官网页（en-us）
 *    + 官方标准主图 https://www.lego.com/cdn/product-assets/product.img.pri/{setNo}_Prod.png。
 *    —— 彻底替换历史 Rebrickable 镜像：DB imageSourceUrl、本地缓存文件与 provenance.json
 *    均不再保留 rebrickable 记录（第三方图片不得标为官方来源）。
 * 3. 图片抓取校验：HTTP 200 + image/* + 魔数 + 尺寸；失败记 imageStatus=FAILED（不阻断）。
 *
 * 幂等：重复执行只补空字段/更新官网资料，不重复下载已校验缓存，不动用户数据。
 * 默认作用于默认库（app.db）；--db <path> 可指向独立库（如 acceptance.db）。
 */
import { createHash } from "node:crypto"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { PrismaClient } from "@prisma/client"
import { resolveDatabaseUrl } from "../src/lib/prisma"
import {
  bandaiNameZh,
  BANDAI_NAME_ZH_SOURCE,
  legoNameZh,
  LEGO_NAME_ZH_SOURCE,
  legoOfficialImageUrl,
  legoOfficialPageUrl,
  normalizeLegoOfficialPageUrl,
} from "../src/lib/names/zh"
import { officialImageHostCheck, officialImagesDir } from "../src/lib/services/official-image"
import { extractModelNumber } from "../src/lib/services/official-lookup"
import { fetchOfficialImage, cacheOfficialImage } from "../src/lib/services/official-image"

const CACHE_DIR = officialImagesDir()
const PROVENANCE = path.join(CACHE_DIR, "provenance.json")
/** 图片抓取间隔（对官方 CDN 保持礼貌限速） */
const FETCH_INTERVAL_MS = 350

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

interface ProvenanceEntry {
  id: string
  source_page?: string
  image_url?: string
  fetched_at?: string
  rights_basis?: string
  note?: string
}

function loadProvenance(): ProvenanceEntry[] {
  try {
    return (JSON.parse(readFileSync(PROVENANCE, "utf-8")) as { entries: ProvenanceEntry[] }).entries ?? []
  } catch {
    return []
  }
}

/** 当前商品已有 SHA 一致的官方缓存（幂等跳过的唯一依据） */
function cacheShaMatches(cacheFile: string | null | undefined, expectedSha: string | null | undefined): boolean {
  if (!cacheFile || !expectedSha) return false
  const filePath = path.join(CACHE_DIR, cacheFile)
  if (!filePath.startsWith(CACHE_DIR + path.sep) || !existsSync(filePath)) return false
  try {
    const sha = createHash("sha256").update(readFileSync(filePath)).digest("hex")
    return sha === expectedSha
  } catch {
    return false
  }
}

/** 图片抓取（网络抖动重试一次） */
async function fetchWithRetry(url: string): Promise<Awaited<ReturnType<typeof fetchOfficialImage>>> {
  const first = await fetchOfficialImage(url)
  if (first.status === "OK") return first
  await sleep(1200)
  return fetchOfficialImage(url)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dbIdx = args.indexOf("--db")
  const dbUrl = dbIdx >= 0 ? `file:${path.resolve(args[dbIdx + 1] ?? "prisma/app.db")}` : resolveDatabaseUrl()
  const noImages = process.env.CATALOG_ENRICH_NO_IMAGES === "1" || args.includes("--no-images")
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } })

  try {
    let bandaiCached = 0
    let bandaiImageFail = 0
    let legoCached = 0
    let legoImageFail = 0

    // —— LEGO：官方标准主图替换 Rebrickable —— //
    const legoProducts = await db.catalogProduct.findMany({ where: { brand: "LEGO", catalogVersion: "official-v1" } })
    for (const p of legoProducts) {
      const setNumber = p.id.replace(/^lego-/, "")
      const officialImageUrl = legoOfficialImageUrl(setNumber)
      const nameZh = legoNameZh(setNumber)
      const officialPageUrl = normalizeLegoOfficialPageUrl(p.officialPageUrl, setNumber)
      await db.catalogProduct.update({
        where: { id: p.id },
        data: {
          nameZh: p.nameZh ?? nameZh,
          nameZhSource: p.nameZhSource ?? (nameZh ? LEGO_NAME_ZH_SOURCE : null),
          modelNumber: p.modelNumber ?? setNumber,
          officialProductCode: p.officialProductCode ?? setNumber,
          officialPageUrl,
          // 官网原图 URL：无论图片抓取成败都指向官方标准地址（不再保留 Rebrickable）
          officialImageUrl,
          imageSourceUrl: officialImageUrl,
          imageSourcePage: officialPageUrl ?? p.imageSourcePage,
        },
      })
      if (noImages) continue

      if (cacheShaMatches(p.imageCacheFile, p.imageSha256) && p.imageStatus === "OK") {
        legoCached++
        continue
      }
      const image = await fetchWithRetry(officialImageUrl)
      await sleep(FETCH_INTERVAL_MS)
      if (image.status === "OK") {
        const cached = cacheOfficialImage(p.id, image)
        await db.catalogProduct.update({
          where: { id: p.id },
          data: {
            imageStatus: "OK",
            imageCacheFile: "skipped" in cached ? p.imageCacheFile : cached.fileName,
            imageSha256: image.sha256!,
            imageFetchedAt: new Date(),
            rightsBasis: "personal-use",
          },
        })
        legoCached++
        console.log(`[lego] ${p.id} 官网主图已缓存（${image.width}x${image.height}，SHA ${image.sha256!.slice(0, 8)}）`)
      } else {
        legoImageFail++
        // 官方图不可得（如退役套装 404）：清掉历史第三方缓存文件——
        // 绝不把 Rebrickable 镜像继续当官方来源伺服
        for (const old of ["jpg", "jpeg", "png", "webp"]) {
          const oldPath = path.join(CACHE_DIR, `${p.id}.${old}`)
          if (existsSync(oldPath)) rmSync(oldPath, { force: true })
        }
        await db.catalogProduct.update({
          where: { id: p.id },
          data: { imageStatus: "FAILED", imageSha256: null, imageCacheFile: null },
        })
        console.log(`[lego] ${p.id} 官网主图抓取失败（${image.reason}）→ imageStatus=FAILED，第三方旧缓存已删除`)
      }
    }

    // —— Bandai：中文标准名 + 官网资料字段 + 图片补抓 —— //
    const bandaiProducts = await db.catalogProduct.findMany({ where: { brand: "Bandai", catalogVersion: "official-v1" } })
    for (const p of bandaiProducts) {
      const nameZh = bandaiNameZh(p.canonicalName)
      // 官网原图：仅接受官方域名（bandai-hobby.net / 官方 CloudFront）；历史第三方 URL 一律清空
      const sourceUrl = p.imageSourceUrl
      const imageUrlIsOfficial = sourceUrl ? officialImageHostCheck(sourceUrl).ok : false
      await db.catalogProduct.update({
        where: { id: p.id },
        data: {
          nameZh: p.nameZh ?? nameZh,
          nameZhSource: p.nameZhSource ?? BANDAI_NAME_ZH_SOURCE,
          modelNumber: p.modelNumber ?? extractModelNumber(p.canonicalName),
          officialPageUrl: p.officialPageUrl ?? p.source,
          officialImageUrl: imageUrlIsOfficial ? sourceUrl : null,
          imageSourceUrl: imageUrlIsOfficial ? sourceUrl : null,
        },
      })
      if (noImages || !imageUrlIsOfficial || !sourceUrl) {
        if (!imageUrlIsOfficial && sourceUrl) console.log(`[bandai] ${p.id} 图片 URL 非官方域名，已清除（${sourceUrl}）`)
        continue
      }

      if (cacheShaMatches(p.imageCacheFile, p.imageSha256) && p.imageStatus === "OK") {
        bandaiCached++
        continue
      }
      const image = await fetchWithRetry(sourceUrl)
      await sleep(FETCH_INTERVAL_MS)
      if (image.status === "OK") {
        const cached = cacheOfficialImage(p.id, image)
        await db.catalogProduct.update({
          where: { id: p.id },
          data: {
            imageStatus: "OK",
            imageCacheFile: "skipped" in cached ? p.imageCacheFile : cached.fileName,
            imageSha256: image.sha256!,
            imageFetchedAt: new Date(),
            rightsBasis: "personal-use",
          },
        })
        bandaiCached++
        console.log(`[bandai] ${p.id} 官网图已缓存（${image.width}x${image.height}，SHA ${image.sha256!.slice(0, 8)}）`)
      } else {
        // 官网 CDN 403（Bandai 商品图带签名参数，历史清单存的是去参 URL）：
        // 若目录同步时期已缓存过官方图（private-assets 按 {id}.jpg 命名 + provenance 记录），
        // 采用既有官方缓存（按字节登记 SHA）；既无缓存才记 FAILED。
        const legacy = ["jpg", "jpeg", "png", "webp"].map((ext) => path.join(CACHE_DIR, `${p.id}.${ext}`)).find((f) => existsSync(f))
        if (legacy) {
          const sha = createHash("sha256").update(readFileSync(legacy)).digest("hex")
          await db.catalogProduct.update({
            where: { id: p.id },
            data: {
              imageStatus: "OK",
              imageCacheFile: path.basename(legacy),
              imageSha256: sha,
              rightsBasis: "personal-use",
            },
          })
          bandaiCached++
          console.log(`[bandai] ${p.id} 官网图 URL 已失效（${image.reason}），沿用目录同步时期的官方缓存（SHA ${sha.slice(0, 8)}）`)
        } else {
          bandaiImageFail++
          await db.catalogProduct.update({
            where: { id: p.id },
            data: { imageStatus: "FAILED" },
          })
          console.log(`[bandai] ${p.id} 官网图抓取失败（${image.reason}）且无历史官方缓存`)
        }
      }
    }

    // —— provenance.json：清除 Rebrickable 记录，写入官方来源 —— //
    const entries = loadProvenance()
    let cleaned = 0
    for (const e of entries) {
      if (e.image_url && /rebrickable/i.test(e.image_url)) {
        cleaned++
        const setNumber = e.id?.replace(/^lego-/, "") ?? ""
        e.image_url = legoOfficialImageUrl(setNumber)
        e.source_page = legoOfficialPageUrl(setNumber) ?? e.source_page
        e.note = "LEGO 官方标准主图（www.lego.com/cdn），仅本机私有缓存"
      }
    }
    if (cleaned > 0) writeFileSync(PROVENANCE, JSON.stringify({ entries }, null, 2))

    // —— 汇总与审计 —— //
    const remainingRebrick = await db.catalogProduct.count({
      where: { OR: [{ imageSourceUrl: { contains: "rebrickable" } }, { officialImageUrl: { contains: "rebrickable" } }] },
    })
    const zhCount = await db.catalogProduct.count({ where: { catalogVersion: "official-v1", nameZh: { not: null } } })
    const imageOk = await db.catalogProduct.count({ where: { catalogVersion: "official-v1", imageStatus: "OK" } })
    const total = await db.catalogProduct.count({ where: { catalogVersion: "official-v1" } })
    console.log(
      `[catalog-enrich] 完成：中文名 ${zhCount}/${total}，官网图 OK ${imageOk}/${total}（LEGO 缓存 ${legoCached}/失败 ${legoImageFail}，Bandai 已缓存 ${bandaiCached}/失败 ${bandaiImageFail}），provenance 清理 Rebrickable ${cleaned} 条`,
    )
    if (remainingRebrick > 0) {
      console.error(`[catalog-enrich] 失败：仍有 ${remainingRebrick} 条目录商品引用 rebrickable 图片`)
      process.exit(1)
    }
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => {
  console.error(`[catalog-enrich] 异常：${(e as Error).message}`)
  process.exit(1)
})
