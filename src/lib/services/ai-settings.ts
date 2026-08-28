import type { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { encryptSecret, decryptSecret } from "../secrets"

/**
 * AI 服务设置（/settings，仅 Owner）——按用途配置，不绑定模型厂商：
 * - 「拍照识别」（recognition）：任意 OpenAI 兼容聊天补全 API 的模型名 + API Key + Base URL
 *   （默认 https://api.moonshot.cn/v1 + kimi-k2.6；可换成任意厂商的兼容端点）；
 * - 「收藏建议」（advice）：同上（默认 https://api.deepseek.com + deepseek-v4-flash）；
 * - Key 为 write-only：GET 只返回 configured: true/false，绝不回显/预填/记录明文；
 * - 保存后立即生效：resolveRecognitionConfig / resolveAdviceConfig 优先读库，环境变量 fallback；
 * - Key 服务端 AES-256-GCM 加密存储（AiProviderConfig.apiKeyEnc）；
 * - 空白保存 = 保留旧 Key。
 */

export const DEFAULT_RECOGNITION_MODEL = "kimi-k2.6"
export const DEFAULT_RECOGNITION_BASE_URL = "https://api.moonshot.cn/v1"
export const DEFAULT_ADVICE_MODEL = "deepseek-v4-flash"
export const DEFAULT_ADVICE_BASE_URL = "https://api.deepseek.com"

/**
 * 用途 ID（历史兼容：recognition 复用既有 moonshot 行、advice 复用既有 deepseek 行，
 * 老数据无需迁移即可继续生效）。
 */
export type AiProviderId = "recognition" | "advice"

export interface ProviderConfigView {
  provider: AiProviderId
  model: string
  baseUrl: string
  /** Key 是否已配置（DB 或环境变量）；永不返回明文 */
  configured: boolean
  /** 来源：db（设置页保存）/ env（环境变量）/ none */
  source: "db" | "env" | "none"
}

export interface AiSettingsView {
  /** 历史字段名（moonshot/deepseek）保留：等价于 recognition/advice，前端与测试平滑迁移 */
  recognition: ProviderConfigView
  advice: ProviderConfigView
}

interface ResolvedConfig {
  apiKey: string | null
  model: string
  baseUrl: string
  source: "db" | "env" | "none"
}

/** Base URL 规范化：去尾斜杠；缺协议补 https://；空值回默认 */
export function normalizeBaseUrl(raw: string | null | undefined, fallback: string): string {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "")
  if (!trimmed) return fallback
  if (/^https?:\/\//.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

/** DB 行 model 字段复用格式 "model|baseUrl"（同一行存两值，历史行无 | 时取默认 base） */
function splitModelField(rowModel: string | null | undefined, defaultBaseUrl: string): { model: string; baseUrl: string } {
  const raw = (rowModel ?? "").trim()
  if (!raw) return { model: "", baseUrl: defaultBaseUrl }
  const idx = raw.indexOf("|")
  if (idx < 0) return { model: raw, baseUrl: defaultBaseUrl }
  const model = raw.slice(0, idx).trim()
  const baseUrl = normalizeBaseUrl(raw.slice(idx + 1), defaultBaseUrl)
  return { model, baseUrl }
}

function joinModelField(model: string, baseUrl: string): string {
  return `${model}|${baseUrl}`
}

async function resolve(
  db: PrismaClient,
  provider: AiProviderId,
  env: { key: string | undefined; model: string | undefined; baseUrl: string | undefined },
  defaults: { model: string; baseUrl: string },
): Promise<ResolvedConfig> {
  const row = await db.aiProviderConfig.findUnique({ where: { provider: dbRowId(provider) } })
  if (row) {
    const apiKey = decryptSecret(row.apiKeyEnc)
    const { model: rowModel, baseUrl: rowBaseUrl } = splitModelField(row.model, defaults.baseUrl)
    if (apiKey) {
      return {
        apiKey,
        model: rowModel || env.model || defaults.model,
        baseUrl: rowBaseUrl,
        source: "db",
      }
    }
  }
  if (env.key) {
    return {
      apiKey: env.key,
      model: env.model || defaults.model,
      baseUrl: normalizeBaseUrl(env.baseUrl, defaults.baseUrl),
      source: "env",
    }
  }
  return { apiKey: null, model: env.model || defaults.model, baseUrl: normalizeBaseUrl(env.baseUrl, defaults.baseUrl), source: "none" }
}

/** DB 行 ID：recognition→moonshot（历史行）、advice→deepseek（历史行） */
function dbRowId(provider: AiProviderId): "moonshot" | "deepseek" {
  return provider === "recognition" ? "moonshot" : "deepseek"
}

/** 拍照识别：任意 OpenAI 兼容 API（默认 Moonshot Kimi；环境变量 MOONSHOT_API_KEY/KIMI_MODEL/KIMI_BASE_URL） */
export async function resolveRecognitionConfig(db: PrismaClient): Promise<ResolvedConfig> {
  return resolve(
    db,
    "recognition",
    { key: process.env.MOONSHOT_API_KEY, model: process.env.KIMI_MODEL, baseUrl: process.env.KIMI_BASE_URL },
    { model: DEFAULT_RECOGNITION_MODEL, baseUrl: DEFAULT_RECOGNITION_BASE_URL },
  )
}

/** 兼容别名（识别主链路历史调用名） */
export const resolveKimiConfig = resolveRecognitionConfig

/** 收藏建议：任意 OpenAI 兼容 API（默认 DeepSeek；环境变量 DEEPSEEK_API_KEY/DEEPSEEK_MODEL/DEEPSEEK_BASE_URL） */
export async function resolveAdviceConfig(db: PrismaClient): Promise<ResolvedConfig> {
  return resolve(
    db,
    "advice",
    { key: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL, baseUrl: process.env.DEEPSEEK_BASE_URL },
    { model: DEFAULT_ADVICE_MODEL, baseUrl: DEFAULT_ADVICE_BASE_URL },
  )
}

/** 兼容别名（周报润色历史调用名） */
export const resolveDeepSeekConfig = resolveAdviceConfig

/** GET 视图：只含模型名/Base URL 与 configured 标志，无任何密钥材料 */
export async function getAiSettingsView(db: PrismaClient): Promise<AiSettingsView> {
  const recognition = await resolveRecognitionConfig(db)
  const advice = await resolveAdviceConfig(db)
  return {
    recognition: { provider: "recognition", model: recognition.model, baseUrl: recognition.baseUrl, configured: Boolean(recognition.apiKey), source: recognition.source },
    advice: { provider: "advice", model: advice.model, baseUrl: advice.baseUrl, configured: Boolean(advice.apiKey), source: advice.source },
  }
}

const providerSettingsSchema = z.object({
  model: z.string().trim().min(1, "请填写模型名").max(120).optional(),
  baseUrl: z.string().trim().max(300).optional(),
  apiKey: z.string().max(4096).optional(), // 空串/undefined = 保留旧 Key
})

export const saveAiSettingsSchema = z.object({
  recognition: providerSettingsSchema.optional(),
  advice: providerSettingsSchema.optional(),
})

export type SaveAiSettingsInput = z.infer<typeof saveAiSettingsSchema>

async function saveProvider(
  db: PrismaClient,
  provider: AiProviderId,
  input: { model?: string; baseUrl?: string; apiKey?: string } | undefined,
  defaults: { model: string; baseUrl: string },
): Promise<void> {
  if (!input) return
  const rowId = dbRowId(provider)
  const existing = await db.aiProviderConfig.findUnique({ where: { provider: rowId } })
  const prev = splitModelField(existing?.model, defaults.baseUrl)
  // 合并语义：未提供的字段保留旧值（空白保存 = 保留旧 Key 与旧 Base URL）
  const model = input.model?.trim() || prev.model || defaults.model
  const baseUrl = input.baseUrl?.trim() ? normalizeBaseUrl(input.baseUrl, defaults.baseUrl) : prev.baseUrl
  const modelField = joinModelField(model, baseUrl)
  const blankKey = !input.apiKey || input.apiKey.trim() === ""
  if (blankKey && !existing) {
    // 没有旧 Key 可保留：仅当提供了模型名/Base URL 时建行（Key 为空密文占位，configured=false）
    if (input.model?.trim() || input.baseUrl?.trim()) {
      await db.aiProviderConfig.upsert({
        where: { provider: rowId },
        create: { provider: rowId, model: modelField, apiKeyEnc: encryptSecret("") },
        update: { model: modelField },
      })
    }
    return
  }
  const apiKeyEnc = blankKey ? existing!.apiKeyEnc : encryptSecret(input.apiKey!.trim())
  await db.aiProviderConfig.upsert({
    where: { provider: rowId },
    create: { provider: rowId, model: modelField, apiKeyEnc },
    update: { model: modelField, apiKeyEnc },
  })
}

export async function saveAiSettings(db: PrismaClient, input: SaveAiSettingsInput): Promise<AiSettingsView> {
  await saveProvider(db, "recognition", input.recognition, { model: DEFAULT_RECOGNITION_MODEL, baseUrl: DEFAULT_RECOGNITION_BASE_URL })
  await saveProvider(db, "advice", input.advice, { model: DEFAULT_ADVICE_MODEL, baseUrl: DEFAULT_ADVICE_BASE_URL })
  return getAiSettingsView(db)
}

export interface ConnectionTestResult {
  ok: boolean
  provider: AiProviderId
  model: string
  latencyMs: number
  /** 安全错误摘要（不含请求体/密钥/内部 URL 参数） */
  error: string | null
}

async function testModelsEndpoint(baseUrl: string, apiKey: string, timeoutMs = 15_000): Promise<{ ok: boolean; status: number; latencyMs: number; models: string[] }> {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })
    const latencyMs = Date.now() - started
    let models: string[] = []
    if (res.ok) {
      const json = (await res.json().catch(() => null)) as { data?: { id?: string }[] } | null
      models = (json?.data ?? []).map((m) => m.id ?? "").filter(Boolean)
    }
    return { ok: res.ok, status: res.status, latencyMs, models }
  } finally {
    clearTimeout(timer)
  }
}

/** 连接测试：只返回 成功/模型/耗时/安全错误摘要 */
export async function testProviderConnection(
  db: PrismaClient,
  provider: AiProviderId,
  /** 表单当前值（未保存）：非空时覆盖已保存配置参与测试——提示的模型名即用户所填 */
  overrides: { model?: string; baseUrl?: string; apiKey?: string } = {},
): Promise<ConnectionTestResult> {
  const config = provider === "recognition" ? await resolveRecognitionConfig(db) : await resolveAdviceConfig(db)
  // 覆盖优先级：表单非空值 > 已保存配置（表单空白 = 保留已保存值语义）
  const model = overrides.model?.trim() || config.model
  const baseUrl = overrides.baseUrl?.trim() ? normalizeBaseUrl(overrides.baseUrl, config.baseUrl) : config.baseUrl
  const apiKey = overrides.apiKey?.trim() || config.apiKey
  if (!apiKey) {
    return { ok: false, provider, model, latencyMs: 0, error: "未配置 API Key" }
  }
  try {
    const result = await testModelsEndpoint(baseUrl, apiKey)
    if (result.ok) {
      const modelOk = result.models.length === 0 || result.models.includes(model)
      return {
        ok: true,
        provider,
        model,
        latencyMs: result.latencyMs,
        error: modelOk ? null : `连接成功，但模型列表中未见 ${model}（可用模型 ${result.models.length} 个）`,
      }
    }
    const error =
      result.status === 401 || result.status === 403
        ? "认证失败（API Key 无效或无权限）"
        : result.status === 429
          ? "请求被限流，请稍后重试"
          : `服务返回 HTTP ${result.status}`
    return { ok: false, provider, model, latencyMs: result.latencyMs, error }
  } catch (e) {
    const aborted = e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")
    return { ok: false, provider, model, latencyMs: 0, error: aborted ? "连接超时" : "网络错误，无法连接服务" }
  }
}
