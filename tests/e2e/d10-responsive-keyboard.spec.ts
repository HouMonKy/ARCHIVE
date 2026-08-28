import { test, expect } from "@playwright/test"
import { setState, collectOverflow } from "./helpers"

/**
 * D-10 所有页面在 360px 与 1280px 下无横向溢出，键盘可完成新增和确认流程。
 * 溢出检查实现见 tests/e2e/helpers.ts 的 collectOverflow（逐可见元素边界检查）。
 */

const PAGES: { name: string; path: string }[] = [
  { name: "总览", path: "/" },
  { name: "收藏库", path: "/collection" },
  { name: "收藏详情", path: "/collection/A02" },
  { name: "添加页", path: "/add" },
  { name: "周报页", path: "/reports/latest" },
]

test("D-10a 360px 与 1280px：无元素超出视口、无页面级横向溢出", async ({ page, request }) => {
  await setState(request, "demo")
  for (const viewport of [{ width: 360, height: 740 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport)
    for (const target of PAGES) {
      await page.goto(target.path)
      await page.waitForLoadState("networkidle")
      const { offenders, scrollOverflow } = await collectOverflow(page)
      expect(
        offenders,
        `${target.name} ${target.path} @${viewport.width}px 有 ${offenders.length} 个元素超出视口：${JSON.stringify(offenders.slice(0, 5))}`,
      ).toHaveLength(0)
      expect(scrollOverflow, `${target.name} ${target.path} @${viewport.width}px 页面横向溢出 ${scrollOverflow}px`).toBe(0)
    }
  }
})

test("D-10b 键盘可完成手动新增流程", async ({ page, request }) => {
  await setState(request, "demo")
  await page.goto("/add?mode=manual")
  await expect(page.getByTestId("manual-entry-form")).toBeVisible()

  // 全键盘流程（无鼠标）：聚焦目录商品下拉 → 键入前缀选择 → 键入价格 → Enter 提交。
  // 说明：headless Chromium 中 select 的方向键不改变取值（macOS 原生选择器行为），
  // 故制作状态保持默认“未开盒”——这仍是合法的完整新增流程。
  const productSelect = page.getByLabel("目录商品")
  await productSelect.focus()
  await page.keyboard.type("RG") // typeahead 选中首个 RG 商品：RG ν Gundam
  await expect(productSelect).toHaveValue("P04")

  const price = page.getByLabel(/购入价/)
  await price.focus()
  await page.keyboard.type("320")

  const submit = page.getByTestId("manual-submit")
  await submit.focus()
  await page.keyboard.press("Enter")

  await expect(page.getByTestId("add-success")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("add-success")).toContainText("RG ν Gundam")
})

test("D-10c 键盘可完成识别确认流程", async ({ page, request }) => {
  await setState(request, "demo")
  await page.goto("/add")

  // 键盘触发样例上传
  const sample = page.getByTestId("sample-box-unicorn-demo.svg")
  await sample.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByTestId("official-candidates")).toBeVisible({ timeout: 15_000 })

  // 键盘选择候选（识别主链路重构：不自动预选）
  const radio = page.getByRole("radio", { name: /Unicorn/ })
  await radio.focus()
  await page.keyboard.press("Space")
  await expect(radio).toBeChecked()

  const price = page.getByLabel(/购入价/)
  await price.focus()
  await page.keyboard.type("1300")

  const confirm = page.getByTestId("confirm-save")
  await confirm.focus()
  await page.keyboard.press("Enter")

  await expect(page).toHaveURL(/\/collection\/[A-Za-z0-9]+/, { timeout: 15_000 })
  await expect(page.getByTestId("asset-name")).toBeVisible()
})
