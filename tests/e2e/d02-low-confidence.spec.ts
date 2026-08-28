import { test, expect } from "@playwright/test"
import { setState, statValue } from "./helpers"

/**
 * D-02 低置信度或目录外图片不自动猜，保留上传状态并允许手动新增。
 */
test("D-02 低置信 3 候选不预选；目录外转手动新增", async ({ page, request }) => {
  await setState(request, "demo")

  // 低置信（0.60–0.89）：3 个候选，全部需要用户主动选择
  await page.goto("/add")
  await page.getByTestId("sample-box-zeta-glare-demo.svg").click()
  await expect(page.getByTestId("official-candidates")).toBeVisible({ timeout: 15_000 })
  const radios = page.getByRole("radio")
  await expect(radios).toHaveCount(3)
  // 识别主链路重构：不自动预选（禁止置信度自动命中）
  for (let i = 0; i < 3; i++) {
    await expect(radios.nth(i)).not.toBeChecked()
  }
  // 选择前：确认按钮为自定义收藏语义
  await expect(page.getByTestId("confirm-save")).toContainText("自定义收藏")

  // 用户主动选择后语义切换
  await page.getByRole("radio", { name: /Zeta/ }).check()
  await expect(page.getByTestId("confirm-save")).not.toContainText("自定义收藏")

  // 目录外图片：不自动猜，保留状态并直接提供手动录入
  // （官网资料闭环演进：无匹配时提示“未在目录与官网查询中找到匹配”+ Kimi 字段预填建立新收藏；转手动入口保留）
  await page.getByTestId("sample-box-unknown-demo.svg").click()
  await expect(page.getByTestId("no-official-result")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/未找到官网商品/)).toBeVisible()
  await page.getByTestId("no-candidate-manual").click()
  await expect(page.getByTestId("manual-entry-form")).toBeVisible()

  // 手动新增成功（自定义商品）
  await page.getByLabel("商品来源").selectOption("custom")
  await page.getByLabel("商品名").fill("Q5 Yermak Demo")
  await page.getByLabel("品牌").fill("Zvezda")
  await page.getByTestId("manual-submit").click()
  await expect(page.getByTestId("add-success")).toBeVisible()

  await page.goto("/")
  await expect(statValue(page, "stat-current")).toHaveText("8")
  await expect(statValue(page, "stat-sku")).toHaveText("8") // 新 SKU
})
