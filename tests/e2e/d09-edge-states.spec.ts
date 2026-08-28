import { test, expect } from "@playwright/test"
import { setState } from "./helpers"

/**
 * D-09 空收藏、无新品、超时、损坏文件和 10MB 以上文件均有可恢复的明确反馈。
 */
test("D-09 空收藏、无新品、损坏与超限文件的明确反馈", async ({ page, request }) => {
  // 空收藏：空态 + 两个入口
  await setState(request, "empty")
  await page.goto("/")
  const empty = page.getByTestId("empty-state")
  await expect(empty).toBeVisible()
  await expect(page.getByTestId("empty-upload-cta")).toBeVisible()
  await expect(page.getByTestId("empty-manual-cta")).toBeVisible()

  // 无新品事件：打开建议页自动刷新后明确“暂无新品动态”，不编造推荐
  await setState(request, "noEvents")
  await page.goto("/reports/latest")
  await expect(page.getByTestId("no-recommendation-notice")).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId("no-recommendation-notice")).toContainText("暂无新品动态")
  // 不编造推荐：无任何「新品动态」类洞察卡（提示语含冒号，用洞察卡过滤断言）
  await expect(page.locator("[data-testid^='insight-card-']").filter({ hasText: "新品动态" })).toHaveCount(0)

  // 损坏文件（扩展名 png、文件头非法）：明确反馈 + 手动出口
  // （返工轮：上传入口改为「从相册选择」大按钮 → 预览 → 开始识别；业务断言不变）
  await setState(request, "demo")
  await page.goto("/add")
  await page.setInputFiles('[data-testid="input-album"]', {
    name: "corrupt.png",
    mimeType: "image/png",
    buffer: Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]),
  })
  await expect(page.getByTestId("photo-preview")).toBeVisible()
  await page.getByTestId("recognize-submit").click()
  await expect(page.getByTestId("error-banner")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("error-banner")).toContainText("损坏")
  await expect(page.getByTestId("goto-manual")).toBeVisible()

  // 超过 10MB 的文件：选择时即拦截（失败后已回到选择步骤）
  await page.setInputFiles('[data-testid="input-album"]', {
    name: "oversize.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.alloc(10 * 1024 * 1024 + 128, 1),
  })
  await expect(page.getByTestId("error-banner")).toContainText("10MB")

  // 识别超时：可恢复反馈（重试 + 手动）
  await page.getByTestId("sample-box-timeout-demo.svg").click()
  await expect(page.getByTestId("recognition-failed")).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId("retry-recognition")).toBeVisible()
  await expect(page.getByTestId("goto-manual")).toBeVisible()
})
