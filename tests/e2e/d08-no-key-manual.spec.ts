import { test, expect } from "@playwright/test"
import { setState, statValue } from "./helpers"

/**
 * D-08 没有 AI 密钥时产品仍可用；识别失败时手动新增仍成功。
 * 新需求：不再展示 RecognitionModeBadge（Header/Dashboard/添加页均无）。
 */
test("D-08 无密钥可用 + 无模式徽章 + 失败后手动新增", async ({ page, request }) => {
  await setState(request, "demo")

  await page.goto("/add")
  // 新需求：识别模式徽章不再展示（真实识别/演示识别文案均不可见）
  await expect(page.getByTestId("recognition-mode-badge")).toHaveCount(0)
  await expect(page.getByText("真实识别（Kimi")).toHaveCount(0)
  await expect(page.getByText("演示识别")).toHaveCount(0)

  // 识别超时（无密钥环境使用 Fixture，模拟失败）
  await page.getByTestId("sample-box-timeout-demo.svg").click()
  await expect(page.getByTestId("recognition-failed")).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId("recognition-failed")).toContainText("识别超时")
  await expect(page.getByTestId("retry-recognition")).toBeVisible()

  // 识别失败不阻塞手动新增
  await page.getByTestId("goto-manual").click()
  await expect(page.getByTestId("manual-entry-form")).toBeVisible()
  await page.getByLabel("目录商品").selectOption("P05")
  await page.getByLabel("制作状态").selectOption("UNOPENED")
  await page.getByLabel(/购入价/).fill("2400")
  await page.getByTestId("manual-submit").click()
  await expect(page.getByTestId("add-success")).toBeVisible()

  await page.goto("/")
  await expect(statValue(page, "stat-current")).toHaveText("8")
  await expect(statValue(page, "stat-cost")).toHaveText("¥6,120.00") // 3720 + 2400
})
