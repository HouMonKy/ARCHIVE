/**
 * 真实评测：DeepSeek 周报润色（任务书：10 份快照解析及事实一致 100%）。
 *
 * - 快照：程序确定性构造的 10 份周报输入（统计/路线缺口/候选及来源 + 洞察草稿），
 *   覆盖含价格/日期/链接/多候选/无候选/路线缺口等形态；
 * - 校验：deepseekPolish 内建事实保真（数字/金额/日期/链接/名称原样保留），
 *   本脚本再独立复核一次（不信任单一实现）；
 * - 用量计入 AiUsageLog（kind=EVAL）；直连 api.deepseek.com，不 mock。
 */
import { PrismaClient } from "@prisma/client"
import { resolveDatabaseUrl } from "../src/lib/prisma"
import { deepseekPolish, extractFactFragments, validateFactPreservation, type ReportPolishInput } from "../src/lib/ai/deepseek"
import { recordAiUsage } from "../src/lib/ai/usage"

function snapshotBase(): ReportPolishInput {
  return {
    periodLabel: "2026-08-19 ~ 2026-08-25",
    stats: { currentCollection: 7, distinctSku: 7, cumulativeCostDisplay: "¥3,720.00", completionDisplay: "33%（2/6）", stalledCount: 1 },
    routeGaps: [
      { route: "UC 宇宙世纪主线", missing: ["MG Zeta Gundam Ver.Ka", "PG Unleashed RX-78-2 Gundam"], completion: "75%（6/8）" },
      { route: "LEGO Technic 超跑路线", missing: ["Lamborghini Huracán Técnica（42161）", "Bugatti Bolide（42151）", "Koenigsegg Jesko Absolut（42173）", "Ferrari Daytona SP3（42143）", "Lamborghini Revuelto（42214）", "McLaren P1（42172）"], completion: "0%（0/6）" },
    ],
    candidates: [
      { name: "MG Zeta Gundam Ver.Ka", score: 90, reasons: ["PREF_CATEGORY", "PREF_GRADE", "COMPLEMENT", "BUDGET_OK"], sourceName: "ARCHIVE Demo Feed", sourceUrl: "/demo/sources/E01", sourceDate: "2026-08-20" },
    ],
    insights: [],
  }
}

function buildSnapshots(): ReportPolishInput[] {
  const s: ReportPolishInput[] = []

  // 1. 完整三洞察（推荐 + 停滞 + 结构）
  const s1 = snapshotBase()
  s1.insights = [
    {
      type: "NEW_PRODUCT_RECOMMENDATION",
      deterministicHeadline: "新品推荐：MG Zeta Gundam Ver.Ka",
      deterministicBody: "「ARCHIVE Demo Feed」2026-08-20 发布：MG Zeta Gundam Ver.Ka 补货发售，事件价 ¥700.00，匹配分 90（未归一化）。符合你的品类/等级/路线偏好，且在月预算 ¥2000.00 内。来源：/demo/sources/E01",
      facts: { score: 90, sourceUrl: "/demo/sources/E01", sourceDate: "2026-08-20" },
    },
    {
      type: "STALLED_BUILDING",
      deterministicHeadline: "制作停滞提醒：MGEX Unicorn Gundam Ver.Ka 已停滞 24 天",
      deterministicBody: "该实体 2026-08-01 后无进度变化（当前 65%）。建议安排时间推进或调整状态。详情：/collection/A02",
      facts: { score: 24, sourceUrl: "/collection/A02", sourceDate: "2026-08-01" },
    },
    {
      type: "STRUCTURE_COMPLETION",
      deterministicHeadline: "收藏结构：完成率 33%",
      deterministicBody: "当前可制作 6 件中已完成 2 件（33%），制作中 1 件。可优先消化未开盒实体。",
      facts: { score: 33, sourceUrl: "/", sourceDate: null },
    },
  ]
  s.push(s1)

  // 2. 无候选（本周无新品）
  const s2 = snapshotBase()
  s2.candidates = []
  s2.insights = [
    {
      type: "STRUCTURE_COMPLETION",
      deterministicHeadline: "收藏结构：完成率 33%",
      deterministicBody: "当前可制作 6 件中已完成 2 件（33%）。本周无新品建议：没有可靠且未拥有的目录新品事件。",
      facts: { score: 33, sourceUrl: "/", sourceDate: null },
    },
  ]
  s.push(s2)

  // 3. LEGO 路线缺口为主
  const s3 = snapshotBase()
  s3.candidates = [
    { name: "Lamborghini Revuelto（42214）", score: 60, reasons: ["COMPLEMENT"], sourceName: "LEGO.com（人工清单 + 官方 sitemap 校验）", sourceUrl: "https://www.lego.com/en-us/product/lamborghini-revuelto-super-sports-car-42214", sourceDate: "2025-01-01" },
  ]
  s3.insights = [
    {
      type: "NEW_PRODUCT_RECOMMENDATION",
      deterministicHeadline: "新品推荐：Lamborghini Revuelto（42214）",
      deterministicBody: "「LEGO.com（人工清单 + 官方 sitemap 校验）」2025-01-01 收录：Lamborghini Revuelto 发售。匹配分 60。来源：https://www.lego.com/en-us/product/lamborghini-revuelto-super-sports-car-42214",
      facts: { score: 60, sourceUrl: "https://www.lego.com/en-us/product/lamborghini-revuelto-super-sports-car-42214", sourceDate: "2025-01-01" },
    },
    {
      type: "STALLED_BUILDING",
      deterministicHeadline: "制作停滞提醒：Technic Supercar Demo 已停滞 24 天",
      deterministicBody: "该实体 2026-08-01 后无进度变化（当前 0%）。详情：/collection/A08",
      facts: { score: 24, sourceUrl: "/collection/A08", sourceDate: "2026-08-01" },
    },
  ]
  s.push(s3)

  // 4-10. 参数化变体（不同金额/日期/链接/空缺形态）
  const variants: { cost: string; completion: string; date: string; url: string; name: string }[] = [
    { cost: "¥5,020.00", completion: "29%（2/7）", date: "2026-08-22", url: "https://bandai-hobby.net/item/01_3010/", name: "MGEX Unicorn Gundam Ver.Ka" },
    { cost: "¥12,000.00", completion: "50%（3/6）", date: "2026-08-18", url: "https://bandai-hobby.net/item/01_2157/", name: "HGUC Narrative Gundam C-Packs" },
    { cost: "¥860.00", completion: "100%（5/5）", date: "2026-08-15", url: "https://www.lego.com/en-us/product/ferrari-daytona-sp3-42143", name: "Ferrari Daytona SP3（42143）" },
    { cost: "¥0.00", completion: "0%（0/3）", date: "2026-08-10", url: "/demo/sources/E02", name: "HGUC Narrative Gundam C-Packs" },
    { cost: "¥3,720.00", completion: "33%（2/6）", date: "2026-08-20", url: "/demo/sources/E03", name: "MG Freedom Gundam Ver.2.0" },
    { cost: "¥45,000.00", completion: "67%（4/6）", date: "2026-08-12", url: "https://www.lego.com/en-us/product/mclaren-p1-42172", name: "McLaren P1（42172）" },
    { cost: "¥1,296.00", completion: "43%（3/7）", date: "2026-08-25", url: "https://bandai-hobby.net/item/01_4311/", name: "MG Zeta Gundam Ver.Ka" },
  ]
  for (const v of variants) {
    const snap = snapshotBase()
    snap.stats = { currentCollection: 7, distinctSku: 7, cumulativeCostDisplay: v.cost, completionDisplay: v.completion, stalledCount: 1 }
    snap.candidates = [{ name: v.name, score: 75, reasons: ["PREF_CATEGORY", "RECENT_RELEASE"], sourceName: "官方目录", sourceUrl: v.url, sourceDate: v.date }]
    snap.insights = [
      {
        type: "NEW_PRODUCT_RECOMMENDATION",
        deterministicHeadline: `新品推荐：${v.name}`,
        deterministicBody: `「官方目录」${v.date} 发布：${v.name} 事件价 ¥700.00，匹配分 75。来源：${v.url}`,
        facts: { score: 75, sourceUrl: v.url, sourceDate: v.date },
      },
      {
        type: "STRUCTURE_COMPLETION",
        deterministicHeadline: `收藏结构：完成率 ${v.completion.split("（")[0]}`,
        deterministicBody: `当前完成率 ${v.completion}，累计购入成本 ${v.cost}。`,
        facts: { score: 33, sourceUrl: "/", sourceDate: null },
      },
    ]
    s.push(snap)
  }
  return s
}

async function main(): Promise<void> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    console.error("[eval-deepseek] 缺少 DEEPSEEK_API_KEY（真实评测必须直连，不 mock）")
    process.exit(1)
  }

  const db = new PrismaClient({ datasources: { db: { url: resolveDatabaseUrl() } } })
  try {
    const snapshots = buildSnapshots()
    console.log(`[eval-deepseek] 快照 ${snapshots.length} 份；事实片段示例：${extractFactFragments(snapshots[0]!.insights[0]!.deterministicBody).slice(0, 6).join(" ")}`)

    let parseOk = 0
    let factOk = 0
    const failures: string[] = []

    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i]!
      const out = await deepseekPolish(apiKey, snap)
      await recordAiUsage(db, {
        provider: "deepseek",
        model: out.model,
        kind: "EVAL",
        requestId: out.requestId,
        latencyMs: out.latencyMs,
        promptTokens: out.promptTokens,
        completionTokens: out.completionTokens,
      }).catch(() => undefined)

      if (out.state !== "SUCCEEDED" || !out.polished) {
        failures.push(`快照${i + 1}: 润色失败 ${out.errorCode}`)
        console.log(`✗ 快照${i + 1} → 失败 ${out.errorCode}（${out.latencyMs}ms）`)
        continue
      }
      parseOk++

      // 独立复核事实保真（不信任 provider 内建校验的单一实现）
      let ok = true
      for (let j = 0; j < snap.insights.length; j++) {
        const draft = snap.insights[j]!
        const got = out.polished[j]!
        const h = validateFactPreservation(draft.deterministicHeadline, got.headline)
        const b = validateFactPreservation(draft.deterministicBody, got.body)
        if (!h.ok || !b.ok) {
          ok = false
          failures.push(`快照${i + 1} 洞察${j + 1}: 丢失事实 ${[...h.missing, ...b.missing].join(",")}`)
        }
      }
      if (ok) {
        factOk++
        console.log(`✓ 快照${i + 1} → ${snap.insights.length} 条洞察润色，事实一致（${out.latencyMs}ms, ${out.promptTokens}/${out.completionTokens} tok）`)
        console.log(`    示例 headline: ${out.polished[0]!.headline.slice(0, 60)}`)
      } else {
        console.log(`✗ 快照${i + 1} → 事实不一致`)
      }
    }

    const parseRate = parseOk / snapshots.length
    const factRate = factOk / snapshots.length
    console.log("")
    console.log(`[eval-deepseek] 快照解析成功率 ${parseOk}/${snapshots.length} = ${(parseRate * 100).toFixed(1)}%（阈值 =100%）`)
    console.log(`[eval-deepseek] 事实一致率 ${factOk}/${snapshots.length} = ${(factRate * 100).toFixed(1)}%（阈值 =100%）`)
    if (failures.length > 0) {
      console.log("[eval-deepseek] 失败明细：")
      for (const f of failures) console.log(`  - ${f}`)
    }
    if (parseRate < 1 || factRate < 1) {
      console.error("[eval-deepseek] 未达标")
      process.exit(2)
    }
    console.log("[eval-deepseek] 达标 ✓")
  } finally {
    await db.$disconnect()
  }
}

void main()
