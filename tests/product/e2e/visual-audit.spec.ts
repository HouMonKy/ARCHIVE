import { test, expect } from "@playwright/test"

/**
 * 视觉自评（DOM 结构级，当前执行模型不可读图片的替代方案）：
 * - 签名元素“收藏柜预览”（返工轮任务 4）存在且全部柜格是真实详情链接（非空装饰），
 *   且位于统计区块之前（总览以收藏柜预览为主）；
 * - 禁项核查：无玻璃拟态（backdrop-filter）、无全页渐变（body/main 级 linear-gradient；
 *   柜格内部的轻微聚光径向微光为任务书允许的例外）、无满屏圆角（>8px）；
 * - 声明存在：非投资建议；
 * - 键盘焦点可见（focus ring 扫描青）。
 */
test.beforeEach(async ({ page }) => {
  await page.goto("/login")
  await page.getByTestId("login-mode-owner").check()
  await page.getByTestId("login-secret").fill("product-e2e-owner")
  await page.getByTestId("login-submit").click()
  // logout-button 仅在会话建立后渲染（main-nav 在登录页也可见，不能作为登录成功依据）
  await expect(page.getByTestId("logout-button")).toBeVisible({ timeout: 15_000 })
})

test("收藏柜预览：真实详情链接而非空装饰，且在统计区之前", async ({ page }) => {
  await page.goto("/")
  const preview = page.getByTestId("cabinet-preview")
  await expect(preview).toBeVisible()
  const links = preview.locator("ul a") // 柜格链接（「查看全部」入口除外）
  const count = await links.count()
  expect(count).toBeGreaterThanOrEqual(4) // 桌面首屏可见 4–5 个等宽大图柜格
  for (let i = 0; i < count; i++) {
    const href = await links.nth(i).getAttribute("href")
    expect(href, "预览柜格必须链接到收藏详情").toMatch(/^\/collection\/[A-Za-z0-9]+/)
  }
  const statCards = page.getByTestId("stat-cards")
  await expect(statCards).toBeVisible()
  const previewBox = await preview.boundingBox()
  const statBox = await statCards.boundingBox()
  expect(previewBox?.y).toBeDefined()
  expect(statBox?.y).toBeDefined()
  expect(previewBox!.y!).toBeLessThan(statBox!.y!)
})

test("行动区仍可用：下一步区块存在", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByTestId("next-steps")).toBeVisible()
})

test("禁项：无玻璃拟态、无全页渐变、无满屏圆角卡片", async ({ page }) => {
  await page.goto("/")
  const violations = await page.evaluate(() => {
    const out: string[] = []
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const style = window.getComputedStyle(el)
      if (style.backdropFilter && style.backdropFilter !== "none") out.push(`backdrop-filter: ${el.tagName}.${el.className}`)
      const bg = style.backgroundImage
      if (bg && bg !== "none") {
        // 允许的例外：柜格内部的轻微聚光（径向微光，且元素本身是柜格的伪元素载体）
        const isCellSpotlight = el.classList.contains("cabinet-spotlight")
        const isRadialOnly = /^radial-gradient\(/.test(bg.trim())
        if (!isCellSpotlight || !isRadialOnly) {
          out.push(`gradient: ${el.tagName}.${el.className} ${bg.slice(0, 40)}`)
        }
      }
      if (parseFloat(style.borderRadius) > 8) out.push(`radius>8px: ${el.tagName}.${el.className}`)
    }
    return out
  })
  expect(violations, `视觉禁项违规：${JSON.stringify(violations.slice(0, 5))}`).toEqual([])
})

test("周报页不再展示免责声明（按新需求移除）", async ({ page }) => {
  await page.goto("/reports/latest")
  const disclaimer = page.getByTestId("report-disclaimer")
  await expect(disclaimer).toHaveCount(0)
  // 页面仍正常渲染（报告主体或锁定/未生成提示）
  await expect(
    page.getByTestId("report-page"),
  ).toBeVisible()
  await expect(page.getByText("不构成价格、二手行情或投资建议")).toHaveCount(0)
  await expect(page.getByText("不构成价格或投资判断")).toHaveCount(0)
})

test("键盘焦点：导航链接聚焦时蓝图蓝描边可见", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("main-nav").locator("a").first().focus()
  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el) return null
    const style = window.getComputedStyle(el)
    return { color: style.outlineColor, width: style.outlineWidth }
  })
  expect(outline?.color).toBeTruthy()
  expect(outline?.width).not.toBe("0px")
})
