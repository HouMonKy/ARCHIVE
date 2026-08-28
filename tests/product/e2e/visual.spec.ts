import { test, expect } from "@playwright/test"

/**
 * 任务 4 视觉自评：390×844 与 1440×1000 双尺寸截图（保存至 test-results/shots/），
 * 并断言无横向溢出。截图供人工/模型走查；不进入 Git（test-results 已忽略）。
 * （截图工具返回的图片当前执行模型不可读——几何指标由 cabinet-grid.spec 的 DOM 断言锁定。）
 */
const PAGES = [
  { name: "dashboard", path: "/" },
  { name: "collection", path: "/collection" },
  { name: "detail", path: "/collection/A02" },
  { name: "add", path: "/add" },
  { name: "advice", path: "/advice" },
  { name: "login", path: "/login" },
]

const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "1440x1000", width: 1440, height: 1000 },
]

for (const viewport of VIEWPORTS) {
  test(`视觉截图 @${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    // 登录（E2E_AUTO_LOGIN=0，走真实登录路径）
    await page.goto("/login")
    await page.getByTestId("login-mode-owner").check()
    await page.getByTestId("login-secret").fill("product-e2e-owner")
    await page.getByTestId("login-submit").click()
    // logout-button 仅在会话建立后渲染；dashboard 需登录
    await expect(page.getByTestId("logout-button")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 15_000 })

    for (const target of PAGES) {
      await page.goto(target.path)
      await expect(page.locator("main")).toBeVisible()
      // 溢出断言：页面级横向溢出必须为 0
      const overflow = await page.evaluate(() => {
        const scroller = document.scrollingElement ?? document.documentElement
        return Math.max(0, scroller.scrollWidth - window.innerWidth)
      })
      expect(overflow, `${target.path} @${viewport.name} 横向溢出 ${overflow}px`).toBe(0)
      await page.screenshot({
        path: `test-results/shots/${target.name}@${viewport.name}.png`,
        fullPage: true,
      })
    }
  })
}
