import { test, expect } from "@playwright/test"
import { setState } from "./helpers"

/**
 * D-07 建议所引用的商品/实体/来源均存在；“不感兴趣”后 30 天内不重复推荐。
 * （返工轮：建议页打开即自动刷新；文案演进为「收藏建议/新品动态」）
 */
test("D-07 引用可追溯 + 不感兴趣 30 天抑制", async ({ page, request }) => {
  await setState(request, "demo")
  await page.goto("/reports/latest")
  await expect(page.getByTestId("report-meta")).toBeVisible({ timeout: 20_000 })

  // 引用的商品/实体真实存在：推荐建议引用 P02；停滞建议引用 A02
  await expect(page.getByText("商品 P02")).toBeVisible()
  await expect(page.getByText("实体 A02")).toBeVisible()

  // 来源链接真实可访问且标注演示数据
  const sourceHref = await page.locator("[data-testid^='source-']").first().getAttribute("href")
  expect(sourceHref).toBe("/demo/sources/E01")
  const sourceRes = await request.get(sourceHref!)
  expect(sourceRes.ok()).toBe(true)
  expect(await sourceRes.text()).toContain("演示数据")

  // 建议里 P02 是首选推荐
  await expect(page.getByText("新品动态：MG Zeta Gundam Ver.Ka")).toBeVisible()

  // 标记“不感兴趣”
  const recInsight = page.locator("[data-testid^='insight-card-']").first()
  await recInsight.getByTestId(/^not-interested-/).click()
  await expect(recInsight.getByTestId(/^not-interested-/)).toContainText("已标记")

  // 前进 7 天（新周期）打开建议页自动刷新：P02 被抑制 30 天，P06 成为首选
  await setState(request, "setTime", "2026-09-01T00:00:00+08:00")
  await page.goto("/reports/latest")
  await expect(page.getByText("新品动态：HGUC Narrative Gundam C-Packs")).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText("新品动态：MG Zeta Gundam Ver.Ka")).toHaveCount(0)
  // 仍是每类最多一条，共 3 条
  await expect(page.locator("[data-testid^='insight-card-']")).toHaveCount(3)

  await setState(request, "demo")
})
