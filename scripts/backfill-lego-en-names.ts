/**
 * LEGO en-us 官网英文名幂等回填（R9）：
 * - 所有 LEGO 行 nameZh/nameZhSource 清为 null；
 * - 占位 canonicalName（LEGO Technic <编号> / LEGO <编号> 等）通过通用官网元数据流程
 *   （en-us 商品页 og:title 直连 → $web_search 兜底）修正为官网英文标题；
 * - meaningful canonicalName（如 McLaren P1）保留不动——只清 nameZh；
 * - 同时把 officialPageUrl 规范为已验证 en-us 商品页（含 11370 slug 修正）；
 * - 不改 series/grade/藏品 ID/照片/已有效官网图；幂等：连跑两次第二次更新数为 0。
 *
 * 用法：npx tsx scripts/backfill-lego-en-names.ts [--db prisma/app.db] [--strip-number-only]
 * `--strip-number-only` 仅做确定性的重复编号清理，不联网、不调用模型。
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { PrismaClient } from "@prisma/client"
import { resolveDatabaseUrl } from "../src/lib/prisma"

for (const line of readFileSync(path.resolve(process.cwd(), ".env.local"), "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(\S+)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]!
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dbIdx = args.indexOf("--db")
  const dbUrl = dbIdx >= 0 ? `file:${path.resolve(args[dbIdx + 1] ?? "prisma/app.db")}` : resolveDatabaseUrl()
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } })
  const {
    resolveLegoEnUsName,
    isGenericLegoPlaceholderName,
    cleanLegoSeoSuffix,
    stripLegoBrandPrefix,
    stripLegoTrailingSetNumber,
  } = await import("../src/lib/names/lego-naming")
  const { normalizeLegoOfficialPageUrl, legoOfficialPageUrl } = await import("../src/lib/names/zh")
  const { resolveRecognitionConfig } = await import("../src/lib/services/ai-settings")

  try {
    const config = await resolveRecognitionConfig(db)
    const stripNumberOnly = args.includes("--strip-number-only")
    const legoRows = await db.catalogProduct.findMany({ where: { brand: "LEGO" }, orderBy: { id: "asc" } })
    let nameZhCleared = 0
    let nameUpdated = 0
    let urlFixed = 0
    let unchanged = 0

    for (const row of legoRows) {
      const setNumber = row.modelNumber ?? row.id.replace(/^lego-/, "")
      const updates: Record<string, unknown> = {}

      // 1) nameZh/nameZhSource → null（一律清）
      if (row.nameZh != null || row.nameZhSource != null) {
        updates.nameZh = null
        updates.nameZhSource = null
        nameZhCleared++
      }

      // 独立 modelNumber 已保存编号，名称末尾的同号括号只会造成重复展示。
      // 这是确定性清理，不需要联网，也不会碰名称自身的其他数字。
      const normalizedCurrentName = stripLegoTrailingSetNumber(row.canonicalName, setNumber)
      if (normalizedCurrentName !== row.canonicalName) {
        updates.canonicalName = normalizedCurrentName
        nameUpdated++
      }

      if (stripNumberOnly) {
        if (Object.keys(updates).length > 0) {
          await db.catalogProduct.update({ where: { id: row.id }, data: updates })
          console.log(`[backfill:lego-en] ${row.id}: ${row.canonicalName} → ${normalizedCurrentName}`)
        } else {
          unchanged++
        }
        continue
      }

      // 2) 占位 canonicalName / 旧占位 URL → 通用官网元数据流程修正
      const isPlaceholder = isGenericLegoPlaceholderName(normalizedCurrentName, setNumber)
      // 旧 URL slug 错误（非 en-us 或 slug 编号不匹配）也走修正
      const normalizedUrl = normalizeLegoOfficialPageUrl(row.officialPageUrl, setNumber)
      const knownGoodUrl = legoOfficialPageUrl(setNumber)
      const urlNeedsFix = knownGoodUrl != null && row.officialPageUrl !== knownGoodUrl

      // 解析条件：占位名 或 URL 需修正 或 meaningful 名缺少 ™® 等官网符号
      //（meaningful 名只有已验证官网标题才更新——resolveLegoEnUsName 产物即已验证）
      if (isPlaceholder || urlNeedsFix) {
        const resolved = await resolveLegoEnUsName(setNumber, {
          webSearch: config.apiKey ? { apiKey: config.apiKey, model: config.model, baseUrl: config.baseUrl } : undefined,
        }, normalizedUrl ?? knownGoodUrl)
        if (resolved.status === "RESOLVED" && resolved.officialName) {
          const title = cleanLegoSeoSuffix(resolved.officialName)
          if (title && title !== normalizedCurrentName) {
            updates.canonicalName = title
            nameUpdated++
          }
          if (resolved.pageUrl && resolved.pageUrl !== row.officialPageUrl) {
            updates.officialPageUrl = resolved.pageUrl
            urlFixed++
          }
        } else if (urlNeedsFix && knownGoodUrl) {
          // 名称未解析成功但 slug 清单可信 → 只修 URL
          updates.officialPageUrl = knownGoodUrl
          urlFixed++
        }
      } else {
        // meaningful canonicalName 两种规范化（均只在官网标题已验证时执行）：
        // a) 名称带 "LEGO®/LEGO Icons" 前缀（非 og:title 口径）→ 去前缀后的官网标题
        // b) 名称缺 ™® 符号（如 Hogwarts Castle and Grounds）→ 同词根官网标题补全符号
        const strippedExisting = stripLegoBrandPrefix(normalizedCurrentName)
        const hasBrandPrefix = strippedExisting !== normalizedCurrentName && strippedExisting.length > 0
        const nameNoMarks = normalizedCurrentName.replace(/[™®]/g, "").replace(/^LEGO\s*[®]?\s*(Icons|Technic|City|Star\s*Wars)?\s*/i, "").trim()
        if (normalizedCurrentName && (hasBrandPrefix || !/[™®]/.test(normalizedCurrentName))) {
          const resolved = await resolveLegoEnUsName(setNumber, {
            webSearch: config.apiKey ? { apiKey: config.apiKey, model: config.model, baseUrl: config.baseUrl } : undefined,
          }, normalizedUrl ?? knownGoodUrl)
          if (resolved.status === "RESOLVED" && resolved.officialName) {
            const title = cleanLegoSeoSuffix(resolved.officialName)
            const titleNoMarks = title.replace(/[™®]/g, "").trim()
            if (title && title !== normalizedCurrentName) {
              if (hasBrandPrefix) {
                // 带品牌前缀的旧名 → 官网 og:title 口径标题
                updates.canonicalName = title
                nameUpdated++
              } else if (titleNoMarks === nameNoMarks) {
                // 同词根（仅补 ™ ® 符号）
                updates.canonicalName = title
                nameUpdated++
              }
            }
          }
        }
      }

      if (Object.keys(updates).length > 0) {
        await db.catalogProduct.update({ where: { id: row.id }, data: updates })
        console.log(
          `[backfill:lego-en] ${row.id}: ${Object.keys(updates).join("+")} →`,
          updates.canonicalName ?? `(名保留 ${row.canonicalName})`,
          updates.officialPageUrl ?? "",
        )
      } else {
        unchanged++
      }
    }

    console.log(
      `[backfill:lego-en] 完成：LEGO ${legoRows.length} 行，nameZh 清 null ${nameZhCleared}，占位名修正 ${nameUpdated}，URL 修正 ${urlFixed}，无需变更 ${unchanged}`,
    )
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => {
  console.error(`[backfill:lego-en] 异常：${(e as Error).message}`)
  process.exit(1)
})
