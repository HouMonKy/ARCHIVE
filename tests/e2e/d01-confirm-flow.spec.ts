import { test, expect } from "@playwright/test"
import { setState, statValue } from "./helpers"

/**
 * D-01 清晰的受支持盒面图返回候选；未点击确认前收藏数量不变，确认后数量增加 1。
 * （识别主链路重构：候选不自动预选，须用户显式选择；确认后跳转新实体详情。）
 */
test("D-01 清晰盒面：候选显式选择 → 未确认不变 → 确认后 +1", async ({ page, context, request }) => {
  await setState(request, "demo")

  // 基线：当前收藏 7
  await page.goto("/")
  await expect(statValue(page, "stat-current")).toHaveText("7")

  // 上传演示样例（清晰盒面）
  await page.goto("/add")
  // 新需求：不再展示 RecognitionModeBadge
  await expect(page.getByTestId("recognition-mode-badge")).toHaveCount(0)
  await page.getByTestId("sample-box-unicorn-demo.svg").click()
  await expect(page.getByTestId("recognizing")).toBeVisible()
  await expect(page.getByTestId("official-candidates")).toBeVisible({ timeout: 15_000 })
  // AI 识别结果（原始提取）原样可见
  await expect(page.getByTestId("ai-extraction-title")).toHaveText("AI 识别结果，请核对")

  // 候选不自动预选（禁止置信度自动命中）——用户显式选择 P03
  const radio = page.getByRole("radio", { name: /Unicorn/ })
  await expect(radio).not.toBeChecked()
  await radio.check()
  await expect(radio).toBeChecked()

  // 未确认前：新开页面验证收藏数量不变
  const other = await context.newPage()
  await other.goto("/")
  await expect(statValue(other, "stat-current")).toHaveText("7")
  await other.close()

  // 确认入库（默认未开盒）→ 跳转新实体详情
  await page.getByTestId("confirm-save").click()
  await expect(page).toHaveURL(/\/collection\/[A-Za-z0-9]+/, { timeout: 15_000 })
  await expect(page.getByTestId("asset-name")).toBeVisible()
  await expect(page.getByTestId("fact-build-state")).toContainText("未开盒")

  // 确认后：数量 +1
  await page.goto("/")
  await expect(statValue(page, "stat-current")).toHaveText("8")
  await expect(statValue(page, "stat-sku")).toHaveText("7") // 同 SKU 第二件，SKU 数不变
})
