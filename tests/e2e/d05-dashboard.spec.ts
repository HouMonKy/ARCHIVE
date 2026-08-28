import { test, expect } from "@playwright/test"
import { setState, statValue } from "./helpers"

/**
 * D-05 Dashboard 对 8 条固定种子数据算出确定的数量、成本、缺价数和完成率，图表可下钻。
 */
test("D-05 固定数据的确定统计与下钻", async ({ page, request }) => {
  await setState(request, "demo")
  await page.goto("/")

  // 5 个核心统计的确定数字
  await expect(statValue(page, "stat-current")).toHaveText("7")
  await expect(statValue(page, "stat-sku")).toHaveText("7")
  await expect(statValue(page, "stat-cost")).toHaveText("¥3,720.00")
  await expect(page.getByTestId("stat-cost")).toContainText("缺价 1 件")
  await expect(statValue(page, "stat-completion")).toHaveText("33%（2/6）")
  await expect(statValue(page, "stat-stalled")).toHaveText("1")
  await expect(page.getByTestId("stat-current")).toContainText("实体总记录 8 条")

  // 品牌分布 Bandai 6 / LEGO 1
  const brandDist = page.getByTestId("dist-brand")
  await expect(brandDist.getByRole("link", { name: /Bandai/ })).toContainText("6 件")
  await expect(brandDist.getByRole("link", { name: /LEGO/ })).toContainText("1 件")

  // 下钻：品牌 Bandai → 收藏列表 6 条
  await brandDist.getByRole("link", { name: /Bandai/ }).click()
  await expect(page).toHaveURL(/\/collection\?brand=Bandai/)
  await expect(page.getByTestId("collection-count")).toContainText("共 6 条实体记录")

  // 下钻：等级 MG → 2 条
  await page.goto("/")
  await page.getByTestId("dist-grade").getByRole("link", { name: "MG 2 件，查看收藏列表" }).click()
  await expect(page.getByTestId("collection-count")).toContainText("共 2 条实体记录")

  // 下钻：制作状态 已完成 → 2 条
  await page.goto("/")
  await page.getByTestId("dist-build-state").getByRole("link", { name: /已完成/ }).click()
  await expect(page.getByTestId("collection-count")).toContainText("共 2 条实体记录")
})
