import Link from "next/link"
import type { ReportView } from "@/lib/services/report"
import { Badge } from "./ui"
import { GenerateReportButton, InsightActions } from "./insight-actions"

/**
 * 收藏建议视图（返工轮任务 3）：随收藏变化更新的当前建议（制作推进 / 路线补齐 / 新品关注），
 * 档案条目式建议卡 + 路线摘要 + 统一"非投资建议"声明。
 */
/**
 * 展示级清洗：历史报告润色文案可能残留「匹配分 X 分：…。」句——
 * 新需求不显示匹配分/原因代码；只影响渲染，不改库内事实。
 */
function stripScoreSentence(body: string): string {
  return body.replace(/[^。]*匹配分[^。]*。/g, "").replace(/SCORE\s*\d+[^。]*。?/g, "")
}

export function ReportView({ view }: { view: ReportView }) {
  return (
    <div className="space-y-4" data-testid="report-page">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="wb-num text-xl font-bold tracking-tight">制作建议</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-50)" }}>
            随收藏变化更新的制作建议（制作推进 / 结构补全 / 新品动态）。
          </p>
        </div>
        {view.report && (
          <span className="mb-badge" style={{ background: "var(--surface)", borderColor: "var(--aluminium)", color: "var(--ink-70)" }}>
            生成时间 {view.report.generatedAtLabel}
          </span>
        )}
      </div>

      {view.locked ? (
        <div className="mb-card space-y-3 p-6" data-testid="report-locked">
          <h2 className="text-base font-semibold">收藏建议尚未解锁</h2>
          <p className="text-sm" style={{ color: "var(--ink-70)" }}>
            已确认收藏达到 <strong>3 件</strong>后，才会生成个性化建议（当前 {view.currentCount} 件，还差{" "}
            {view.needMoreCount} 件）。在那之前，手动新增与识别建档不受影响。
          </p>
          <Link href="/add" className="mb-btn mb-btn-primary inline-flex">
            去添加藏品
          </Link>
        </div>
      ) : !view.report ? (
        <div className="mb-card space-y-3 p-6" data-testid="report-not-generated">
          <h2 className="text-base font-semibold">收藏建议尚未生成</h2>
          <p className="text-sm" style={{ color: "var(--ink-70)" }}>
            手动触发刷新：数据未变化时重复执行幂等（不产生重复建议）。
          </p>
          <GenerateReportButton />
        </div>
      ) : (
        <>
          <div className="mb-card flex flex-wrap items-center justify-between gap-2 p-4" data-testid="report-meta">
            <div className="text-sm" style={{ color: "var(--ink-70)" }}>
              生成时间 <strong>{view.report.generatedAtLabel}</strong> · 共{" "}
              {view.report.insights.length} 条建议 · 收藏变化或次日首次打开自动刷新
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>{view.report.generatorVersion}</Badge>
              <Badge>快照 {view.report.snapshotVersion}</Badge>
            </div>
          </div>


          {view.report.noRecommendationNotice && (
            <div className="mb-card p-4 text-sm" style={{ borderColor: "var(--aluminium)", background: "var(--workbench)", color: "var(--ink-70)" }} data-testid="no-recommendation-notice">
              {view.report.noRecommendationNotice}
            </div>
          )}

          {view.report.insights.length === 0 ? (
            <div className="mb-card p-6 text-sm" style={{ color: "var(--ink-70)" }} data-testid="report-empty">
              当前无建议：没有可验证的新事件或需要提醒的收藏变化。
            </div>
          ) : (
            <ul className="space-y-3">
              {view.report.insights.map((insight, idx) => (
                <li key={insight.id} className="mb-card space-y-3 p-4" data-testid={`insight-card-${insight.id}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="wb-index">{String(idx + 1).padStart(2, "0")}</span>
                    <Badge tone={insight.type === "NEW_PRODUCT_RECOMMENDATION" ? "indigo" : insight.type === "STALLED_BUILDING" ? "amber" : "sky"}>
                      {insight.typeLabel}
                    </Badge>
                  </div>
                  <h3 className="wb-num text-base font-semibold">{insight.headline}</h3>
                  <p className="text-sm leading-6" style={{ color: "var(--ink-70)" }}>
                    {stripScoreSentence(insight.body)}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: "var(--ink-50)" }}>
                    {insight.sourceUrl && (
                      <a className="font-medium" style={{ color: "var(--blueprint)" }} href={insight.sourceUrl} data-testid={`source-${insight.id}`}>
                        来源 {insight.sourceDateLabel ?? "—"} ↗
                      </a>
                    )}
                    {insight.productId && <span className="wb-mono-sm">商品 {insight.productId}</span>}
                    {insight.assetId && <span className="wb-mono-sm">实体 {insight.assetId}</span>}
                  </div>
                  <InsightActions insight={insight} />
                </li>
              ))}
            </ul>
          )}

          {view.canGenerate && (
            <div className="mb-card space-y-2 p-4" data-testid="next-period-generate">
              <p className="text-sm" style={{ color: "var(--ink-70)" }}>
                收藏有变化，建议已标记过期：点击立即刷新。
              </p>
              <GenerateReportButton />
            </div>
          )}
        </>
      )}
    </div>
  )
}
