import { test, expect, type APIRequestContext, type Page } from "@playwright/test"
import { readFileSync } from "node:fs"
import path from "node:path"

/**
 * 产品级 E2E（任务 5）：真实登录（E2E_AUTO_LOGIN=0）下的租户隔离、鉴权、
 * Demo 限额、CSRF、目录去重、AI 失败转手动、周报幂等、图片边界。
 * 识别在 E2E_MODE=1 下为 Fixture（不联网、确定性；样例按文件内容 SHA 匹配，
 * 故必须上传 public/demo/samples/ 的真实字节）。
 */

const OWNER_SECRET = "product-e2e-owner"
const DEMO_SECRET = "product-e2e-demo"
const SAMPLES_DIR = path.resolve(process.cwd(), "public/demo/samples")

function sampleFile(name: string): { name: string; mimeType: string; buffer: Buffer } {
  return { name, mimeType: "image/svg+xml", buffer: readFileSync(path.join(SAMPLES_DIR, name)) }
}

async function login(page: Page, mode: "owner" | "demo", secret: string): Promise<void> {
  await page.goto("/login")
  await page.getByTestId(`login-mode-${mode}`).check()
  await page.getByTestId("login-secret").fill(secret)
  await page.getByTestId("login-submit").click()
  await expect(page.getByTestId("logout-button")).toBeVisible({ timeout: 15_000 })
}

async function apiLogin(request: APIRequestContext, mode: "owner" | "demo", secret: string): Promise<string> {
  const res = await request.post("/api/auth/login", {
    data: { mode, secret },
    headers: { origin: "http://127.0.0.1:3200" },
  })
  expect(res.ok()).toBeTruthy()
  const setCookie = res.headers()["set-cookie"]!
  return setCookie.split(";")[0]!
}

test.describe("鉴权", () => {
  test("未登录访问受保护页面跳转 /login", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveURL(/\/login/)
    await page.goto("/collection")
    await expect(page).toHaveURL(/\/login/)
  })

  test("未登录调用写 API 返回 401", async ({ request }) => {
    const res = await request.post("/api/assets", {
      data: {},
      headers: { origin: "http://127.0.0.1:3200" },
    })
    expect(res.status()).toBe(401)
    const body = (await res.json()) as { code?: string }
    expect(body.code).toBe("UNAUTHENTICATED")
  })

  test("跨站写请求被 CSRF 防护拒绝（403）", async ({ request }) => {
    const cookie = await apiLogin(request, "owner", OWNER_SECRET)
    const res = await request.post("/api/assets", {
      data: {},
      headers: { origin: "https://evil.example", cookie },
    })
    expect(res.status()).toBe(403)
    const body = (await res.json()) as { code?: string }
    expect(body.code).toBe("CSRF_REJECTED")
  })

  test("错误密码拒绝且不建立会话", async ({ page }) => {
    await page.goto("/login")
    await page.getByTestId("login-mode-owner").check()
    await page.getByTestId("login-secret").fill("wrong-password")
    await page.getByTestId("login-submit").click()
    await expect(page.getByTestId("login-error")).toContainText("凭据不正确")
    await page.goto("/")
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe("租户隔离", () => {
  test("Demo 沙箱与 Owner 数据完全隔离（双向）", async ({ page, request }) => {
    // Owner 视角：演示数据 7 件在藏
    await login(page, "owner", OWNER_SECRET)
    await page.goto("/")
    await expect(page.getByTestId("stat-current").locator("dd").first()).toHaveText("7")

    // Demo 登录：空沙箱
    await page.getByTestId("logout-button").click()
    await expect(page).toHaveURL(/\/login/)
    await login(page, "demo", DEMO_SECRET)
    await page.goto("/")
    await expect(page.getByTestId("empty-state")).toBeVisible()
    await page.goto("/collection")
    // 空列表渲染 EmptyState（collection-count 仅在有记录时出现）
    await expect(page.getByTestId("empty-state").first()).toBeVisible()

    // Demo 手动新增一件 → Demo 可见
    const demoCookie = await apiLogin(request, "demo", DEMO_SECRET)
    const create = await request.post("/api/assets", {
      data: {
        productId: "P01",
        buildState: "UNOPENED",
        idempotencyKey: `demo-e2e-${Date.now()}`,
        purchasePrice: { minor: 10000, currency: "CNY" },
      },
      headers: { origin: "http://127.0.0.1:3200", cookie: demoCookie },
    })
    expect(create.status()).toBe(201)
    await page.goto("/collection")
    await expect(page.getByTestId("collection-count")).toContainText("共 1 条实体记录")

    // 切回 Owner：仍是 7 件（看不到 Demo 的实体）
    await page.getByTestId("logout-button").click()
    await login(page, "owner", OWNER_SECRET)
    await page.goto("/collection")
    await expect(page.getByTestId("collection-count")).toContainText("共 7 条实体记录")
  })
})

test.describe("Demo 每日限额", () => {
  test("识别 3 次/日：第 4 次返回 429", async ({ request }) => {
    const cookie = await apiLogin(request, "demo", DEMO_SECRET)
    const samples = [
      "box-unicorn-demo.svg",
      "box-zeta-glare-demo.svg",
      "box-unknown-demo.svg",
      "box-timeout-demo.svg",
    ]
    const statuses: number[] = []
    for (const sample of samples) {
      const res = await request.post("/api/recognition", {
        multipart: { file: sampleFile(sample) },
        headers: { origin: "http://127.0.0.1:3200", cookie },
      })
      statuses.push(res.status())
    }
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200])
    expect(statuses[3]).toBe(429)
    const fourth = await request.post("/api/recognition", {
      multipart: { file: sampleFile("box-unicorn-demo.svg") },
      headers: { origin: "http://127.0.0.1:3200", cookie },
    })
    expect(fourth.status()).toBe(429)
    const body = (await fourth.json()) as { code?: string; error?: string }
    expect(body.code).toBe("DEMO_QUOTA_EXCEEDED")
  })

  test("周报 1 次/日：第 2 次返回 429", async ({ request }) => {
    const cookie = await apiLogin(request, "demo", DEMO_SECRET)
    // 补足 3 件解锁周报
    for (let i = 0; i < 3; i++) {
      await request.post("/api/assets", {
        data: { productId: "P01", buildState: "UNOPENED", idempotencyKey: `demo-report-e2e-${i}-${Date.now()}` },
        headers: { origin: "http://127.0.0.1:3200", cookie },
      })
    }
    const first = await request.post("/api/reports/generate", {
      headers: { origin: "http://127.0.0.1:3200", cookie },
    })
    expect(first.ok()).toBeTruthy()
    const second = await request.post("/api/reports/generate", {
      headers: { origin: "http://127.0.0.1:3200", cookie },
    })
    expect(second.status()).toBe(429)
    const body = (await second.json()) as { code?: string }
    expect(body.code).toBe("DEMO_QUOTA_EXCEEDED")
  })
})

test.describe("目录与幂等", () => {
  test("目录去重：同 SKU 第二件独立入库；同幂等键不重复", async ({ request }) => {
    const cookie = await apiLogin(request, "owner", OWNER_SECRET)
    const key = `dedup-e2e-${Date.now()}`
    const first = await request.post("/api/assets", {
      data: { productId: "P05", buildState: "UNOPENED", idempotencyKey: key },
      headers: { origin: "http://127.0.0.1:3200", cookie },
    })
    expect(first.status()).toBe(201)
    expect((await first.json()).created).toBe(true)
    // 同幂等键重放：幂等返回
    const replay = await request.post("/api/assets", {
      data: { productId: "P05", buildState: "UNOPENED", idempotencyKey: key },
      headers: { origin: "http://127.0.0.1:3200", cookie },
    })
    expect(replay.status()).toBe(200)
    expect((await replay.json()).created).toBe(false)
    // 不同幂等键同 SKU：第二件
    const second = await request.post("/api/assets", {
      data: { productId: "P05", buildState: "OPENED", idempotencyKey: `${key}-2` },
      headers: { origin: "http://127.0.0.1:3200", cookie },
    })
    expect(second.status()).toBe(201)
    expect((await second.json()).created).toBe(true)
  })

  test("周报幂等：同周期重复生成只保留一期", async ({ request }) => {
    const cookie = await apiLogin(request, "owner", OWNER_SECRET)
    const first = (await (await request.post("/api/reports/generate", {
      headers: { origin: "http://127.0.0.1:3200", cookie },
    })).json()) as { created: boolean; reportId: string }
    const second = (await (await request.post("/api/reports/generate", {
      headers: { origin: "http://127.0.0.1:3200", cookie },
    })).json()) as { created: boolean; reportId: string }
    // 首次可能由 Dashboard 首访自动生成 → created false；重放必为 false 且同一 reportId
    expect(second.created).toBe(false)
    expect(second.reportId).toBe(first.reportId)
  })
})

test.describe("AI 失败与图片边界", () => {
  test("识别失败（Fixture 超时样例）返回明确错误，不阻塞手动新增", async ({ request }) => {
    const cookie = await apiLogin(request, "owner", OWNER_SECRET)
    const res = await request.post("/api/recognition", {
      multipart: { file: sampleFile("box-timeout-demo.svg") },
      headers: { origin: "http://127.0.0.1:3200", cookie },
    })
    expect(res.status()).toBe(200)
    const body = (await res.json()) as { state: string; errorCode: string | null; message: string }
    expect(body.state).toBe("FAILED")
    expect(body.errorCode).toBe("TIMEOUT")
    expect(body.message).toContain("超时")
    // 手动路径不受影响
    const manual = await request.post("/api/assets", {
      data: { productId: "P09", buildState: "UNOPENED", idempotencyKey: `manual-e2e-${Date.now()}` },
      headers: { origin: "http://127.0.0.1:3200", cookie },
    })
    expect([200, 201]).toContain(manual.status())
  })

  test("图片路由：未知编码返回占位图；缓存图带本机私用标记头（托管版改占位的边界锚点）", async ({ request }) => {
    const unknown = await request.get("/api/demo-images/UNKNOWN-9999")
    expect(unknown.status()).toBe(200)
    expect(unknown.headers()["x-image-provenance"]).toBe("fallback")
    expect(unknown.headers()["content-type"]).toBe("image/svg+xml")
    const cached = await request.get("/api/demo-images/P02")
    expect(cached.status()).toBe(200)
    expect(["local-private-cache", "fallback"]).toContain(cached.headers()["x-image-provenance"])
  })
})
