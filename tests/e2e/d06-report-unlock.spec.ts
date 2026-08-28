import { test, expect } from "@playwright/test"
import { setState } from "./helpers"

/**
 * D-06 少于 3 件确认收藏时不生成个性化建议；达到门槛后生成不超过 3 条。
 * （返工轮：建议页打开即自动刷新，无需手动点击；文案演进为「收藏建议」）
 */
test("D-06 建议解锁门槛与最多 3 条建议", async ({ page, request }) => {
  // 少于 3 件：只展示解锁说明
  await setState(request, "minimal")
  await page.goto("/reports/latest")
  const locked = page.getByTestId("report-locked")
  await expect(locked).toBeVisible()
  await expect(locked).toContainText("3 件")
  await expect(locked).toContainText("还差 1 件")
  await expect(page.getByTestId("generate-report")).toHaveCount(0)

  // 达到门槛：打开建议页自动刷新，不超过 3 条
  await setState(request, "demo")
  await page.goto("/reports/latest")
  await expect(page.getByTestId("report-locked")).toHaveCount(0)
  await expect(page.getByTestId("report-meta")).toBeVisible({ timeout: 20_000 })
  const insightItems = page.locator("[data-testid^='insight-card-']")
  await expect(insightItems).toHaveCount(3)

  // 三类建议各一条：新品动态 / 制作推进 / 结构补全
  await expect(page.getByText("新品动态：MG Zeta Gundam Ver.Ka")).toBeVisible()
  await expect(page.getByText("制作推进：MGEX Unicorn Gundam Ver.Ka 已 24 天无进展")).toBeVisible()
  await expect(page.getByText(/路线补齐：制作完成率/)).toBeVisible()
})
