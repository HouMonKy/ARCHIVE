import { test, expect, type Page, type APIRequestContext } from "@playwright/test"
import { readFileSync } from "node:fs"

/**
 * 拍照识别全链路（返工轮任务 2/5，E2E 演示库 + Fixture）：
 * 「从相册选择」真实 JPEG 样例 → 预览（旋转/重拍）→ 识别 → Top-1 大卡
 * → 一键「确认加入收藏」→ 跳转新卡片（未开盒 + 封面）。
 * 生产 Owner 无 Key 不 Fixture、capture 属性、草稿恢复由产品单测/其他 E2E 覆盖。
 * 注意：本文件会产生实体/识别任务/封面——每个用例结束重置演示状态，不污染后续套件。
 */

const OWNER_SECRET = "product-e2e-owner"
const SAMPLE = "photo-sample.jpg"

async function login(page: Page): Promise<void> {
  await page.goto("/login")
  await page.getByTestId("login-mode-owner").check()
  await page.getByTestId("login-secret").fill(OWNER_SECRET)
  await page.getByTestId("login-submit").click()
  await expect(page.getByTestId("logout-button")).toBeVisible({ timeout: 15_000 })
}

async function resetDemoState(request: APIRequestContext): Promise<void> {
  const res = await request.post("/api/e2e/state", { data: { action: "demo" } })
  if (!res.ok()) throw new Error(`setState(demo) failed: ${res.status()}`)
}

test.afterEach(async ({ request }) => {
  await resetDemoState(request)
})

test("拍照入口：capture=environment 且 accept=image/*", async ({ page }) => {
  await login(page)
  await page.goto("/add")
  const capture = page.getByTestId("input-capture")
  await expect(capture).toHaveAttribute("capture", "environment")
  await expect(capture).toHaveAttribute("accept", "image/*")
  await expect(page.getByTestId("input-album")).toHaveAttribute("accept", "image/*")
})

test("照片上传→预览旋转→识别→一键确认→跳转新卡片（未开盒+封面）", async ({ page }) => {
  await login(page)
  await page.goto("/add")

  // 选择照片（模拟相册选择：直接对隐藏 input setInputFiles）
  await page.setInputFiles('[data-testid="input-album"]', { name: SAMPLE, mimeType: "image/jpeg", buffer: readFileSync("public/demo/samples/photo-sample.jpg") })
  await expect(page.getByTestId("photo-preview")).toBeVisible()
  await expect(page.getByTestId("photo-preview-img")).toBeVisible()

  // 预览可旋转（点击后角度文案变化）
  await page.getByTestId("rotate-photo").click()
  await expect(page.getByTestId("rotate-photo")).toContainText("90")

  // 开始识别 → AI 识别结果（原始提取可编辑）+ 候选 → 显式选择后确认
  await page.getByTestId("recognize-submit").click()
  await expect(page.getByTestId("ai-extraction-panel")).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId("ai-extraction-title")).toHaveText("AI 识别结果，请核对")
  await expect(page.getByTestId("top1-cover-thumb")).toBeVisible()
  await expect(page.getByTestId("official-candidates")).toBeVisible()
  await page.getByRole("radio", { name: /Unicorn/ }).check()
  await page.getByTestId("confirm-save").click()

  // 跳转到新卡片详情：默认未开盒 + 封面为本次照片
  await expect(page).toHaveURL(/\/collection\/[A-Za-z0-9]+/, { timeout: 15_000 })
  await expect(page.getByTestId("asset-name")).toBeVisible()
  const state = await page.getByTestId("fact-build-state").textContent()
  expect(state).toContain("未开盒")
  const cover = page.getByTestId("asset-cover")
  await expect(cover).toBeVisible()
  const coverSrc = await cover.getAttribute("src")
  expect(coverSrc).toMatch(/^\/api\/covers\//)
})

test("识别草稿：不自动替换上传首屏，提供可选「继续上次识别」入口", async ({ page }) => {
  await login(page)
  await page.goto("/add")
  // 触发一次识别但不确认
  await page.setInputFiles('[data-testid="input-album"]', { name: SAMPLE, mimeType: "image/jpeg", buffer: readFileSync("public/demo/samples/photo-sample.jpg") })
  await page.getByTestId("recognize-submit").click()
  await expect(page.getByTestId("ai-extraction-panel")).toBeVisible({ timeout: 20_000 })

  // 刷新：默认回到上传首屏（两个按钮立即可见），草稿只作可选入口
  await page.reload()
  await expect(page.getByTestId("button-capture")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("button-album")).toBeVisible()
  await expect(page.getByTestId("review-panel")).toHaveCount(0)

  // 继续上次识别：回到核对界面（AI 识别结果 + 候选显式选择）
  await page.getByTestId("continue-draft").click()
  await expect(page.getByTestId("ai-extraction-panel")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("confirm-save")).toBeVisible()
})

test("无候选旧草稿不隐藏上传入口（回归：首次进入立即可拍照/选相册）", async ({ page, request }) => {
  // 先重置演示状态（重置会级联清空会话，须在登录之前）
  await resetDemoState(request)
  await login(page)
  await page.goto("/add")
  // 无草稿状态：首屏两个按钮立即可见
  await expect(page.getByTestId("button-capture")).toBeVisible()
  await expect(page.getByTestId("button-album")).toBeVisible()
  await expect(page.getByTestId("continue-draft")).toHaveCount(0)
})

test("识别结果页（演示模式）：标题 + 原始提取可编辑 + 候选须显式选择 + 重搜按钮确定性返回", async ({ page }) => {
  await login(page)
  await page.goto("/add")
  await page.setInputFiles('[data-testid="input-album"]', { name: SAMPLE, mimeType: "image/jpeg", buffer: readFileSync("public/demo/samples/photo-sample.jpg") })
  await page.getByTestId("recognize-submit").click()

  // 标题严格为「AI 识别结果，请核对」；Kimi 原始提取（fixture 模拟）原样可见
  await expect(page.getByTestId("ai-extraction-title")).toHaveText("AI 识别结果，请核对")
  await expect(page.getByTestId("edit-name")).toHaveValue("MG Unicorn Gundam Ver.Ka")
  await expect(page.getByTestId("edit-brand")).toHaveValue("Bandai")
  await expect(page.getByTestId("edit-grade")).toHaveValue("MG")
  await expect(page.getByTestId("edit-scale")).toHaveValue("1/100")
  await expect(page.getByTestId("edit-model-number")).toHaveValue("RX-0")
  // 中文名称预填可编辑
  await expect(page.getByTestId("edit-name-zh")).not.toHaveValue("")
  await page.getByTestId("edit-name").fill("MG 独角兽高达 Ver.Ka")

  // 候选区与 AI 结果分开显示；候选不自动选择（radio 未选中）
  await expect(page.getByTestId("official-search-panel")).toBeVisible()
  const radio = page.getByRole("radio", { name: /Unicorn/ })
  await expect(radio).not.toBeChecked()

  // E2E 模式重搜：确定性返回不联网提示
  await page.getByTestId("re-search-official").click()
  await expect(page.getByTestId("no-official-result").or(page.getByTestId("official-candidates")).first()).toBeVisible({ timeout: 15_000 })
  const text = await page.locator("body").innerText()
  expect(text).not.toContain("古夫")
  expect(text).not.toContain("グフ")
})
