import { test, expect, type Page } from "@playwright/test"

/**
 * 收藏柜几何（返工轮任务 4）：
 * - Grid 列数断点：≥1280px 5 列、1024–1279 4 列、768–1023 3 列、<768 2 列；间距 16px；
 * - 卡片上方 4:3 大图，桌面（≥1280）图高 ≥190px；
 * - 等宽柜格（同一行内柜格宽度两两相等，容差 1px）。
 */

const OWNER_SECRET = "product-e2e-owner"

async function login(page: Page): Promise<void> {
  await page.goto("/login")
  await page.getByTestId("login-mode-owner").check()
  await page.getByTestId("login-secret").fill(OWNER_SECRET)
  await page.getByTestId("login-submit").click()
  await expect(page.getByTestId("logout-button")).toBeVisible({ timeout: 15_000 })
}

interface GridGeometry {
  columns: number
  gap: number
  cellWidths: number[]
  imageHeights: number[]
  imageRatios: number[]
}

async function readGridGeometry(page: Page): Promise<GridGeometry> {
  return page.evaluate(() => {
    // 分区货架：取第一个渲染分区的网格（各分区共享同一 Grid 类，几何一致）
    const grid = document.querySelector('[data-testid^="cabinet-grid-"]') as HTMLElement | null
    if (!grid) throw new Error("cabinet-grid-* 不存在")
    const style = window.getComputedStyle(grid)
    const columns = style.gridTemplateColumns.split(" ").filter(Boolean).length
    const gap = parseFloat(style.columnGap || style.gap || "0")
    const cells = Array.from(grid.querySelectorAll<HTMLElement>(":scope > li > a"))
    const cellWidths = cells.map((c) => c.getBoundingClientRect().width)
    const imgs = cells.map((c) => c.querySelector("img") ?? c.querySelector('[aria-hidden]'))
    const imageHeights = imgs.map((img) => (img as HTMLElement).getBoundingClientRect().height)
    const imageRatios = cells.map((c) => {
      const box = c.querySelector<HTMLElement>(":scope > div")
      if (!box) return 0
      const r = box.getBoundingClientRect()
      return r.width / r.height
    })
    return { columns, gap, cellWidths, imageHeights, imageRatios }
  })
}

for (const viewport of [
  { name: "1440x1000（≥1280 → 5 列）", width: 1440, height: 1000, expectCols: 5 },
  { name: "1280x900（≥1280 → 5 列）", width: 1280, height: 900, expectCols: 5 },
  { name: "1100x900（1024–1279 → 4 列）", width: 1100, height: 900, expectCols: 4 },
  { name: "900x900（768–1023 → 3 列）", width: 900, height: 900, expectCols: 3 },
  { name: "600x900（<768 → 2 列）", width: 600, height: 900, expectCols: 2 },
  { name: "390x844（<768 → 2 列）", width: 390, height: 844, expectCols: 2 },
]) {
  test(`收藏柜 Grid @${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await login(page)
    await page.goto("/collection")
    await expect(page.locator('[data-testid^="cabinet-grid-"]').first()).toBeVisible()
    const geo = await readGridGeometry(page)
    expect(geo.columns, `${viewport.name} 列数`).toBe(viewport.expectCols)
    expect(geo.gap, "间距 16px").toBe(16)
    // 等宽柜格：同一尺寸下所有柜格宽度一致（容差 1px）
    const widths = new Set(geo.cellWidths.map((w) => Math.round(w)))
    expect(widths.size, `柜格应等宽，实际宽度：${geo.cellWidths.join(",")}`).toBe(1)
    // 4:3 大图（≥1440 时 4:3 主导；1024–1439 区间 190px 最小高可能放宽比例）
    if (viewport.width >= 1440) {
      for (const ratio of geo.imageRatios) {
        expect(Math.abs(ratio - 4 / 3), "卡片上方 4:3 大图").toBeLessThan(0.05)
      }
    }
    // 桌面（≥1024）图高 ≥190px
    if (viewport.width >= 1024) {
      for (const h of geo.imageHeights) {
        expect(h, `桌面柜格图高应 ≥190px（实际 ${h}px）`).toBeGreaterThanOrEqual(190)
      }
    }
  })
}

test("总览首屏：1440px 下收藏柜预览可见 4–5 个等宽大图柜格", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await login(page)
  await page.goto("/")
  const preview = page.getByTestId("cabinet-preview")
  await expect(preview).toBeVisible()
  const geo = await page.evaluate(() => {
    // 分区预览：任一分区的首个网格（各分区同几何）取列数；首屏柜格跨分区汇总
    const grid = document.querySelector('[data-testid^="preview-section-"] ul') as HTMLElement
    const style = window.getComputedStyle(grid)
    const allLis = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="preview-section-"] ul > li'))
    const inViewport = allLis.filter((li) => {
      const box = li.getBoundingClientRect()
      return box.top >= 0 && box.top < window.innerHeight
    })
    // 分区货架首屏：视口内每行柜格等宽；取最长的一行作为首屏主行（LEGO/GUNDAM 分区行数不一）
    const rows = new Map<number, HTMLElement[]>()
    for (const li of inViewport) {
      const top = Math.round(li.getBoundingClientRect().top / 4) * 4
      const list = rows.get(top) ?? []
      list.push(li)
      rows.set(top, list)
    }
    const visible = [...rows.values()].sort((a, b) => b.length - a.length)[0] ?? []
    const widths = visible.map((li) => li.getBoundingClientRect().width)
    const equal = new Set(widths.map((w) => Math.round(w))).size <= 1
    return {
      columns: style.gridTemplateColumns.split(" ").filter(Boolean).length,
      firstScreenCells: visible.length,
      widths,
      equalWidths: equal,
      withImages: visible.filter((li) => li.querySelector("img")).length,
    }
  })
  expect(geo.columns).toBe(5)
  expect(geo.firstScreenCells, "首屏可见柜格数").toBeGreaterThanOrEqual(4)
  expect(geo.firstScreenCells).toBeLessThanOrEqual(5)
  expect(geo.equalWidths, `首屏柜格应等宽：${geo.widths.join(",")}`).toBe(true)
  expect(geo.withImages, "首屏柜格均为大图柜格").toBe(geo.firstScreenCells)
})
