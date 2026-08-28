"use client"

import { useState } from "react"
import type { AiSettingsView, ConnectionTestResult } from "@/lib/services/ai-settings"
import { ErrorBanner } from "@/components/ui"

/**
 * 设置表单（仅 Owner）——按用途配置，不绑定模型厂商：
 * - 「拍照识别」「收藏建议」两块，各自可配 任意 OpenAI 兼容 API 的
 *   模型名 + API Base URL + API Key（默认值分别为 Kimi/DeepSeek 端点，可随意替换）；
 * - API Key 为 write-only 密码框：GET 永不回显；空白保存 = 保留旧 Key；
 * - 「测试连接」只显示 成功/模型/耗时/安全错误摘要；
 * - 保存后立即生效。
 */
export function SettingsForm({ initial }: { initial: AiSettingsView }) {
  const [recognitionModel, setRecognitionModel] = useState(initial.recognition.model)
  const [recognitionBaseUrl, setRecognitionBaseUrl] = useState(initial.recognition.baseUrl)
  const [recognitionKey, setRecognitionKey] = useState("")
  const [adviceModel, setAdviceModel] = useState(initial.advice.model)
  const [adviceBaseUrl, setAdviceBaseUrl] = useState(initial.advice.baseUrl)
  const [adviceKey, setAdviceKey] = useState("")
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState<"recognition" | "advice" | null>(null)
  const [testResults, setTestResults] = useState<Record<string, ConnectionTestResult>>({})

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recognition: { model: recognitionModel, baseUrl: recognitionBaseUrl, apiKey: recognitionKey },
          advice: { model: adviceModel, baseUrl: adviceBaseUrl, apiKey: adviceKey },
        }),
      })
      const data = (await res.json()) as AiSettingsView & { error?: string }
      if (!res.ok) {
        setError(data.error ?? "保存失败")
        return
      }
      setRecognitionModel(data.recognition.model)
      setRecognitionBaseUrl(data.recognition.baseUrl)
      setAdviceModel(data.advice.model)
      setAdviceBaseUrl(data.advice.baseUrl)
      // Key 框保存后清空（write-only：绝不预填）
      setRecognitionKey("")
      setAdviceKey("")
      setSavedAt(new Date().toLocaleTimeString("zh-CN"))
    } catch {
      setError("网络异常，请重试")
    } finally {
      setSaving(false)
    }
  }

  async function testConnection(provider: "recognition" | "advice") {
    setTesting(provider)
    setError(null)
    try {
      // 测试连接带上表单当前值（未保存的模型名/API 地址/Key 也参与测试——
      // 测试成功提示的模型名即用户所填，而不是已保存的旧值）
      const form =
        provider === "recognition"
          ? { model: recognitionModel, baseUrl: recognitionBaseUrl, apiKey: recognitionKey }
          : { model: adviceModel, baseUrl: adviceBaseUrl, apiKey: adviceKey }
      const res = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, ...form }),
      })
      const data = (await res.json()) as ConnectionTestResult & { error?: string }
      if (!res.ok) {
        setTestResults((prev) => ({ ...prev, [provider]: { ok: false, provider, model: "", latencyMs: 0, error: data.error ?? "测试失败" } }))
        return
      }
      setTestResults((prev) => ({ ...prev, [provider]: data }))
    } catch {
      setTestResults((prev) => ({ ...prev, [provider]: { ok: false, provider, model: "", latencyMs: 0, error: "网络异常" } }))
    } finally {
      setTesting(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* —— 拍照识别 —— */}
      <section className="mb-card space-y-3 p-4" data-testid="settings-recognition">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">拍照识别</h2>
          <span className="mb-badge" data-testid="recognition-configured">
            {initial.recognition.configured ? "已配置 Key" : "未配置 Key"}
            {initial.recognition.source === "env" ? "（环境变量）" : initial.recognition.source === "db" ? "（已保存）" : ""}
          </span>
        </div>
        <p className="text-xs text-[color:var(--ink-50)]">
          任意 OpenAI 兼容的视觉模型均可（默认 Kimi）；填模型名、API 地址与 Key 即可。联网搜索（官网商品查证）自动适配：Moonshot 端点用其内置搜索，其他端点走 Responses API web_search。
        </p>
        <label className="block">
          <span className="mb-label">模型名</span>
          <input
            className="mb-input"
            value={recognitionModel}
            onChange={(e) => setRecognitionModel(e.target.value)}
            placeholder="kimi-k2.6"
            data-testid="recognition-model-input"
          />
        </label>
        <label className="block">
          <span className="mb-label">API 地址（OpenAI 兼容端点）</span>
          <input
            className="mb-input"
            value={recognitionBaseUrl}
            onChange={(e) => setRecognitionBaseUrl(e.target.value)}
            placeholder="https://api.moonshot.cn/v1"
            data-testid="recognition-baseurl-input"
          />
        </label>
        <label className="block">
          <span className="mb-label">API Key（仅写入，不回显；留空 = 保留已保存的 Key）</span>
          <input
            className="mb-input"
            type="password"
            autoComplete="new-password"
            value={recognitionKey}
            onChange={(e) => setRecognitionKey(e.target.value)}
            placeholder={initial.recognition.configured ? "已保存（留空保持不变）" : "sk-…"}
            data-testid="recognition-key-input"
          />
        </label>
        <button
          type="button"
          className="mb-btn mb-btn-secondary"
          disabled={testing !== null}
          onClick={() => void testConnection("recognition")}
          data-testid="recognition-test-button"
        >
          {testing === "recognition" ? "测试中…" : "测试连接"}
        </button>
        {testResults.recognition && (
          <p className="text-xs" data-testid="recognition-test-result" style={{ color: testResults.recognition.ok ? "var(--success)" : "var(--signal)" }}>
            {testResults.recognition.ok
              ? `连接成功 · 模型 ${testResults.recognition.model} · ${testResults.recognition.latencyMs}ms${testResults.recognition.error ? ` · ${testResults.recognition.error}` : ""}`
              : `连接失败：${testResults.recognition.error ?? "未知错误"}`}
          </p>
        )}
      </section>

      {/* —— 收藏建议 —— */}
      <section className="mb-card space-y-3 p-4" data-testid="settings-advice">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">收藏建议</h2>
          <span className="mb-badge" data-testid="advice-configured">
            {initial.advice.configured ? "已配置 Key" : "未配置 Key"}
            {initial.advice.source === "env" ? "（环境变量）" : initial.advice.source === "db" ? "（已保存）" : ""}
          </span>
        </div>
        <p className="text-xs text-[color:var(--ink-50)]">
          任意 OpenAI 兼容的文本模型均可（默认 DeepSeek）；填模型名、API 地址与 Key 即可。新品动态的联网检索自动适配端点（DeepSeek 等 Responses API / Moonshot 内置搜索）。
        </p>
        <label className="block">
          <span className="mb-label">模型名</span>
          <input
            className="mb-input"
            value={adviceModel}
            onChange={(e) => setAdviceModel(e.target.value)}
            placeholder="deepseek-v4-flash"
            data-testid="advice-model-input"
          />
        </label>
        <label className="block">
          <span className="mb-label">API 地址（OpenAI 兼容端点）</span>
          <input
            className="mb-input"
            value={adviceBaseUrl}
            onChange={(e) => setAdviceBaseUrl(e.target.value)}
            placeholder="https://api.deepseek.com"
            data-testid="advice-baseurl-input"
          />
        </label>
        <label className="block">
          <span className="mb-label">API Key（仅写入，不回显；留空 = 保留已保存的 Key）</span>
          <input
            className="mb-input"
            type="password"
            autoComplete="new-password"
            value={adviceKey}
            onChange={(e) => setAdviceKey(e.target.value)}
            placeholder={initial.advice.configured ? "已保存（留空保持不变）" : "sk-…"}
            data-testid="advice-key-input"
          />
        </label>
        <button
          type="button"
          className="mb-btn mb-btn-secondary"
          disabled={testing !== null}
          onClick={() => void testConnection("advice")}
          data-testid="advice-test-button"
        >
          {testing === "advice" ? "测试中…" : "测试连接"}
        </button>
        {testResults.advice && (
          <p className="text-xs" data-testid="advice-test-result" style={{ color: testResults.advice.ok ? "var(--success)" : "var(--signal)" }}>
            {testResults.advice.ok
              ? `连接成功 · 模型 ${testResults.advice.model} · ${testResults.advice.latencyMs}ms`
              : `连接失败：${testResults.advice.error ?? "未知错误"}`}
          </p>
        )}
      </section>

      {error && <ErrorBanner message={error} />}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="mb-btn mb-btn-primary" disabled={saving} onClick={() => void save()} data-testid="settings-save">
          {saving ? "保存中…" : "保存设置"}
        </button>
        {savedAt && (
          <span className="text-xs" style={{ color: "var(--success)" }} data-testid="settings-saved">
            已保存（{savedAt}），立即生效
          </span>
        )}
      </div>
    </div>
  )
}
