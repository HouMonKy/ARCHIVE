import { z } from "zod"
import { AppError } from "../errors"
import type { RecognitionProvider, RecognitionResult } from "./provider"

/**
 * 对外识别服务的边界适配器（非 Fixture）。
 * Demo 不内置任何真实端点：只有显式配置 RECOGNITION_API_URL 与 RECOGNITION_API_KEY 才会启用，
 * 且契约（发送内容摘要、返回候选 JSON Schema）需由内部服务实现。测试从不依赖此实现。
 */

const remoteResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        productId: z.string(),
        confidence: z.number().min(0).max(1),
        fieldConfidences: z.record(z.string(), z.number()).optional(),
      }),
    )
    .max(3),
})

const REMOTE_TIMEOUT_MS = 15_000

export function createHttpRecognitionProvider(baseUrl: string, apiKey: string): RecognitionProvider {
  return {
    name: "http",
    version: "adapter-v1",
    isFixture: false,
    async recognize(input): Promise<RecognitionResult> {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS)
      try {
        const res = await fetch(new URL("/recognize", baseUrl), {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            sha256: input.sha256,
            imageKind: input.imageKind,
            size: input.size,
            mimeType: input.mimeType,
          }),
          signal: controller.signal,
        })
        if (!res.ok) {
          return {
            state: "FAILED",
            candidates: [],
            errorCode: res.status >= 500 ? "PROVIDER_ERROR" : "PROVIDER_REJECTED",
            provider: "http",
            providerVersion: "adapter-v1",
            isFixture: false,
          }
        }
        const parsed = remoteResponseSchema.safeParse(await res.json())
        if (!parsed.success) {
          throw new AppError("识别服务返回了无法解析的结果", { status: 502, code: "PROVIDER_INVALID_RESPONSE" })
        }
        return {
          state: "SUCCEEDED",
          candidates: parsed.data.candidates,
          provider: "http",
          providerVersion: "adapter-v1",
          isFixture: false,
        }
      } catch (e) {
        if (e instanceof AppError) throw e
        const aborted = e instanceof Error && e.name === "AbortError"
        return {
          state: "FAILED",
          candidates: [],
          errorCode: aborted ? "TIMEOUT" : "PROVIDER_UNREACHABLE",
          provider: "http",
          providerVersion: "adapter-v1",
          isFixture: false,
        }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
