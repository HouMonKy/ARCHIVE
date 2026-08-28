import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { getRecognitionProvider, isDemoRecognitionMode } from "@/lib/ai/provider"

/**
 * Provider 标识（返工任务 3）：必须反映实际启用的 Fixture 或 HTTP Provider。
 * Demo 默认无密钥 → Fixture；显式配置 RECOGNITION_API_URL/KEY → HTTP 适配器。
 * 界面标识（RecognitionModeBadge）由服务端按同一函数计算，测试不依赖网络。
 */
describe("识别 Provider 选择与标识", () => {
  const originalUrl = process.env.RECOGNITION_API_URL
  const originalKey = process.env.RECOGNITION_API_KEY
  // 旧套件整体运行在 E2E_MODE=1（固定演示时钟）；本文件验证的是“真实运行形态选择”，
  // 必须脱离 E2E 强制 fixture 才能覆盖 http/kimi 分支（仅环境隔离，不动断言）
  const originalE2eMode = process.env.E2E_MODE

  beforeEach(() => {
    delete process.env.RECOGNITION_API_URL
    delete process.env.RECOGNITION_API_KEY
    delete process.env.E2E_MODE
  })

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.RECOGNITION_API_URL
    else process.env.RECOGNITION_API_URL = originalUrl
    if (originalKey === undefined) delete process.env.RECOGNITION_API_KEY
    else process.env.RECOGNITION_API_KEY = originalKey
    if (originalE2eMode === undefined) delete process.env.E2E_MODE
    else process.env.E2E_MODE = originalE2eMode
  })

  it("无密钥：Fixture Provider + 演示模式标识为 true", () => {
    const provider = getRecognitionProvider()
    expect(provider.name).toBe("fixture")
    expect(provider.isFixture).toBe(true)
    expect(isDemoRecognitionMode()).toBe(true)
  })

  it("配置 URL+KEY：切换为 HTTP Provider，演示模式标识为 false", () => {
    process.env.RECOGNITION_API_URL = "https://recognition.internal.example/v1"
    process.env.RECOGNITION_API_KEY = "test-key"
    const provider = getRecognitionProvider()
    expect(provider.name).toBe("http")
    expect(provider.isFixture).toBe(false)
    expect(isDemoRecognitionMode()).toBe(false)
  })

  it("仅配置 URL（缺 KEY）：仍为 Fixture（不半启用外部服务）", () => {
    process.env.RECOGNITION_API_URL = "https://recognition.internal.example/v1"
    const provider = getRecognitionProvider()
    expect(provider.name).toBe("fixture")
    expect(isDemoRecognitionMode()).toBe(true)
  })
})
