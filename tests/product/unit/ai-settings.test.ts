import { describe, expect, it, beforeAll, afterAll, vi } from "vitest"
import { mkdtempSync, rmSync, statSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getTestDb, resetTestDb } from "../../helpers/db"
import { encryptSecret, decryptSecret, resetMasterKeyCache } from "@/lib/secrets"
import {
  getAiSettingsView,
  saveAiSettings,
  testProviderConnection,
  resolveRecognitionConfig,
  resolveAdviceConfig,
  DEFAULT_RECOGNITION_MODEL,
  DEFAULT_ADVICE_MODEL,
  DEFAULT_RECOGNITION_BASE_URL,
  DEFAULT_ADVICE_BASE_URL,
  normalizeBaseUrl,
  saveAiSettingsSchema,
} from "@/lib/services/ai-settings"

/**
 * AI 设置服务（/settings）：
 * - Key 服务端加密（AES-256-GCM，主密钥 0600 私有目录）；
 * - GET 只返回 configured 标志（write-only：不回显/预填/记录明文）；
 * - 空白保存保留旧 Key 与旧 Base URL；环境变量 fallback；模型/地址默认值；
 * - 按用途（拍照识别/收藏建议）配置，不绑定模型厂商：任意模型名 + Base URL + Key。
 */

let secretsDir: string

beforeAll(() => {
  secretsDir = mkdtempSync(path.join(tmpdir(), "ai-settings-secrets-"))
  process.env.SECRETS_DIR = secretsDir
  resetMasterKeyCache()
})

afterAll(() => {
  delete process.env.SECRETS_DIR
  resetMasterKeyCache()
  rmSync(secretsDir, { recursive: true, force: true })
})

describe("密钥加密", () => {
  it("AES-256-GCM 往返；密文不含明文", () => {
    const plaintext = "sk-test-plaintext-key-1234567890"
    const enc = encryptSecret(plaintext)
    expect(enc).not.toContain(plaintext)
    expect(enc.startsWith("v1.")).toBe(true)
    expect(decryptSecret(enc)).toBe(plaintext)
  })

  it("篡改密文解密失败（GCM 认证）", () => {
    const enc = encryptSecret("sk-test-abc")
    const parts = enc.split(".")
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]}.${"0".repeat(parts[3]!.length)}`
    expect(decryptSecret(tampered)).toBeNull()
  })

  it("主密钥文件 0600 且在 gitignored 私有目录", () => {
    encryptSecret("trigger-key-generation")
    const keyFile = path.join(secretsDir, "master.key")
    expect(existsSync(keyFile)).toBe(true)
    const mode = statSync(keyFile).mode & 0o777
    expect(mode).toBe(0o600)
  })
})

describe("设置保存与视图（真实 SQLite，按用途配置不绑定厂商）", () => {
  it("默认：环境变量 fallback + 默认模型与默认 API 地址", async () => {
    await resetTestDb()
    const db = getTestDb()
    const view = await getAiSettingsView(db)
    expect(view.recognition.model).toBe(DEFAULT_RECOGNITION_MODEL)
    expect(view.recognition.baseUrl).toBe(DEFAULT_RECOGNITION_BASE_URL)
    expect(view.advice.model).toBe(DEFAULT_ADVICE_MODEL)
    expect(view.advice.baseUrl).toBe(DEFAULT_ADVICE_BASE_URL)
    expect(view.recognition.configured).toBe(false) // 测试环境无 Key
    const resolved = await resolveRecognitionConfig(db)
    expect(resolved.apiKey).toBeNull()
    expect(resolved.source).toBe("none")
  })

  it("保存 Key：GET 只见 configured=true，明文绝不出现", async () => {
    await resetTestDb()
    const db = getTestDb()
    const dummy = "sk-test-dummy-never-real"
    const view = await saveAiSettings(db, { recognition: { apiKey: dummy } })
    expect(view.recognition.configured).toBe(true)
    // 视图序列化无明文
    expect(JSON.stringify(view)).not.toContain(dummy)
    // 数据库行是密文
    const row = await db.aiProviderConfig.findUnique({ where: { provider: "moonshot" } })
    expect(row?.apiKeyEnc).not.toContain(dummy)
    expect(row?.apiKeyEnc.startsWith("v1.")).toBe(true)
    // 解析立即生效（DB 优先）
    const resolved = await resolveRecognitionConfig(db)
    expect(resolved.apiKey).toBe(dummy)
    expect(resolved.source).toBe("db")
  })

  it("自定义厂商端点：任意模型名 + Base URL 保存并生效（不绑定厂商）", async () => {
    await resetTestDb()
    const db = getTestDb()
    await saveAiSettings(db, {
      recognition: { model: "qwen-vl-max", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", apiKey: "sk-custom-vendor" },
      advice: { model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1", apiKey: "sk-advice-openai" },
    })
    const view = await getAiSettingsView(db)
    expect(view.recognition.model).toBe("qwen-vl-max")
    expect(view.recognition.baseUrl).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1")
    expect(view.advice.model).toBe("gpt-4o-mini")
    expect(view.advice.baseUrl).toBe("https://api.openai.com/v1")
    const recognition = await resolveRecognitionConfig(db)
    expect(recognition.apiKey).toBe("sk-custom-vendor")
    expect(recognition.baseUrl).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1")
    const advice = await resolveAdviceConfig(db)
    expect(advice.apiKey).toBe("sk-advice-openai")
    expect(advice.baseUrl).toBe("https://api.openai.com/v1")
  })

  it("Base URL 规范化：尾斜杠去除、缺协议补 https://、空值回默认", () => {
    expect(normalizeBaseUrl("https://api.example.com/v1/", "https://fallback")).toBe("https://api.example.com/v1")
    expect(normalizeBaseUrl("api.example.com/v1", "https://fallback")).toBe("https://api.example.com/v1")
    expect(normalizeBaseUrl("  ", "https://fallback")).toBe("https://fallback")
    expect(normalizeBaseUrl(null, "https://fallback")).toBe("https://fallback")
  })

  it("空白保存保留旧 Key 与旧 Base URL（只改模型）", async () => {
    await resetTestDb()
    const db = getTestDb()
    await saveAiSettings(db, { advice: { apiKey: "sk-old-key", baseUrl: "https://api.old.com/v1" } })
    // 空白（undefined / 空串）保存：只改模型
    await saveAiSettings(db, { advice: { model: "some-model" } })
    await saveAiSettings(db, { advice: {} })
    const resolved = await resolveAdviceConfig(db)
    expect(resolved.apiKey).toBe("sk-old-key")
    expect(resolved.model).toBe("some-model")
    expect(resolved.baseUrl).toBe("https://api.old.com/v1")
  })

  it("模型修改持久化；删除 Key 不在契约内（Key 一旦保存只能覆盖）", async () => {
    await resetTestDb()
    const db = getTestDb()
    await saveAiSettings(db, { recognition: { model: "kimi-latest", apiKey: "sk-x" } })
    const view = await getAiSettingsView(db)
    expect(view.recognition.model).toBe("kimi-latest")
    expect(view.recognition.configured).toBe(true)
  })

  it("非法输入被 zod 拒绝（超长 Key/空模型名）", () => {
    expect(saveAiSettingsSchema.safeParse({ recognition: { apiKey: "x".repeat(5000) } }).success).toBe(false)
    expect(saveAiSettingsSchema.safeParse({ recognition: { model: "" } }).success).toBe(false)
    expect(saveAiSettingsSchema.safeParse({ recognition: { model: "kimi-k2.6" } }).success).toBe(true)
  })

  it("E2E 环境变量 Key 时 source=env（DB 优先于 env）", async () => {
    await resetTestDb()
    const db = getTestDb()
    const prev = process.env.MOONSHOT_API_KEY
    process.env.MOONSHOT_API_KEY = "sk-env-fallback"
    try {
      const resolved = await resolveRecognitionConfig(db)
      expect(resolved.apiKey).toBe("sk-env-fallback")
      expect(resolved.source).toBe("env")
      // DB 保存后覆盖 env
      await saveAiSettings(db, { recognition: { apiKey: "sk-db-override" } })
      const resolved2 = await resolveRecognitionConfig(db)
      expect(resolved2.apiKey).toBe("sk-db-override")
      expect(resolved2.source).toBe("db")
    } finally {
      if (prev === undefined) delete process.env.MOONSHOT_API_KEY
      else process.env.MOONSHOT_API_KEY = prev
    }
  })
})

describe("连接测试：表单当前值优先（未保存的模型名参与测试）", () => {
  it("未保存的自定义模型名出现在测试结果中（不是默认/已保存值）", async () => {
    await resetTestDb()
    const db = getTestDb()
    // 已保存：默认 kimi-k2.6；测试时表单填 deepseek-v4-flash-vision-exp → 结果显示用户所填
    const fetchMock = vi.fn(async (_url?: string | URL | Request) =>
      new Response(JSON.stringify({ data: [{ id: "deepseek-v4-flash-vision-exp" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const result = await testProviderConnection(db, "recognition", {
      model: "deepseek-v4-flash-vision-exp",
      apiKey: "sk-test-form-key",
    })
    expect(result.ok).toBe(true)
    expect(result.model).toBe("deepseek-v4-flash-vision-exp")
    expect(result.error).toBeNull()
    // 请求打的是用户所填模型所在端点（此处未改 baseUrl → 默认端点）
    const url = String(fetchMock.mock.calls[0]?.[0])
    expect(url).toContain("api.moonshot.cn/v1/models")
    vi.unstubAllGlobals()
  })

  it("表单自定义 API 地址参与测试；空白字段回退已保存配置", async () => {
    await resetTestDb()
    const db = getTestDb()
    await saveAiSettings(db, { advice: { apiKey: "sk-saved", model: "deepseek-v4-flash", baseUrl: "https://api.deepseek.com" } })
    const fetchMock = vi.fn(async (_url?: string | URL | Request) =>
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } }),
    )
    vi.stubGlobal("fetch", fetchMock)
    // 表单只填 baseUrl（model/apiKey 空白）→ 用已保存的 key/model + 表单地址
    const result = await testProviderConnection(db, "advice", { baseUrl: "https://api.other-vendor.com/v1" })
    expect(result.ok).toBe(true)
    expect(result.model).toBe("deepseek-v4-flash") // 已保存值
    const url = String(fetchMock.mock.calls[0]?.[0])
    expect(url).toContain("https://api.other-vendor.com/v1/models")
    vi.unstubAllGlobals()
  })

  it("表单 Key 覆盖已保存 Key（Authorization 用表单值）", async () => {
    await resetTestDb()
    const db = getTestDb()
    await saveAiSettings(db, { recognition: { apiKey: "sk-saved-old" } })
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      // 断言请求头用的是表单 Key
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-form-new")
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } })
    })
    vi.stubGlobal("fetch", fetchMock)
    const result = await testProviderConnection(db, "recognition", { apiKey: "sk-form-new" })
    expect(result.ok).toBe(true)
    vi.unstubAllGlobals()
  })
})
