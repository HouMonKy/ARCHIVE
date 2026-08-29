import { test, expect, type APIRequestContext, type Page } from "@playwright/test"

/**
 * 设置页（/settings，仅 Owner）E2E：
 * - Owner 可见入口与页面；Visitor 无按钮、页面跳回、API 403；未登录 401；
 * - Key write-only：GET 只返回 configured，不回显明文；密码框保存后清空；
 * - 空白保存保留旧 Key；模型修改持久化；
 * - 连接测试（E2E 环境无 Key → 安全错误摘要，不泄露内部信息）；
 * - 同源 CSRF：跨源 POST 403。
 */

const OWNER_SECRET = "product-e2e-owner"
const VISITOR_SECRET = "product-e2e-visitor"

async function login(page: Page, mode: "owner" | "demo", secret: string): Promise<void> {
  await page.goto("/login")
  const radio = mode === "owner" ? page.getByTestId("login-mode-owner") : page.getByTestId("login-mode-demo")
  await radio.check()
  await page.getByTestId("login-secret").fill(secret)
  await page.getByTestId("login-submit").click()
  await expect(page.getByTestId("logout-button")).toBeVisible({ timeout: 15_000 })
}

async function ownerLoginState(request: APIRequestContext): Promise<string> {
  const res = await request.post("/api/auth/login", {
    data: { mode: "owner", secret: OWNER_SECRET },
    headers: { origin: "http://127.0.0.1:3200" },
  })
  expect(res.ok()).toBeTruthy()
  const cookie = res.headers()["set-cookie"]?.split(";")[0]
  return cookie ?? ""
}

test("Owner：Header 有「设置」按钮，进入 /settings 可配置 Kimi/DeepSeek", async ({ page }) => {
  await login(page, "owner", OWNER_SECRET)
  await expect(page.getByTestId("settings-button")).toBeVisible()
  await page.getByTestId("settings-button").click()
  await expect(page).toHaveURL(/\/settings/)
  await expect(page.getByTestId("settings-recognition")).toBeVisible()
  await expect(page.getByTestId("settings-advice")).toBeVisible()
  await expect(page.getByTestId("recognition-model-input")).toHaveValue("kimi-k2.6")
  await expect(page.getByTestId("advice-model-input")).toHaveValue("deepseek-v4-flash")
  // Key 输入框为密码框（write-only）
  await expect(page.getByTestId("recognition-key-input")).toHaveAttribute("type", "password")
  await expect(page.getByTestId("advice-key-input")).toHaveAttribute("type", "password")
  // 不绑定厂商：两部分各含 模型名 + API 地址（OpenAI 兼容端点）+ Key 三项
  await expect(page.getByTestId("recognition-baseurl-input")).toHaveValue("https://api.moonshot.cn/v1")
  await expect(page.getByTestId("advice-baseurl-input")).toHaveValue("https://api.deepseek.com")
  await expect(page.getByText("任意 OpenAI 兼容的视觉模型均可（默认 Kimi）")).toBeVisible()
  await expect(page.getByText("任意 OpenAI 兼容的文本模型均可（默认 DeepSeek）")).toBeVisible()
})

test("Visitor：无设置按钮，直访 /settings 跳回，API 403", async ({ page, request }) => {
  await login(page, "demo", VISITOR_SECRET)
  await expect(page.getByTestId("settings-button")).toHaveCount(0)
  await page.goto("/settings")
  await expect(page).not.toHaveURL(/\/settings/)
  // API：Visitor 登录态 → 403（request 上下文需显式携带 Cookie）
  const loginRes = await request.post("/api/auth/login", {
    data: { mode: "demo", secret: VISITOR_SECRET },
    headers: { origin: "http://127.0.0.1:3200" },
  })
  expect(loginRes.ok()).toBeTruthy()
  const cookie = loginRes.headers()["set-cookie"]?.split(";")[0] ?? ""
  const res = await request.get("/api/settings", { headers: { cookie } })
  expect(res.status()).toBe(403)
})

test("未登录：GET /api/settings 401", async ({ request }) => {
  const res = await request.get("/api/settings")
  expect(res.status()).toBe(401)
})

test("GET 不回显 Key：仅 configured 标志；保存后密码框清空", async ({ page, request }) => {
  await login(page, "owner", OWNER_SECRET)
  const cookie = await ownerLoginState(request)
  // GET：无任何密钥字段
  const getRes = await request.get("/api/settings", { headers: { cookie } })
  expect(getRes.ok()).toBeTruthy()
  const body = await getRes.text()
  expect(body).not.toMatch(/sk-[A-Za-z0-9]{8,}/)
  expect(body).toContain("configured")

  await page.goto("/settings")
  // 保存一个 dummy Key + 自定义厂商端点（E2E 环境隔离；不代表任何真实密钥）
  await page.getByTestId("recognition-key-input").fill("sk-e2e-dummy-key-not-real")
  await page.getByTestId("recognition-baseurl-input").fill("https://api.example-vendor.com/v1")
  await page.getByTestId("settings-save").click()
  await expect(page.getByTestId("settings-saved")).toBeVisible()
  // 保存后密码框清空（write-only）；自定义端点持久化显示
  await expect(page.getByTestId("recognition-key-input")).toHaveValue("")
  await expect(page.getByTestId("recognition-baseurl-input")).toHaveValue("https://api.example-vendor.com/v1")
  // GET：configured=true 且响应中无明文
  const getRes2 = await request.get("/api/settings", { headers: { cookie } })
  const view = (await getRes2.json()) as { recognition: { configured: boolean; baseUrl: string } }
  expect(view.recognition.configured).toBe(true)
  expect(view.recognition.baseUrl).toBe("https://api.example-vendor.com/v1")
  const body2 = await getRes2.text()
  expect(body2).not.toContain("sk-e2e-dummy-key-not-real")
})

test("空白保存保留旧 Key 与旧 API 地址；模型修改持久化", async ({ page, request }) => {
  await login(page, "owner", OWNER_SECRET)
  const cookie = await ownerLoginState(request)
  // 先保存 dummy Key + 自定义端点
  await page.goto("/settings")
  await page.getByTestId("recognition-key-input").fill("sk-e2e-dummy-key-not-real")
  await page.getByTestId("recognition-baseurl-input").fill("https://api.example-vendor.com/v1")
  await page.getByTestId("settings-save").click()
  await expect(page.getByTestId("settings-saved")).toBeVisible()

  // 空白保存（只改模型）→ configured 仍为 true、端点保留
  await page.getByTestId("recognition-model-input").fill("kimi-k2.6")
  await page.getByTestId("settings-save").click()
  await expect(page.getByTestId("settings-saved")).toBeVisible()
  const res = await request.get("/api/settings", { headers: { cookie } })
  const view = (await res.json()) as { recognition: { configured: boolean; model: string; baseUrl: string } }
  expect(view.recognition.configured).toBe(true)
  expect(view.recognition.model).toBe("kimi-k2.6")
  expect(view.recognition.baseUrl).toBe("https://api.example-vendor.com/v1")

  // 刷新页面：模型与端点持久化（来自 DB），Key 框为空
  await page.goto("/settings")
  await expect(page.getByTestId("recognition-model-input")).toHaveValue("kimi-k2.6")
  await expect(page.getByTestId("recognition-baseurl-input")).toHaveValue("https://api.example-vendor.com/v1")
  await expect(page.getByTestId("recognition-key-input")).toHaveValue("")
})

test("连接测试：E2E 模式返回确定性结果（不执行真实网络连接）", async ({ request }) => {
  // 重置演示状态（清空测试中保存的 dummy 配置；会话保留）
  const reset = await request.post("/api/e2e/state", { data: { action: "demo" } })
  expect(reset.ok()).toBeTruthy()
  const cookie = await ownerLoginState(request)
  const res = await request.post("/api/settings/test", { headers: { cookie }, data: { provider: "advice" } })
  expect(res.ok()).toBeTruthy()
  const data = (await res.json()) as { ok: boolean; error: string | null }
  expect(data.ok).toBe(false)
  expect(data.error).toBe("E2E 模式不执行真实连接测试")
  expect(JSON.stringify(data)).not.toMatch(/sk-[A-Za-z0-9]{8,}/)
})

test("同源校验：跨源 POST /api/settings 403", async ({ request }) => {
  const cookie = await ownerLoginState(request)
  const res = await request.post("/api/settings", {
    headers: { cookie, origin: "https://evil.example.com" },
    data: { recognition: { model: "kimi-k2.6" } },
  })
  expect(res.status()).toBe(403)
})

test("Visitor 调用连接测试接口 403", async ({ request }) => {
  const res = await request.post("/api/auth/login", { data: { mode: "demo", secret: VISITOR_SECRET } })
  const cookie = res.headers()["set-cookie"]?.split(";")[0] ?? ""
  const res2 = await request.post("/api/settings/test", { headers: { cookie }, data: { provider: "recognition" } })
  expect(res2.status()).toBe(403)
})
