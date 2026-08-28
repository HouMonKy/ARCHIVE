import { z } from "zod"

/**
 * 视觉识别结果契约（任务书：输出品牌/名称/系列/等级/型号/可见文字/置信度/证据，
 * 随后由程序在目录做 Top-3 匹配，模型不得生成 productId）。
 * productId 出现在模型输出中会被显式丢弃（防御）。
 */

const extractionSchema = z.object({
  brand: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  series: z.string().max(200).optional().default(""),
  grade: z.string().max(40).optional().default(""),
  scale: z.string().max(20).optional().default(""),
  modelNumber: z.string().max(120).optional().default(""),
  visibleText: z.string().max(1000).optional().default(""),
  confidence: z.number().min(0).max(1),
  evidence: z.string().max(2000).optional().default(""),
})

export interface VisionExtraction {
  brand: string
  name: string
  series: string
  grade: string
  scale: string
  modelNumber: string
  visibleText: string
  confidence: number
  evidence: string
}

export interface VisionExtractionResult {
  state: "SUCCEEDED" | "FAILED"
  extraction: VisionExtraction | null
  errorCode?: string
  provider: string
  providerVersion: string
  promptTokens: number | null
  completionTokens: number | null
  requestId: string | null
  latencyMs: number
}

/** 品牌归一（模型常用中文名或日文名返回） */
export function normalizeBrand(raw: string): string {
  const v = raw.trim().toLowerCase()
  if (/bandai|万代|バンダイ|bnd/.test(v)) return "Bandai"
  if (/lego|乐高|樂高/.test(v)) return "LEGO"
  return raw.trim()
}

export function parseVisionExtraction(content: string): VisionExtraction | null {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    // 容错：模型偶发输出 ```json 包裹
    const m = content.match(/\{[\s\S]*\}/)
    if (!m) return null
    try {
      raw = JSON.parse(m[0]!)
    } catch {
      return null
    }
  }
  if (raw == null || typeof raw !== "object") return null
  // 防御：丢弃模型可能输出的 productId（模型不得生成目录主键）
  const obj = raw as Record<string, unknown>
  delete obj.productId
  const parsed = extractionSchema.safeParse(obj)
  if (!parsed.success) return null
  const d = parsed.data
  return {
    brand: normalizeBrand(d.brand),
    name: d.name.trim(),
    series: (d.series ?? "").trim(),
    grade: (d.grade ?? "").trim(),
    scale: (d.scale ?? "").trim(),
    modelNumber: (d.modelNumber ?? "").trim(),
    visibleText: (d.visibleText ?? "").trim(),
    confidence: d.confidence,
    evidence: (d.evidence ?? "").trim(),
  }
}
