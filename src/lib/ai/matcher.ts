import type { VisionExtraction } from "./vision"

/**
 * 确定性目录 Top-3 匹配（任务书：由程序在目录做 Top-3 匹配，模型不得生成 productId）。
 * 多信号加权打分，纯函数可测：
 * - 品牌 15 分（模型输出品牌归一后与目录品牌一致）
 * - 名称 45 分（提取文本 name+series+visibleText+modelNumber 与目录 matchText 的
 *   规范化 token 重叠率；含中日英常见等价词典与 CJK 二元组相似度兜底）
 * - 型号 20 分（机体型号/套装编号出现在目录文本中）
 * - 等级 10 分 / 系列线 10 分
 * 置信度 = 总分/100（上限 0.98），供既有阈值（60% 预选 90%）复用。
 */

export interface MatcherProduct {
  id: string
  brand: string
  category: string
  line: string | null
  grade: string
  canonicalName: string
  /** 额外匹配文本（如官方日文名），可与 canonicalName 拼接 */
  matchText?: string | null
  /** 型号/套装编号（LEGO 强匹配键） */
  modelNumber?: string | null
}

export interface MatchedCandidate {
  productId: string
  confidence: number
  score: number
}

/** 常见中日英等价词（规范键 -> 各语言变体） */
const EQUIV: Record<string, string[]> = {
  gundam: ["ガンダム", "高达", "敢达", "gundam"],
  zeta: ["ゼータ", "zeta", "z"],
  zz: ["ダブルゼータ", "zz"],
  nu: ["ニュー", "ν", "nu"],
  unicorn: ["ユニコーン", "unicorn", "独角兽"],
  narrative: ["ナラティブ", "narrative"],
  sinanju: ["シナンジュ", "sinanju", "新安洲"],
  sazabi: ["サザビー", "sazabi", "沙扎比"],
  hyaku: ["百式", "hyaku", "hyakushiki"],
  wing: ["ウイング", "wing", "飞翼"],
  zero: ["ゼロ", "zero"],
  freedom: ["フリーダム", "freedom", "自由"],
  justice: ["ジャスティス", "justice", "正义"],
  destiny: ["デスティニー", "destiny", "命运"],
  strike: ["ストライク", "strike"],
  impulse: ["インパルス", "impulse"],
  astray: ["アストレイ", "astray"],
  rx78: ["rx78", "rx-78"],
  rx93: ["rx93", "rx-93"],
  mg: ["マスターグレード", "mg"],
  rg: ["rg"],
  hg: ["hg", "hgu", "hguc"],
  pg: ["pg"],
  mgex: ["mgex"],
  sd: ["sd"],
  verka: ["ver", "ka", "verka"],
  bandai: ["万代", "バンダイ", "bandai"],
  lego: ["乐高", "樂高", "lego"],
  technic: ["technic", "テクニック"],
  gundambase: ["ガンダムベース", "gundambase"],
  unleashed: ["アンリーシュド", "unleashed"],
}

const EQUIV_LOOKUP = new Map<string, string>()
for (const [key, variants] of Object.entries(EQUIV)) {
  for (const v of variants) {
    if (!EQUIV_LOOKUP.has(v.toLowerCase())) EQUIV_LOOKUP.set(v.toLowerCase(), key)
  }
}

function normalizeToken(raw: string): string | null {
  const t = raw.toLowerCase().replace(/[''`´]/g, "")
  if (!t) return null
  return EQUIV_LOOKUP.get(t) ?? t
}

/** 提取 token：字母数字串 + CJK 连续段 */
export function tokenize(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/[a-zA-Z0-9]+|[\u3040-\u30ff\u4e00-\u9fff\uff10-\uff19]+/g)) {
    const t = m[0]!
    if (/[a-zA-Z0-9]/.test(t)) {
      const norm = normalizeToken(t)
      if (norm) out.push(norm)
    } else {
      // CJK：尝试整段等价（如 ガンダム/高达），否则拆二元组
      const norm = EQUIV_LOOKUP.get(t)
      if (norm) {
        out.push(norm)
      } else {
        for (let i = 0; i + 2 <= t.length; i++) out.push(t.slice(i, i + 2))
        if (t.length === 1) out.push(t)
      }
    }
  }
  return out
}

function bigrams(text: string): Set<string> {
  const compact = text.replace(/[\s\W_]+/g, "")
  const out = new Set<string>()
  for (let i = 0; i + 2 <= compact.length; i++) out.add(compact.slice(i, i + 2))
  return out
}

function diceSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return (2 * inter) / (a.size + b.size)
}

const LINE_KEYWORDS: { pattern: RegExp; line: string }[] = [
  { pattern: /宇宙世紀|宇宙世纪|Zガンダム|Z高达|逆襲|逆袭|閃光|哈萨维|ハサウェイ|UC|ユニコーン|unicorn/i, line: "UC" },
  { pattern: /SEED|シード|seed|自由|フリーダム|freedom/i, line: "CE" },
  { pattern: /Wing|ウイング|wing|EW|エンドレスワルツ/i, line: "AC" },
  { pattern: /水星|水星の魔女|G-Witch|witch/i, line: "AC" },
  { pattern: /00|ダブルオー|double.?o/i, line: "AD" },
  { pattern: /鉄血|铁血|iron.?blooded/i, line: "PD" },
  { pattern: /Technic|テクニック/i, line: "SUPERCAR" },
]

function inferLine(extraction: VisionExtraction): string | null {
  const text = `${extraction.series} ${extraction.name}`
  for (const { pattern, line } of LINE_KEYWORDS) {
    if (pattern.test(text)) return line
  }
  return null
}

export function matchCatalogTop3(
  extraction: VisionExtraction,
  products: readonly MatcherProduct[],
): MatchedCandidate[] {
  const modelNumber = extraction.modelNumber.replace(/[^0-9a-zA-Z-]/g, "")
  const extractionLine = inferLine(extraction)
  const brand = extraction.brand

  // LEGO 套装编号强匹配键：品牌 LEGO + 4~7 位纯数字套装编号与目录商品 id
  // （lego-{setNo}）或 modelNumber 精确一致 → 直接 Top-1 高置信（编号唯一且可验证）
  if (brand && brand.toLowerCase() === "lego" && /^\d{4,7}$/.test(modelNumber)) {
    const strong = products.filter(
      (p) =>
        p.brand.toLowerCase() === "lego" &&
        (p.id === `lego-${modelNumber}` || (p as MatcherProduct & { modelNumber?: string | null }).modelNumber === modelNumber),
    )
    if (strong.length > 0) {
      const rest = matchCatalogTop3(extraction, products.filter((p) => !strong.includes(p)))
      return [
        ...strong.map((p) => ({ productId: p.id, score: 95, confidence: 0.95 })),
        ...rest,
      ].slice(0, 3)
    }
  }

  // 字段级相似度：名称/系列/可见文字分别计算（避免相互稀释），取最大值；
  // token 用 Jaccard（惩罚目录近重复条目的多余 token），bigram Dice 兜底同语系字形。
  const nameTokens = new Set(tokenize(extraction.name))
  const seriesTokens = new Set(tokenize(extraction.series))
  const visibleTokens = new Set(tokenize(extraction.visibleText ?? ""))
  const nameBigrams = bigrams(extraction.name)
  const seriesBigrams = bigrams(extraction.series)
  const visibleBigrams = bigrams(extraction.visibleText ?? "")

  const scored: MatchedCandidate[] = []
  for (const p of products) {
    const productText = `${p.canonicalName} ${p.matchText ?? ""}`
    const productTokens = new Set(tokenize(productText))
    const productBigrams = bigrams(productText)
    const productModelNumber = (p as MatcherProduct & { modelNumber?: string | null }).modelNumber

    let score = 0
    if (brand && brand.toLowerCase() === p.brand.toLowerCase()) score += 15

    const jaccard = (a: Set<string>): number => {
      if (a.size === 0) return 0
      let inter = 0
      for (const t of a) if (productTokens.has(t)) inter++
      return inter / (a.size + productTokens.size - inter)
    }
    const dice = (b: Set<string>): number => diceSimilarity(b, productBigrams)
    const nameSim = Math.min(1, Math.max(jaccard(nameTokens), dice(nameBigrams) * 1.1))
    const seriesSim = Math.min(1, Math.max(jaccard(seriesTokens), dice(seriesBigrams) * 1.1))
    const visibleSim = Math.min(1, Math.max(jaccard(visibleTokens), dice(visibleBigrams) * 1.1))
    score += Math.round(Math.max(nameSim, seriesSim * 0.85, visibleSim * 0.7) * 45)

    // 型号 / 套装编号
    if (modelNumber.length >= 3) {
      if (
        productText.replace(/[^0-9a-zA-Z-]/g, "").includes(modelNumber) ||
        p.id.includes(modelNumber) ||
        (productModelNumber != null && productModelNumber.replace(/[^0-9a-zA-Z-]/g, "") === modelNumber)
      ) {
        score += 20
      }
    }

    // 等级
    const eg = extraction.grade.toUpperCase().replace(/[^A-Z0-9/]/g, "")
    const pg = p.grade.toUpperCase().replace(/[^A-Z0-9/]/g, "")
    if (eg && pg && (eg === pg || (eg.length >= 2 && pg.includes(eg)))) score += 10

    // 系列线
    if (extractionLine && extractionLine === p.line) score += 10

    scored.push({ productId: p.id, score, confidence: Math.min(0.98, score / 100) })
  }
  return scored.sort((a, b) => b.score - a.score || a.productId.localeCompare(b.productId)).slice(0, 3)
}
