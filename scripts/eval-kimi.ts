/**
 * 真实评测：Kimi 视觉识别（任务书：20 张两品牌盒图，Top-3 ≥80%、结构解析 100%）。
 *
 * - 评测集：10 张 Bandai 官网盒图（P01–P12 缓存中取 10）+ 10 张 LEGO 官方产品摄影缓存；
 * - 标签 = 图片对应的已知目录商品（ground truth，仅供评分，绝不进入模型输入或匹配器）；
 * - 流程与生产一致：kimiExtract（kimi-k2.6，thinking disabled）→ 程序目录 Top-3 匹配；
 * - 用量计入 AiUsageLog（kind=EVAL，参与月度预算）；
 * - 直连 api.moonshot.cn，不 mock；密钥缺失/网络失败如实退出非 0。
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { PrismaClient } from "@prisma/client"
import { resolveDatabaseUrl } from "../src/lib/prisma"
import { kimiExtract } from "../src/lib/ai/kimi"
import { matchCatalogTop3, type MatcherProduct } from "../src/lib/ai/matcher"
import { recordAiUsage } from "../src/lib/ai/usage"
import { readImageManifest } from "../src/lib/image-manifest"

const CACHE_DIR = path.resolve(process.cwd(), "private-assets/product-images")

/** 评测集（品牌均衡 10+10） */
const EVAL_SET: { file: string; expectedProductId: string; brand: string }[] = [
  { file: "P01.jpg", expectedProductId: "P01", brand: "Bandai" },
  { file: "P02.jpg", expectedProductId: "P02", brand: "Bandai" },
  { file: "P04.jpg", expectedProductId: "P04", brand: "Bandai" },
  { file: "P05.jpg", expectedProductId: "P05", brand: "Bandai" },
  { file: "P06.jpg", expectedProductId: "P06", brand: "Bandai" },
  { file: "P08.jpg", expectedProductId: "P08", brand: "Bandai" },
  { file: "P09.jpg", expectedProductId: "P09", brand: "Bandai" },
  { file: "P10.jpg", expectedProductId: "P10", brand: "Bandai" },
  { file: "P11.jpg", expectedProductId: "P11", brand: "Bandai" },
  { file: "P12.jpg", expectedProductId: "P12", brand: "Bandai" },
  { file: "lego-42115.jpg", expectedProductId: "lego-42115", brand: "LEGO" },
  { file: "lego-42143.jpg", expectedProductId: "lego-42143", brand: "LEGO" },
  { file: "lego-42161.jpg", expectedProductId: "lego-42161", brand: "LEGO" },
  { file: "lego-42151.jpg", expectedProductId: "lego-42151", brand: "LEGO" },
  { file: "lego-42172.jpg", expectedProductId: "lego-42172", brand: "LEGO" },
  { file: "lego-42173.jpg", expectedProductId: "lego-42173", brand: "LEGO" },
  { file: "lego-42184.jpg", expectedProductId: "lego-42184", brand: "LEGO" },
  { file: "lego-42214.jpg", expectedProductId: "lego-42214", brand: "LEGO" },
  { file: "lego-42205.jpg", expectedProductId: "lego-42205", brand: "LEGO" },
  { file: "lego-42171.jpg", expectedProductId: "lego-42171", brand: "LEGO" },
]

const TOP3_THRESHOLD = 0.8
const STRUCTURE_THRESHOLD = 1.0

async function main(): Promise<void> {
  const apiKey = process.env.MOONSHOT_API_KEY
  if (!apiKey) {
    console.error("[eval-kimi] 缺少 MOONSHOT_API_KEY（真实评测必须直连，不 mock）")
    process.exit(1)
  }

  const db = new PrismaClient({ datasources: { db: { url: resolveDatabaseUrl() } } })
  try {
    const products = await db.catalogProduct.findMany({
      where: { catalogVersion: { in: ["demo-v1", "official-v1"] } },
    })
    const manifest = readImageManifest() as { products: { code: string; official_name_ja?: string }[] }
    const { DEMO_CATALOG_PRODUCTS } = await import("../src/lib/demo-dataset")
    const demoModelCode = new Map(DEMO_CATALOG_PRODUCTS.map((p) => [p.id, p.modelCode ?? null]))
    const matcherProducts: MatcherProduct[] = products.map((p) => ({
      id: p.id,
      brand: p.brand,
      category: p.category,
      line: p.line ?? null,
      grade: p.grade,
      canonicalName: p.canonicalName,
      matchText:
        [manifest.products.find((m) => m.code === p.id)?.official_name_ja, demoModelCode.get(p.id)]
          .filter(Boolean)
          .join(" ") || null,
    }))
    console.log(`[eval-kimi] 目录 ${matcherProducts.length} 条；评测集 ${EVAL_SET.length} 张（Bandai 10 / LEGO 10）`)

    let top3Hits = 0
    let top1Hits = 0
    let structureOk = 0
    let completed = 0
    const misses: string[] = []

    for (const item of EVAL_SET) {
      const filePath = path.join(CACHE_DIR, item.file)
      let bytes: Buffer
      try {
        bytes = readFileSync(filePath)
      } catch {
        console.error(`[eval-kimi] 评测图缺失：${filePath}（先运行 npm run catalog:sync 缓存）`)
        process.exit(1)
      }
      const dataUrl = `data:image/jpeg;base64,${bytes.toString("base64")}`
      const result = await kimiExtract(apiKey, { imageDataUrl: dataUrl, mimeType: "image/jpeg" })

      await recordAiUsage(db, {
        provider: "moonshot",
        model: "kimi-k2.6",
        kind: "EVAL",
        requestId: result.requestId,
        latencyMs: result.latencyMs,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
      }).catch(() => undefined)

      if (result.state === "SUCCEEDED" && result.extraction) {
        structureOk++
        const top3 = matchCatalogTop3(result.extraction, matcherProducts)
        const rank = top3.findIndex((m) => m.productId === item.expectedProductId)
        const hit = rank >= 0
        if (hit) {
          top3Hits++
          if (rank === 0) top1Hits++
        } else {
          misses.push(`${item.file}: 期望 ${item.expectedProductId}，实际 Top-3 ${top3.map((m) => m.productId).join("/") || "（无）"}`)
        }
        console.log(
          `${hit ? "✓" : "✗"} ${item.file} → ${top3.map((m) => `${m.productId}(${Math.round(m.confidence * 100)}%)`).join(" ") || "无候选"}` +
            ` | 提取: ${result.extraction.brand}/${result.extraction.grade}/${result.extraction.name.slice(0, 24)}`,
        )
      } else {
        misses.push(`${item.file}: 识别失败 ${result.errorCode}`)
        console.log(`✗ ${item.file} → 失败 ${result.errorCode}（耗时 ${result.latencyMs}ms）`)
      }
      completed++
    }

    const top3Rate = top3Hits / completed
    const top1Rate = top1Hits / completed
    const structureRate = structureOk / completed
    console.log("")
    console.log(`[eval-kimi] 完成 ${completed}/${EVAL_SET.length}`)
    console.log(`[eval-kimi] Top-3 命中率 ${top3Hits}/${completed} = ${(top3Rate * 100).toFixed(1)}%（阈值 ≥${TOP3_THRESHOLD * 100}%）`)
    console.log(`[eval-kimi] Top-1 命中率 ${top1Hits}/${completed} = ${(top1Rate * 100).toFixed(1)}%`)
    console.log(`[eval-kimi] 结构解析成功率 ${structureOk}/${completed} = ${(structureRate * 100).toFixed(1)}%（阈值 =100%）`)
    if (misses.length > 0) {
      console.log("[eval-kimi] 未命中明细：")
      for (const m of misses) console.log(`  - ${m}`)
    }

    if (top3Rate < TOP3_THRESHOLD || structureRate < STRUCTURE_THRESHOLD) {
      console.error("[eval-kimi] 未达标")
      process.exit(2)
    }
    console.log("[eval-kimi] 达标 ✓")
  } finally {
    await db.$disconnect()
  }
}

void main()
