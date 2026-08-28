import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { RECOGNITION_SAMPLES } from "../demo-dataset"
import { sha256Hex } from "../validation"
import type { RecognitionProvider, RecognitionResult } from "./provider"

/**
 * 内置 Fixture 演示识别（provider=fixture，必须显著标识“演示识别”）。
 * 依据上传内容的 SHA-256 匹配 PRD §19 固定样例；未命中样例的一律返回无候选，
 * 绝不虚构识别结果。二进制图片不落盘、不入库。
 */

const SAMPLES_DIR = path.resolve(process.cwd(), "public/demo/samples")

let sampleHashMap: Map<string, (typeof RECOGNITION_SAMPLES)[number]> | null = null

export function getKnownDemoSampleHashes(): ReadonlySet<string> {
  return new Set(getSampleHashMap().keys())
}

function getSampleHashMap(): Map<string, (typeof RECOGNITION_SAMPLES)[number]> {
  if (sampleHashMap) return sampleHashMap
  const map = new Map<string, (typeof RECOGNITION_SAMPLES)[number]>()
  for (const sample of RECOGNITION_SAMPLES) {
    const file = path.join(SAMPLES_DIR, sample.fileName)
    if (!existsSync(file)) continue
    const bytes = new Uint8Array(readFileSync(file))
    map.set(sha256Hex(bytes), sample)
  }
  sampleHashMap = map
  return map
}

const SIMULATED_LATENCY_MS = 600

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const fixtureRecognitionProvider: RecognitionProvider = {
  name: "fixture",
  version: "demo-v1",
  isFixture: true,
  async recognize(input): Promise<RecognitionResult> {
    await delay(SIMULATED_LATENCY_MS)
    const sample = getSampleHashMap().get(input.sha256)
    const base = { provider: "fixture", providerVersion: "demo-v1", isFixture: true } as const
    if (!sample) {
      // 目录外 / 低置信：不猜，交由手动录入
      return { state: "SUCCEEDED", candidates: [], ...base }
    }
    if (sample.errorCode) {
      return { state: "FAILED", candidates: [], errorCode: sample.errorCode, ...base }
    }
    return {
      state: "SUCCEEDED",
      candidates: sample.candidates.map((c) => ({
        productId: c.productId,
        confidence: c.confidence,
        fieldConfidences: sample.fieldConfidences,
      })),
      extraction: sample.extraction ?? undefined,
      ...base,
    }
  },
}
