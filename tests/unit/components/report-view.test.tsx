import { describe, expect, it, vi, beforeAll } from "vitest"
import { render, screen } from "@testing-library/react"
import { ReportView } from "@/components/report-view"
import type { ReportView as ReportViewModel } from "@/lib/services/report"
import { getLatestReportView } from "@/lib/services/report"
import { getTestDb, resetTestDb } from "../../helpers/db"
import { demoNow } from "@/lib/clock"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

function lockedView(): ReportViewModel {
  return { locked: true, currentCount: 2, needMoreCount: 1, report: null, canGenerate: false }
}

/** FR-07 / FR-08 / D-06：解锁说明、洞察卡与“本周无建议” */
describe("ReportView 组件", () => {
  beforeAll(async () => {
    await resetTestDb()
  })

  it("少于 3 件确认收藏时显示解锁说明与差多少件", () => {
    render(<ReportView view={lockedView()} />)
    const locked = screen.getByTestId("report-locked")
    expect(locked).toHaveTextContent("尚未解锁")
    expect(locked).toHaveTextContent("还差 1 件")
  })

  it("渲染真实报告的洞察卡、来源与操作按钮", async () => {
    const db = getTestDb()
    const view = await getLatestReportView(db, "kai", demoNow())
    expect(view.report).toBeNull()
    // 先生成一期再渲染
    const { generateReport } = await import("@/lib/services/report")
    await generateReport(db, "kai", demoNow())
    const withReport = await getLatestReportView(db, "kai", demoNow())
    render(<ReportView view={withReport} />)
    expect(screen.getByText("新品动态：MG Zeta Gundam Ver.Ka")).toBeInTheDocument()
    expect(screen.getByText("制作推进：MGEX Unicorn Gundam Ver.Ka 已 24 天无进展")).toBeInTheDocument()
    expect(screen.getByText("路线补齐：制作完成率 33%")).toBeInTheDocument()
    // 新需求：不显示匹配分/SCORE/未归一化字样（新品不显示匹配分）
    expect(screen.queryByText(/SCORE|未归一化|匹配分/)).toBeNull()
    // 新需求：不显示原因代码（PREF_CATEGORY 等不再渲染）
    expect(screen.queryByText("PREF_CATEGORY")).toBeNull()
    expect(screen.getAllByText(/来源 2026-08-/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole("button", { name: /加入愿望单/ })).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: /^不感兴趣$/ }).length).toBe(3)
  })

  it("无新品推荐时显示“本周无新品建议”提示（不编造）", () => {
    const view: ReportViewModel = {
      locked: false,
      currentCount: 7,
      needMoreCount: 0,
      report: {
        id: "r-test",
        periodStartLabel: "2026-08-19",
        periodEndLabel: "2026-08-25",
        generatedAtLabel: "2026-08-25",
        generatorVersion: "report-generator-v1",
        snapshotVersion: "demo-v1",
        insights: [
          {
            id: "i-stall",
            type: "STALLED_BUILDING",
            typeLabel: "制作停滞",
            score: 24,
            headline: "制作推进：MGEX Unicorn Gundam Ver.Ka 已 24 天无进展",
            body: "详情",
            reasonCodes: ["NO_ACTIVITY_14D"],
            productId: null,
            productName: null,
            assetId: "A02",
            sourceUrl: "/collection/A02",
            sourceDateLabel: "2026-08-01",
            myFeedback: null,
          },
        ],
        hasRecommendation: false,
        noRecommendationNotice: "暂无新品关注建议：没有可靠且未拥有、未反馈不感兴趣的目录新品事件。",
      },
      canGenerate: false,
    }
    render(<ReportView view={view} />)
    expect(screen.getByTestId("no-recommendation-notice")).toHaveTextContent("暂无新品关注建议")
    expect(screen.queryByRole("button", { name: /加入愿望单/ })).not.toBeInTheDocument()
  })
})
