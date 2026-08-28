import { describe, expect, it, beforeAll } from "vitest"
import { render, screen } from "@testing-library/react"
import { DashboardView } from "@/components/dashboard-view"
import { getDashboardStats } from "@/lib/services/stats"
import { getLatestReportView } from "@/lib/services/report"
import { getTestDb, resetTestDb } from "../../helpers/db"
import { demoNow } from "@/lib/clock"

/** D-05 组件层：统计卡片数字、下钻链接与空态入口 */
describe("DashboardView 组件", () => {
  beforeAll(async () => {
    await resetTestDb()
  })

  it("渲染 D-05 的确定数字与缺价提示", async () => {
    const db = getTestDb()
    const now = demoNow()
    const stats = await getDashboardStats(db, "kai", now)
    const reportView = await getLatestReportView(db, "kai", now)
    const { container } = render(
      <DashboardView userName="Kai" dateLabel="2026-08-25" stats={stats} reportView={reportView} />,
    )
    expect(screen.getByTestId("stat-current")).toHaveTextContent("7")
    expect(screen.getByTestId("stat-sku")).toHaveTextContent("7")
    expect(screen.getByTestId("stat-cost")).toHaveTextContent("¥3,720.00")
    expect(screen.getByTestId("stat-cost")).toHaveTextContent("缺价 1 件")
    expect(screen.getByTestId("stat-completion")).toHaveTextContent("33%（2/6）")
    expect(screen.getByTestId("stat-stalled")).toHaveTextContent("1")
    expect(screen.getByTestId("dist-brand")).toHaveTextContent("Bandai")
    expect(screen.getByTestId("dist-brand")).toHaveTextContent("LEGO")
    // 新需求：Dashboard 不再展示 RecognitionModeBadge
    expect(screen.queryByTestId("recognition-mode-badge")).toBeNull()
    expect(container.querySelector('a[href="/collection?brand=Bandai"]')).not.toBeNull()
    expect(container.querySelector('a[href="/collection?status=BUILDING"]')).not.toBeNull()
  })

  it("下一步事项包含 A02 停滞提醒", async () => {
    const db = getTestDb()
    const now = demoNow()
    const stats = await getDashboardStats(db, "kai", now)
    const reportView = await getLatestReportView(db, "kai", now)
    render(<DashboardView userName="Kai" dateLabel="2026-08-25" stats={stats} reportView={reportView} />)
    expect(screen.getByTestId("next-steps")).toHaveTextContent("已停滞 24 天")
    expect(screen.getByTestId("next-steps")).toHaveTextContent("缺少购入价")
  })

  it("空收藏时显示上传/手动两个入口（FR-10）", async () => {
    await resetTestDb({ assets: "none", intents: false })
    const db = getTestDb()
    const now = demoNow()
    const stats = await getDashboardStats(db, "kai", now)
    const reportView = await getLatestReportView(db, "kai", now)
    render(<DashboardView userName="Kai" dateLabel="2026-08-25" stats={stats} reportView={reportView} />)
    expect(screen.getByTestId("empty-state")).toBeInTheDocument()
    expect(screen.getByTestId("empty-upload-cta")).toHaveAttribute("href", "/add")
    expect(screen.getByTestId("empty-manual-cta")).toHaveAttribute("href", "/add?mode=manual")
  })
})
