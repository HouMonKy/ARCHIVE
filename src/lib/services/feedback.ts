import type { PrismaClient } from "@prisma/client"
import { AppError } from "../errors"
import { demoNow } from "../clock"
import { feedbackSchema, intentSchema } from "../validation"
import { recommendationBasisFingerprint } from "../report/basis"

/**
 * 洞察反馈与意向：
 * - “不感兴趣”保存反馈时点的推荐依据指纹，下一期生成对比：30 天内依据未变继续抑制，
 *   依据实质变化允许重新推荐（FR-09）；
 * - “加入愿望单”为用户显式动作，写入 UserProductIntent，不计入收藏统计。
 */

export async function recordFeedback(
  db: PrismaClient,
  userId: string,
  insightId: string,
  rawInput: unknown,
): Promise<{ insightId: string; value: string; basisFingerprint: string | null }> {
  const parsed = feedbackSchema.safeParse(rawInput)
  if (!parsed.success) {
    throw new AppError("反馈取值不合法", { status: 422, code: "INVALID_INPUT" })
  }
  const insight = await db.insight.findUnique({ where: { id: insightId }, include: { report: true } })
  if (!insight || insight.report.userId !== userId) {
    throw new AppError("洞察不存在", { status: 404, code: "INSIGHT_NOT_FOUND" })
  }

  // 记录“不感兴趣”时冻结推荐依据指纹（score/理由码/事件价格/来源/日期）
  let basisFingerprint: string | null = null
  if (parsed.data.value === "NOT_INTERESTED" && insight.type === "NEW_PRODUCT_RECOMMENDATION" && insight.productId) {
    basisFingerprint = recommendationBasisFingerprint({
      productId: insight.productId,
      score: insight.score,
      reasonCodes: JSON.parse(insight.reasonCodes) as string[],
      eventPriceMinor: insight.eventPriceMinor,
      sourceUrl: insight.sourceUrl ?? "",
      sourceDate: insight.sourceDate ?? insight.report.periodEnd,
    })
  }

  await db.insightFeedback.create({
    data: { insightId, userId, value: parsed.data.value, actedAt: demoNow(), basisFingerprint },
  })
  return { insightId, value: parsed.data.value, basisFingerprint }
}

export async function addToWishlist(
  db: PrismaClient,
  userId: string,
  rawInput: unknown,
): Promise<{ catalogProductId: string; state: string }> {
  const parsed = intentSchema.safeParse(rawInput)
  if (!parsed.success) {
    throw new AppError("参数不合法", { status: 422, code: "INVALID_INPUT" })
  }
  const product = await db.catalogProduct.findUnique({ where: { id: parsed.data.productId } })
  if (!product) throw new AppError("目录中不存在该商品", { status: 404, code: "PRODUCT_NOT_FOUND" })
  const existing = await db.userProductIntent.findUnique({
    where: { userId_catalogProductId_state: { userId, catalogProductId: parsed.data.productId, state: "WISHLIST" } },
  })
  if (!existing) {
    await db.userProductIntent.create({
      data: { userId, catalogProductId: parsed.data.productId, state: "WISHLIST" },
    })
  }
  return { catalogProductId: parsed.data.productId, state: "WISHLIST" }
}
