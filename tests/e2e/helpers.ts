import type { Page, APIRequestContext } from "@playwright/test"

/** E2E 演练状态控制（仅 E2E_MODE=1 服务器可用） */
export async function setState(request: APIRequestContext, action: string, iso?: string): Promise<void> {
  const res = await request.post("/api/e2e/state", { data: { action, iso } })
  if (!res.ok()) {
    throw new Error(`setState(${action}) failed: ${res.status()} ${await res.text()}`)
  }
}

/** 读取 Dashboard 核心统计卡数值（第一个 dd） */
export function statValue(page: Page, testId: string) {
  return page.getByTestId(testId).locator("dd").first()
}

export interface OverflowOffender {
  tag: string
  testid: string | null
  cls: string
  left: number
  right: number
  text: string
}

/**
 * 逐可见元素检查视口边界（返工强化，不依赖 body overflow:hidden 与单一 scrollWidth）：
 * - 任何可见元素 rect.left < 0 或 rect.right > viewport 都算溢出；
 * - 横向滚动容器（overflow-x: auto/scroll，如主导航）内部内容属于合法滚动，予以豁免；
 * - 同时返回页面级 scrollWidth 溢出量（双保险）。
 */
export async function collectOverflow(page: Page): Promise<{ offenders: OverflowOffender[]; scrollOverflow: number }> {
  const viewportWidth = page.viewportSize()?.width ?? 0
  return page.evaluate((vw) => {
    const offenders: {
      tag: string
      testid: string | null
      cls: string
      left: number
      right: number
      text: string
    }[] = []
    const isVisible = (el: Element): boolean => {
      const style = window.getComputedStyle(el)
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false
      const rect = el.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }
    const inHorizontalScrollContainer = (el: Element): boolean => {
      let node = el.parentElement
      while (node && node !== document.body) {
        const style = window.getComputedStyle(node)
        if (style.overflowX === "auto" || style.overflowX === "scroll") return true
        node = node.parentElement
      }
      return false
    }
    const tol = 0.5 // 亚像素渲染容差
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      if (!isVisible(el)) continue
      if (inHorizontalScrollContainer(el)) continue
      const rect = el.getBoundingClientRect()
      if (rect.left < -tol || rect.right > vw + tol) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          testid: el.getAttribute("data-testid"),
          cls: String(el.getAttribute("class") ?? "").slice(0, 80),
          left: Math.round(rect.left * 10) / 10,
          right: Math.round(rect.right * 10) / 10,
          text: (el.textContent ?? "").trim().slice(0, 40),
        })
      }
      if (offenders.length >= 10) break // 采样上限，失败信息足够定位
    }
    const scroller = document.scrollingElement ?? document.documentElement
    return {
      offenders,
      scrollOverflow: Math.max(0, scroller.scrollWidth - vw),
    }
  }, viewportWidth)
}
