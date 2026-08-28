import { test, expect } from "@playwright/test"
import { setState, statValue } from "./helpers"

/**
 * D-04 将实体从未开盒改为制作中并填写进度后，详情与 Dashboard 同步更新。
 */
test("D-04 状态变更后详情与 Dashboard 同步", async ({ page, request }) => {
  await setState(request, "demo")

  // A03（RG ν Gundam）未开盒 → 制作中 40%
  await page.goto("/collection/A03")
  await expect(page.getByTestId("fact-build-state")).toHaveText("未开盒")
  await page.getByLabel("制作状态").selectOption("BUILDING")
  await page.getByLabel(/制作进度/).fill("40")
  await page.getByTestId("asset-save").click()
  await expect(page.getByTestId("edit-saved")).toBeVisible()

  // 详情同步
  await page.reload()
  await expect(page.getByTestId("fact-build-state")).toHaveText("制作中")
  await expect(page.getByTestId("fact-progress")).toHaveText("40%")

  // Dashboard 同步：制作中 2 件（A02 + A03），未开盒 1 件
  await page.goto("/")
  await expect(page.getByTestId("dist-build-state")).toContainText("制作中")
  await page.getByTestId("dist-build-state").getByRole("link", { name: /制作中/ }).click()
  await expect(page.getByTestId("collection-count")).toContainText("共 2 条实体记录")

  // 再改为已完成 → 完成率 33% → 50%（3/6）
  await page.goto("/collection/A03")
  await page.getByLabel("制作状态").selectOption("COMPLETED")
  await expect(page.getByText(/100%（切换为已完成时自动写入）/)).toBeVisible()
  await page.getByTestId("asset-save").click()
  await expect(page.getByTestId("edit-saved")).toBeVisible()

  await page.goto("/")
  await expect(statValue(page, "stat-completion")).toHaveText("50%（3/6）")
  await expect(statValue(page, "stat-completion")).toContainText("3/6")
})
