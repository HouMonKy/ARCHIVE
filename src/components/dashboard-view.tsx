import Link from "next/link"
import type { DashboardStats } from "@/lib/services/stats"
import type { ReportView } from "@/lib/services/report"
import type { RouteProgress } from "@/lib/services/routes"
import type { AssetDTO } from "@/lib/services/assets"
import { assetCoverSrc, sortAssetDTOs } from "@/lib/services/assets"
import { groupBySection } from "./collection-list-view"
import { formatCnyFromMinor, buildStateLabel } from "@/lib/format"
import { Badge, EmptyState } from "./ui"

/**
 * ARCHIVE 总览（返工轮任务 4）：
 * - 首屏以最新入库为主（LEGO / GUNDAM 各展示购买时间最新的 5 件）；
 * - 「下一步该做什么」行动区与统计作为辅助；
 * - 视觉语言：展示柜（Archive Black/Drawer/层板线/轻微聚光）、等宽型号标签（无渐变/玻璃拟态）。
 */

export function StatCard({
  label,
  value,
  sub,
  href,
  testId,
}: {
  label: string
  value: string
  sub?: string
  href?: string
  testId: string
}) {
  const inner = (
    <>
      <dt className="wb-label mb-0">{label}</dt>
      <dd className="wb-num mt-1 text-xl font-bold tracking-tight tabular-nums">{value}</dd>
      {sub && (
        <dd className="mt-1 text-xs" style={{ color: "var(--ink-50)" }}>
          {sub}
        </dd>
      )}
    </>
  )
  if (href) {
    return (
      <Link
        href={href}
        data-testid={testId}
        className="mb-card block border-b-2 px-3 py-2.5 transition-colors hover:bg-workbench"
        style={{ borderBottomColor: "var(--aluminium)" }}
      >
        <dl>{inner}</dl>
      </Link>
    )
  }
  return (
    <div data-testid={testId} className="mb-card px-3 py-2.5">
      <dl>{inner}</dl>
    </div>
  )
}

const LATEST_PREVIEW_LIMIT = 5

/**
 * 总览最新入库：只展示 LEGO / GUNDAM，按购买时间新→旧，每类最多 5 件。
 * 复用收藏柜购买时间排序：同日按名称，未填写购买日期的放最后。
 */
export function latestPreviewSections(assets: AssetDTO[]) {
  const latestFirst = sortAssetDTOs(assets, "purchase")

  return groupBySection(latestFirst)
    .filter((section) => section.key === "LEGO" || section.key === "GUNDAM")
    .map((section) => ({ ...section, assets: section.assets.slice(0, LATEST_PREVIEW_LIMIT) }))
}

export function CabinetPreview({ assets, totalCount }: { assets: AssetDTO[]; totalCount: number }) {
  const sections = latestPreviewSections(assets)
  if (sections.length === 0) return null

  return (
    <section aria-label="最新入库" data-testid="cabinet-preview" className="mb-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="wb-num text-base font-bold tracking-tight">最新入库</h2>
          <p className="mt-0.5 text-xs" style={{ color: "var(--ink-50)" }}>
            按购买时间展示 LEGO 与 GUNDAM 各最近 5 件
          </p>
        </div>
        <Link
          href="/collection"
          className="text-xs font-medium"
          style={{ color: "var(--scanner-cyan)" }}
          data-testid="cabinet-preview-all"
        >
          查看全部 {totalCount >= 10 ? "10+" : totalCount}件 →
        </Link>
      </div>
      <div className="space-y-4">
        {sections.map((section) => (
          <div key={section.key} data-testid={`preview-section-${section.key}`}>
            <h3
              className="wb-num mb-2 text-xs font-bold tracking-wider"
              style={{ color: "var(--index-amber)" }}
              data-testid={`preview-section-title-${section.key}`}
            >
              {section.label} · 最新 {section.assets.length} 件
            </h3>
            <ul
              className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
              aria-label={`${section.label} 最新入库`}
            >
              {section.assets.map((asset) => (
                <li key={asset.id}>
                  <Link
                    href={`/collection/${asset.id}`}
                    className="cabinet-cell cabinet-spotlight cabinet-shelf block"
                    data-testid={`preview-cell-${asset.id}`}
                  >
                    <div className="cabinet-image-stage relative w-full lg:min-h-[190px]" style={{ aspectRatio: "4 / 3" }}>
                      {/* 官网目录图优先；失败回退用户上传照片/占位 */}
                      <img
                        src={assetCoverSrc(asset, { display: true })}
                        alt={asset.displayName}
                        loading="lazy"
                        className="cabinet-product-image"
                      />
                    </div>
                    <div className="cabinet-label">
                      <p className="truncate text-sm font-semibold" title={asset.displayName}>
                        {asset.displayName}
                      </p>
                      <p className="wb-mono-sm truncate" style={{ color: "var(--ink-50)" }}>
                        {asset.modelNumber ?? asset.catalogProductId ?? asset.customBrand ?? "CUSTOM"}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

export function DistributionBars({
  title,
  items,
  total,
  testId,
}: {
  title: string
  items: { key: string; label: string; count: number; href: string }[]
  total: number
  testId: string
}) {
  if (items.length === 0) return null
  return (
    <section className="mb-card p-4" aria-label={title} data-testid={testId}>
      <h3 className="wb-label">{title}</h3>
      <ul className="space-y-2">
        {items.map((item) => {
          const percent = total > 0 ? Math.round((item.count / total) * 100) : 0
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                className="group block px-2 py-1.5 transition-colors hover:bg-workbench"
                aria-label={`${item.label} ${item.count} 件，查看收藏列表`}
              >
                <div className="flex items-center justify-between text-xs" style={{ color: "var(--ink-70)" }}>
                  <span className="font-medium" style={{ color: "var(--ink)" }}>
                    {item.label}
                  </span>
                  <span className="wb-num tabular-nums">
                    {item.count} 件 · {percent}%
                  </span>
                </div>
                <div className="mt-1 h-1 w-full" style={{ background: "var(--rule)" }}>
                  <div className="h-full" style={{ width: `${percent}%`, background: "var(--ink)" }} />
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function RouteLine({ route }: { route: RouteProgress }) {
  // 路线下钻：UC 走系列过滤；Technic 超跑走品牌+等级过滤
  const href =
    route.routeId === "UC"
      ? `/collection?line=${encodeURIComponent(route.routeId)}`
      : `/collection?brand=LEGO&grade=TECHNIC`
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 border-t px-4 py-2.5 transition-colors hover:bg-workbench"
      style={{ borderColor: "var(--rule)" }}
      data-testid={`route-${route.routeId}`}
    >
      <span className="flex min-w-0 flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium">{route.title}</span>
        <span className="wb-num text-sm font-bold tabular-nums" style={{ color: "var(--index-amber)" }}>
          {route.completionDisplay}
        </span>
      </span>
      <span className="text-xs" style={{ color: "var(--ink-50)" }}>
        {route.nextGap ? `下一步：${route.nextGap.label}` : "路线完整"}
      </span>
    </Link>
  )
}

export function DashboardView({
  userName,
  dateLabel,
  stats,
  reportView,
  routes = [],
  cabinetAssets = [],
  totalCount = 0,
}: {
  userName: string
  dateLabel: string
  stats: DashboardStats
  reportView: ReportView
  routes?: RouteProgress[]
  cabinetAssets?: AssetDTO[]
  /** 当前收藏总数（收藏柜预览“查看全部 N件”链接用） */
  totalCount?: number
}) {
  if (stats.isEmpty) {
    return (
      <div className="space-y-6">
        <DashboardHeader userName={userName} dateLabel={dateLabel} />
        <EmptyState
          title="收藏柜还是空的"
          description="拍一张盒面照，AI 会识别候选；核对后一键加入收藏柜。也可以直接手动录入。"
          actions={
            <>
              <Link href="/add" className="mb-btn mb-btn-primary" data-testid="empty-upload-cta">
                拍照识别
              </Link>
              <Link href="/add?mode=manual" className="mb-btn mb-btn-secondary" data-testid="empty-manual-cta">
                手动新增
              </Link>
            </>
          }
        />
      </div>
    )
  }

  const latestInsight = reportView.report?.insights[0]
  const primaryStep = stats.nextSteps[0]

  return (
    <div className="space-y-6" data-testid="dashboard">
      <DashboardHeader userName={userName} dateLabel={dateLabel} />

      {/* 首屏主视觉：收藏柜预览 */}
      <CabinetPreview assets={cabinetAssets} totalCount={totalCount} />

      {/* 行动区：下一步该做什么 */}
      <section aria-label="下一步该做什么" data-testid="next-steps" className="mb-card">
        <div className="flex items-baseline justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--aluminium)" }}>
          <h2 className="wb-num text-base font-bold tracking-tight">下一步该做什么</h2>
        </div>
        {primaryStep ? (
          <Link
            href={primaryStep.href}
            className="flex items-start gap-4 px-4 py-4 transition-colors hover:bg-workbench"
            style={{ borderBottom: `3px solid var(--signal)` }}
            data-testid="next-step-primary"
          >
            <span className="wb-num mt-0.5 text-2xl font-bold" style={{ color: "var(--signal)" }}>
              01
            </span>
            <span className="min-w-0">
              <span className="block text-base font-semibold">{primaryStep.title}</span>
              <span className="mt-1 block text-sm" style={{ color: "var(--ink-50)" }}>
                {primaryStep.detail}
              </span>
            </span>
          </Link>
        ) : (
          <p className="px-4 py-4 text-sm" style={{ color: "var(--ink-50)" }}>
            暂无待办：收藏结构保持良好。
          </p>
        )}
        {stats.nextSteps.length > 1 && (
          <ul>
            {stats.nextSteps.slice(1).map((step, idx) => (
              <li key={step.assetId + step.kind}>
                <Link
                  href={step.href}
                  className="flex items-start gap-4 border-t px-4 py-3 transition-colors hover:bg-workbench"
                  style={{ borderColor: "var(--rule)" }}
                >
                  <span className="wb-num mt-0.5 text-sm font-bold tabular-nums" style={{ color: "var(--ink-50)" }}>
                    {String(idx + 2).padStart(2, "0")}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{step.title}</span>
                    <span className="block text-xs" style={{ color: "var(--ink-50)" }}>
                      {step.detail}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {routes.length > 0 && (
          <div>
            {routes.map((r) => (
              <RouteLine key={r.routeId} route={r} />
            ))}
          </div>
        )}
      </section>

      {/* 统计：辅助信息条 */}
      <section aria-label="核心统计" data-testid="stat-cards">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="wb-label mb-0">收藏统计</h2>
        </div>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard testId="stat-current" label="当前收藏" value={String(stats.currentCollection)} sub={`实体总记录 ${stats.totalRecords} 条`} href="/collection?disposition=ACTIVE" />
          <StatCard testId="stat-sku" label="不同 SKU" value={String(stats.distinctSku)} sub="目录商品 + 自定义去重" href="/collection" />
          <StatCard
            testId="stat-cost"
            label="累计购入成本"
            value={formatCnyFromMinor(stats.cumulativeCostMinor)}
            sub={stats.missingPriceCount > 0 ? `缺价 ${stats.missingPriceCount} 件（不计为 0 元）` : "价格记录完整"}
            href="/collection?sort=price"
          />
          <StatCard testId="stat-completion" label="制作完成率" value={stats.completionDisplay} sub={`已完成 ${stats.completedCount} / 可制作 ${stats.buildableCount}`} href="/collection?status=COMPLETED" />
          <StatCard testId="stat-stalled" label="制作停滞" value={String(stats.stalled.length)} sub={stats.stalled.length > 0 ? `${stats.stalled[0]!.name} ${stats.stalled[0]!.days} 天` : "近 14 天无停滞"} href="/collection?status=BUILDING" />
        </dl>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <DistributionBars title="制作状态分布" items={stats.buildStateDistribution.map((d) => ({ ...d, label: buildStateLabel(d.label) }))} total={stats.currentCollection} testId="dist-build-state" />
        <DistributionBars title="品牌分布" items={stats.brandDistribution} total={stats.currentCollection} testId="dist-brand" />
        <DistributionBars title="等级分布" items={stats.gradeDistribution} total={stats.currentCollection} testId="dist-grade" />
      </div>

      <section className="mb-card p-4" aria-label="最新收藏建议" data-testid="latest-report">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="wb-label mb-0">最新收藏建议</h3>
          <Link href="/advice" className="text-xs font-medium" style={{ color: "var(--blueprint)" }}>
            查看完整收藏建议 →
          </Link>
        </div>
        {reportView.locked ? (
          <p className="text-sm" style={{ color: "var(--ink-50)" }} data-testid="report-locked-hint">
            收藏建议未解锁：已确认收藏达到 3 件后生成个性化建议（当前 {reportView.currentCount} 件）。
          </p>
        ) : latestInsight ? (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="indigo">{latestInsight.typeLabel}</Badge>
              <span className="text-sm font-medium">{latestInsight.headline}</span>
            </div>
            <p className="mt-1 text-xs" style={{ color: "var(--ink-50)" }}>
              生成时间 {reportView.report!.generatedAtLabel} · 共 {reportView.report!.insights.length} 条建议
            </p>
          </div>
        ) : (
          <p className="text-sm" style={{ color: "var(--ink-50)" }} data-testid="report-not-generated-hint">
            收藏建议尚未生成，前往收藏建议页手动刷新。
          </p>
        )}
      </section>
    </div>
  )
}

function DashboardHeader({
  userName,
  dateLabel,
}: {
  userName: string
  dateLabel: string
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="wb-num text-2xl font-bold tracking-tight">我的模型收藏</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-50)" }}>
          {userName} 的实体展示柜 · {dateLabel}
        </p>
      </div>
    </div>
  )
}
