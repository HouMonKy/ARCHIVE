import { test, expect, type Page } from "@playwright/test"

/**
 * UI 与文字修复验收（任务 3）：
 * - 登录页只显示 Owner / Visitor（无说明段落）；
 * - 收藏柜预览「查看全部 N件 →」带真实数字（≥10 显示 10+）；
 * - 四个活动 Tab 文字/边框 #FFB000、背景 #211A0B（对比度 ≥4.5:1）；
 * - 被要求删除的文案（真实识别徽章、目录/投资判断/图片缓存/rights_basis 免责声明）
 *   在桌面与移动端渲染结果中均不存在。
 */

const OWNER_SECRET = "product-e2e-owner"

async function loginOwner(page: Page): Promise<void> {
  await page.goto("/login")
  await page.getByTestId("login-mode-owner").check()
  await page.getByTestId("login-secret").fill(OWNER_SECRET)
  await page.getByTestId("login-submit").click()
  await expect(page.getByTestId("logout-button")).toBeVisible({ timeout: 15_000 })
}

/** 被要求删除的可见内容（普通页面渲染 DOM 中必须为 0 命中） */
const BANNED_TEXTS = [
  "真实识别（Kimi kimi-k2.6）",
  "结构化提取 + 目录匹配",
  "目录仅收录 Bandai/LEGO 官方商品元数据",
  "不构成价格、二手行情或投资建议",
  "不构成价格或投资判断",
  "rights_basis",
  "本机私有缓存（rights_basis",
  "托管部署不打包、不存储、不热链官方图片",
]

async function auditBannedTexts(page: Page): Promise<void> {
  const body = await page.locator("body").innerText()
  for (const banned of BANNED_TEXTS) {
    expect(body, `页面不应出现被删除的文案：${banned}`).not.toContain(banned)
  }
}

test("登录页：只显示 Owner / Visitor，无身份说明段落", async ({ page }) => {
  await page.goto("/login")
  await expect(page.getByTestId("login-mode-owner")).toBeVisible()
  await expect(page.getByTestId("login-mode-demo")).toBeVisible()
  // 选项文字严格为 Owner / Visitor
  await expect(page.getByText("Owner", { exact: true })).toBeVisible()
  await expect(page.getByText("Visitor", { exact: true })).toBeVisible()
  // 无 Owner/访客说明段落
  const body = await page.locator("body").innerText()
  expect(body).not.toContain("进入完整收藏")
  expect(body).not.toContain("隔离沙箱")
  await auditBannedTexts(page)
})

test("Dashboard：收藏柜预览显示真实数量「查看全部 7件 →」（demo 7 件在库）", async ({ page }) => {
  await loginOwner(page)
  await page.goto("/")
  const link = page.getByTestId("cabinet-preview-all")
  await expect(link).toBeVisible()
  await expect(link).toContainText("查看全部 7件 →")
})

test("四个活动 Tab：文字橙色 #FFB000 + 深色底（对比度 ≥4.5:1）", async ({ page }) => {
  await loginOwner(page)
  await page.goto("/")
  const tabs = page.getByTestId("main-nav").locator("a")
  await expect(tabs).toHaveCount(4)

  // 逐页访问：当前活动 Tab 必须为橙色文字/边框 + 深色底
  for (const path of ["/", "/collection", "/add", "/advice"]) {
    await page.goto(path)
    const active = page.getByTestId("nav-tab-active")
    await expect(active).toHaveCount(1)
    const style = await active.evaluate((el) => {
      const s = window.getComputedStyle(el)
      return { color: s.color, bg: s.backgroundColor, borderColor: s.borderColor }
    })
    expect(style.color).toBe("rgb(255, 176, 0)") // #FFB000
    expect(style.borderColor).toBe("rgb(255, 176, 0)")
    expect(style.bg).toBe("rgb(33, 26, 11)") // #211A0B
    // 对比度（#FFB000 on #211A0B）
    const contrast = contrastRatio([255, 176, 0], [33, 26, 11])
    expect(contrast).toBeGreaterThanOrEqual(4.5)
  }
})

function contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
  const lum = (c: [number, number, number]) => {
    const f = (v: number) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
  }
  const l1 = lum(fg)
  const l2 = lum(bg)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

test("被删除的文案在桌面端（1440）各页面均不存在", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await loginOwner(page)
  for (const path of ["/", "/collection", "/add", "/advice", "/login"]) {
    await page.goto(path)
    await auditBannedTexts(page)
    // RecognitionModeBadge 不再渲染
    await expect(page.getByTestId("recognition-mode-badge")).toHaveCount(0)
  }
})

test("被删除的文案在移动端（390）各页面均不存在", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loginOwner(page)
  for (const path of ["/", "/collection", "/add", "/advice"]) {
    await page.goto(path)
    await auditBannedTexts(page)
  }
})

test("/add 首次进入立即出现拍照/相册按钮（桌面）", async ({ page }) => {
  await loginOwner(page)
  await page.goto("/add")
  await expect(page.getByTestId("button-capture")).toBeVisible()
  await expect(page.getByTestId("button-album")).toBeVisible()
  await expect(page.getByTestId("input-capture")).toHaveAttribute("capture", "environment")
  await expect(page.getByTestId("input-capture")).toHaveAttribute("accept", "image/*")
  await expect(page.getByTestId("input-album")).toHaveAttribute("accept", "image/*")
  await expect(page.getByTestId("input-album")).not.toHaveAttribute("capture", "environment")
  // 辅助文字：手机端调用相机，电脑端选择文件
  await expect(page.getByTestId("upload-hint")).toContainText("手机端调用相机，电脑端选择文件")
  // 两个按钮分别触发各自绑定的独立 input（真实 file chooser 事件）
  const [captureChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("button-capture").click(),
  ])
  expect(captureChooser.isMultiple()).toBe(false)
  await captureChooser.setFiles([]).catch(() => undefined)
  const [albumChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("button-album").click(),
  ])
  expect(albumChooser.isMultiple()).toBe(false)
})

test("/add 首次进入立即出现拍照/相册按钮（移动 390px）", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loginOwner(page)
  await page.goto("/add")
  await expect(page.getByTestId("button-capture")).toBeVisible()
  await expect(page.getByTestId("button-album")).toBeVisible()
  // 两个按钮均可见且在视口内（可点目标）
  for (const testid of ["button-capture", "button-album"]) {
    const box = await page.getByTestId(testid).boundingBox()
    expect(box).toBeTruthy()
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(844)
  }
  // 两个独立 input（不同 DOM 节点，各自绑定一个按钮）
  const distinctInputs = await page.evaluate(() => {
    const a = document.querySelector('[data-testid="input-capture"]')
    const b = document.querySelector('[data-testid="input-album"]')
    return a !== null && b !== null && a !== b
  })
  expect(distinctInputs).toBe(true)
  // 点击按钮分别触发各自 input 的文件选择器
  const [captureChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("button-capture").click(),
  ])
  await captureChooser.setFiles([]).catch(() => undefined)
  const [albumChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("button-album").click(),
  ])
  void albumChooser
})
