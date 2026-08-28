import { test, expect } from "@playwright/test"
import { setState } from "./helpers"

/**
 * D-03 已有同 SKU 时明确显示重复数量；确认后可新增第二件实体。
 */
test("D-03 重复 SKU 提示数量并可新增第二件", async ({ page, request }) => {
  await setState(request, "demo")

  await page.goto("/add")
  await page.getByTestId("sample-box-unicorn-demo.svg").click()
  await expect(page.getByTestId("official-candidates")).toBeVisible({ timeout: 15_000 })

  // 明确显示重复数量（重复提示文案）
  await expect(page.getByTestId("duplicate-warning-P03")).toContainText("已有 1 件该 SKU 实体")
  await expect(page.getByTestId("duplicate-warning-P03")).toContainText("新增第二件")

  // 选择候选后确认新增第二件（允许同款多件）
  await page.getByRole("radio", { name: /Unicorn/ }).check()
  await page.getByTestId("confirm-save").click()
  await expect(page).toHaveURL(/\/collection\/[A-Za-z0-9]+/, { timeout: 15_000 })

  // 收藏库中 P03 有两条实体记录
  await page.goto("/collection?product=P03")
  await expect(page.getByTestId("collection-count")).toContainText("共 2 条实体记录")
  const rows = page.getByTestId("collection-list").locator("li")
  await expect(rows).toHaveCount(2)
})
