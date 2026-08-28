/**
 * 识别 Provider 边界（PRD §9 + 升级任务书）：AI 只提交带置信度的候选草稿，不创建收藏。
 * - fixture：内置演示识别，界面必须显著显示“演示识别”；
 * - http：对外识别服务的边界适配器（需显式配置 RECOGNITION_API_URL/KEY）；
 * - kimi：Moonshot kimi-k2.6 视觉识别（需 MOONSHOT_API_KEY）——结构化提取后由程序匹配目录。
 * E2E_MODE=1 的测试服务器强制 fixture（普通测试不得联网，且旧 E2E 依赖确定性演示识别）。
 */
import type { UploadImageKind } from "../validation"

export interface RecognitionCandidateInput {
  productId: string
  confidence: number
  fieldConfidences?: Record<string, number>
}

export interface RecognitionResult {
  state: "SUCCEEDED" | "FAILED"
  candidates: RecognitionCandidateInput[]
  errorCode?: string
  provider: string
  providerVersion: string
  isFixture: boolean
  /** 模拟的视觉提取（fixture 演示样例；生产 Kimi 走 VisionRecognitionProvider） */
  extraction?: {
    brand: string
    name: string
    series: string
    grade: string
    scale: string
    modelNumber: string
  }
}

export interface RecognitionInput {
  sha256: string
  fileName: string
  mimeType: string
  size: number
  imageKind: UploadImageKind
}

export interface RecognitionProvider {
  readonly name: string
  readonly version: string
  readonly isFixture: boolean
  recognize(input: RecognitionInput): Promise<RecognitionResult>
}

import { fixtureRecognitionProvider } from "./fixture"
import { createHttpRecognitionProvider } from "./http"
import { createKimiVisionProvider, type VisionRecognitionProvider } from "./kimi"
import { resolveRecognitionConfig } from "../services/ai-settings"
import type { PrismaClient } from "@prisma/client"

export type RecognitionMode = "fixture" | "http" | "kimi"

/** 当前启用的识别形态（E2E 测试服务器强制 fixture；仅看环境变量） */
export function getRecognitionMode(env: NodeJS.ProcessEnv = process.env): RecognitionMode {
  if (env.E2E_MODE === "1") return "fixture"
  if (env.RECOGNITION_API_URL && env.RECOGNITION_API_KEY) return "http"
  if (env.MOONSHOT_API_KEY) return "kimi"
  return "fixture"
}

/** 解析识别形态（设置页保存的 Key 优先生效；环境变量 fallback） */
export async function resolveRecognitionMode(db: PrismaClient): Promise<RecognitionMode> {
  if (process.env.E2E_MODE === "1") return "fixture"
  if (process.env.RECOGNITION_API_URL && process.env.RECOGNITION_API_KEY) return "http"
  const config = await resolveRecognitionConfig(db).catch(() => null)
  return config?.apiKey ? "kimi" : "fixture"
}

export function getRecognitionProvider(): RecognitionProvider {
  const mode = getRecognitionMode()
  if (mode === "http") {
    return createHttpRecognitionProvider(process.env.RECOGNITION_API_URL!, process.env.RECOGNITION_API_KEY!)
  }
  return fixtureRecognitionProvider
}

/** Kimi 视觉 Provider（未配置 MOONSHOT_API_KEY 或 E2E 模式下返回 null；仅看环境变量） */
export function getVisionRecognitionProvider(): VisionRecognitionProvider | null {
  if (getRecognitionMode() !== "kimi") return null
  return createKimiVisionProvider(process.env.MOONSHOT_API_KEY!)
}

/** 解析 Kimi 视觉 Provider（设置页保存的 Key/模型优先；环境变量 fallback；保存后立即生效） */
export async function resolveVisionRecognitionProvider(db: PrismaClient): Promise<VisionRecognitionProvider | null> {
  if (process.env.E2E_MODE === "1") return null
  if (process.env.RECOGNITION_API_URL && process.env.RECOGNITION_API_KEY) return null // http 适配器优先
  const config = await resolveRecognitionConfig(db).catch(() => null)
  if (!config?.apiKey) return null
  return createKimiVisionProvider(config.apiKey, config.model, config.baseUrl)
}

export function isDemoRecognitionMode(): boolean {
  return getRecognitionMode() === "fixture"
}
