import { createHash } from "node:crypto"
import { formatDateZh } from "../clock"

/**
 * 推荐依据指纹（FR-09 返工强化）：
 * “不感兴趣”反馈保存反馈时点的推荐依据指纹；30 天内依据未变继续抑制，
 * 依据实质变化（分数/理由码/事件价格/来源/日期任一变化）时允许重新推荐。
 */

export interface RecommendationBasis {
  productId: string
  score: number
  reasonCodes: string[]
  eventPriceMinor: number | null
  sourceUrl: string
  sourceDate: Date
}

export function recommendationBasisFingerprint(basis: RecommendationBasis): string {
  const canonical = JSON.stringify({
    productId: basis.productId,
    score: basis.score,
    reasonCodes: [...basis.reasonCodes].sort(),
    eventPriceMinor: basis.eventPriceMinor,
    sourceUrl: basis.sourceUrl,
    sourceDate: formatDateZh(basis.sourceDate),
  })
  return createHash("sha256").update(canonical).digest("hex")
}
