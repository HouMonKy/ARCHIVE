import { test, expect, type Page } from "@playwright/test"

/**
 * 收藏建议（返工轮任务 3）：
 * - 旧 /reports/latest 永久重定向到 /advice；
 * - 全站渲染 DOM 中「周报 / 洞察 / 本周报告」命中 0（统一叫收藏建议）；
 * - 建议页显示生成时间与来源（新需求：不显示原因代码/匹配分）。
 */
const OWNER_SECRET = "product-e2e-owner"

async function login(page: Page): Promise<void> {
  await page.goto("/login")
  await page.getByTestId("login-mode-owner").check()
  await page.getByTestId("login-secret").fill(OWNER_SECRET)
  await page.getByTestId("login-submit").click()
  await expect(page.getByTestId("logout-button")).toBeVisible({ timeout: 15_000 })
}
const PAGES: { name: string; path: string }[] = [
  { name: "dashboard", path: "/" },
  { name: "collection", path: "/collection" },
  { name: "add", path: "/add" },
  { name: "advice", path: "/advice" },
]

test("旧 /reports/latest 永久重定向到 /advice", async ({ page }) => {
  await login(page)
  const res = await page.goto("/reports/latest")
  expect(res?.status()).toBe(200) // 重定向后最终响应
  await expect(page).toHaveURL(/\/advice$/)
})

for (const { name, path } of PAGES) {
  test(`命名统一：${name} 页渲染 DOM 中「周报/洞察/本周报告」命中 0`, async ({ page }) => {
    await login(page)
    await page.goto(path)
    const hits = await page.evaluate(() => {
      const banned = /周报|洞察|本周报告/
      const walk = (node: Node): string[] => {
        const out: string[] = []
        for (const child of node.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            const text = child.textContent ?? ""
            if (banned.test(text)) out.push(text.trim().slice(0, 60))
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            const el = child as Element
            // 脚本/样式不参与渲染
            if (el.tagName === "SCRIPT" || el.tagName === "STYLE") continue
            out.push(...walk(el))
          }
        }
        return out
      }
      return walk(document.body)
    })
    expect(hits, `禁止词命中：${JSON.stringify(hits)}`).toHaveLength(0)
  })
}

const BRAND_BANNED_PAGES: { name: string; path: string }[] = [
  { name: "dashboard", path: "/" },
  { name: "collection", path: "/collection" },
  { name: "add", path: "/add" },
  { name: "advice", path: "/advice" },
  { name: "login", path: "/login" },
]

for (const { name, path } of BRAND_BANNED_PAGES) {
  test(`ARCHIVE 品牌唯一：${name} 页渲染 DOM 中「Model Base/WORKBENCH/HANGAR/ACCESS CONTROL」命中 0`, async ({ page }) => {
    await page.goto(path)
    const hits = await page.evaluate(() => {
      const banned = /Model Base|MODEL BASE|WORKBENCH|HANGAR|ACCESS CONTROL/
      const walk = (node: Node): string[] => {
        const out: string[] = []
        for (const child of node.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            const text = child.textContent ?? ""
            if (banned.test(text)) out.push(text.trim().slice(0, 60))
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            const el = child as Element
            if (el.tagName === "SCRIPT" || el.tagName === "STYLE") continue
            out.push(...walk(el))
          }
        }
        return out
      }
      return walk(document.documentElement)
    })
    expect(hits, `旧品牌词命中：${JSON.stringify(hits)}`).toHaveLength(0)
  })
}

test("收藏建议页：生成时间 / 来源可见；原因代码与匹配分不显示", async ({ page }) => {
  await login(page)
  // Owner 首次打开自动刷新（demo 库固定 8 件 → 已解锁）
  await page.goto("/advice")
  await expect(page.getByTestId("report-meta")).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId("report-meta")).toContainText("生成时间")
  await expect(page.getByTestId("report-meta")).toContainText("自动刷新")
  const cards = page.locator("[data-testid^='insight-card-']")
  const count = await cards.count()
  if (count > 0) {
    const first = cards.first()
    // 新需求：不显示原因代码与匹配分
    await expect(first.getByText(/原因：/)).toHaveCount(0)
    await expect(page.getByText(/SCORE|匹配分/)).toHaveCount(0)
    await expect(first.locator("[data-testid^='source-']")).toBeVisible()
  }
})
