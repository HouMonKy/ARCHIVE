import { headers } from "next/headers"
import { getPrismaClientAsync } from "@/lib/prisma"
import { requirePageUser } from "@/lib/auth/guard"
import { getCollectionMaps } from "@/lib/services/collection-map"
import { listRecentReleases } from "@/lib/services/new-releases"
import { getLatestReportView, generateReport } from "@/lib/services/report"
import { getOfficialReleaseSourceStatus } from "@/lib/services/release-discovery"
import { formatDateZh, demoNow } from "@/lib/clock"
import { Badge } from "@/components/ui"
import { ReportView } from "@/components/report-view"
import Link from "next/link"

export const dynamic = "force-dynamic"

/**
 * 收藏建议（收藏工作台改造）：
 * - 收藏地图：从用户真实藏品动态生成（同系列/主题 ≥2 或同品牌+等级/比例 ≥2），无固定路线、无百分比；
 * - 新品动态：真实 ReleaseEvent 覆盖近 90 天官网更新和未来 180 天发售信息（≤20 条），含官网图、
 *   已入柜标记与品牌筛选；无匹配分/推荐指数/原因代码。
 */

const BRAND_TABS = [
  { key: "", label: "全部" },
  { key: "Bandai", label: "Bandai" },
  { key: "LEGO", label: "LEGO" },
] as const

export default async function AdvicePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const db = await getPrismaClientAsync()
  const h = await headers()
  const user = await requirePageUser(db, new Request("http://local/advice", { headers: h }))
  const brandRaw = Array.isArray(sp.brand) ? sp.brand[0] : sp.brand
  const brand = brandRaw === "Bandai" || brandRaw === "LEGO" ? brandRaw : undefined

  // 制作建议（既有 InsightReport 流程：随收藏变化自动刷新；不显示路线/匹配分/原因代码）
  if (user.role === "OWNER") {
    await generateReport(db, user.id, demoNow()).catch(() => undefined)
  }
  const [maps, releases, reportView, sourceStatus] = await Promise.all([
    getCollectionMaps(db, user.id),
    listRecentReleases(db, user.id, { brand }),
    getLatestReportView(db, user.id, demoNow()),
    getOfficialReleaseSourceStatus(db, user.id),
  ])

  return (
    <div className="space-y-6" data-testid="advice-page">
      <div>
        <h1 className="wb-num text-xl font-bold tracking-tight">收藏建议</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-50)" }}>
          收藏地图随你的藏品变化生成；AI 每天从官网检索新品，再结合你的收藏生成建议。
        </p>
      </div>

      <section className="mb-card p-4" aria-label="新品信息源" data-testid="release-sources">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="wb-label mb-1">新品信息源</h2>
            <p className="text-sm" style={{ color: "var(--ink-70)" }}>
              仅采用通过官网域名、商品详情页与编号校验的结果。
            </p>
          </div>
          <p className="wb-mono-sm" style={{ color: sourceStatus.lastStatus === "ERROR" ? "var(--index-amber)" : "var(--ink-50)" }}>
            {sourceStatus.lastStatus === "ERROR"
              ? "本次更新失败 · 已保留上次结果"
              : sourceStatus.lastUpdatedAt
                ? `最近同步 ${formatDateZh(sourceStatus.lastUpdatedAt)}`
                : "等待首次联网同步"}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {sourceStatus.sources.map((source) => (
            <a
              key={source.url}
              href={source.url}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-sm border px-3 py-2 text-xs font-medium hover:bg-workbench"
              style={{ borderColor: "var(--rule)", color: "var(--scanner-cyan)" }}
              data-testid={`release-source-${source.brand}`}
            >
              {source.label} ↗
            </a>
          ))}
        </div>
      </section>

      {/* —— 收藏地图（动态，来自真实藏品；无百分比） —— */}
      <section aria-label="收藏地图" data-testid="collection-map">
        <h2 className="wb-label">收藏地图</h2>
        {maps.length === 0 ? (
          <p className="mb-card p-4 text-sm" style={{ color: "var(--ink-50)" }} data-testid="map-empty">
            暂无可成图的收藏分组：同一系列/主题或同品牌同等级/比例满 2 件后自动生成。
          </p>
        ) : (
          <ul className="space-y-3">
            {maps.map((card) => (
              <li key={card.key} className="mb-card space-y-3 p-4" data-testid={`map-card-${card.key}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="wb-num text-base font-semibold" data-testid={`map-title-${card.key}`}>
                    {card.title}
                  </h3>
                  <Badge tone={card.basis === "series" ? "indigo" : "sky"}>{card.basis === "series" ? "系列/主题" : "品牌·等级/比例"}</Badge>
                  <span className="wb-mono-sm" style={{ color: "var(--ink-50)" }} data-testid={`map-count-${card.key}`}>
                    {card.assets.length}件
                  </span>
                </div>
                <p className="text-sm" style={{ color: "var(--ink-70)" }}>
                  {card.commonTrait}
                </p>
                <ul className="flex flex-wrap gap-2" data-testid={`map-assets-${card.key}`}>
                  {card.assets.map((a) => (
                    <li key={a.id}>
                      <Link
                        href={`/collection/${a.id}`}
                        className="mb-mono-sm block rounded border px-2 py-1 text-xs hover:bg-workbench"
                        style={{ borderColor: "var(--rule)" }}
                        title={`${a.brand}${a.grade ? " · " + a.grade : ""}${a.scale ? " · " + a.scale : ""}`}
                      >
                        {a.displayName}
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="text-xs" style={{ color: "var(--ink-50)" }}>
                  {card.suggestion}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* —— 新品动态（真实官方事件；无匹配分/推荐指数/原因代码） —— */}
      <section aria-label="新品动态" data-testid="new-releases">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="wb-label mb-0">新品动态</h2>
          <nav className="flex gap-1" aria-label="品牌筛选" data-testid="release-brand-tabs">
            {BRAND_TABS.map((tab) => {
              const active = (brand ?? "") === tab.key
              return (
                <Link
                  key={tab.key || "all"}
                  href={tab.key ? `/advice?brand=${tab.key}` : "/advice"}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-sm border px-2.5 py-1 text-xs font-medium ${active ? "border-[#FFB000] bg-[#211A0B] text-[#FFB000]" : "border-transparent text-aluminium hover:bg-white/10 hover:text-white"}`}
                  style={active ? { color: "#FFB000", borderColor: "#FFB000", background: "#211A0B" } : undefined}
                  data-testid={`release-tab-${tab.key || "all"}`}
                >
                  {tab.label}
                </Link>
              )
            })}
          </nav>
        </div>
        {releases.length === 0 ? (
          <p className="mb-card p-4 text-sm" style={{ color: "var(--ink-50)" }} data-testid="releases-empty">
            近 90 天暂无官方新品公布，也没有未来 180 天的明确发售信息。
          </p>
        ) : (
          <ul className="space-y-2">
            {releases.map((item) => (
              <li key={item.eventId} className="mb-card flex flex-wrap items-center gap-3 p-3" data-testid={`release-${item.eventId}`}>
                {item.hasImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/demo-images/${item.productId}`}
                    alt={item.nameZh ?? item.officialName}
                    className="h-14 w-14 shrink-0 rounded border border-aluminium object-contain"
                    loading="lazy"
                  />
                ) : (
                  <span className="h-14 w-14 shrink-0 rounded border border-aluminium bg-workbench" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{item.nameZh ?? item.officialName}</span>
                    <Badge>{item.brand}</Badge>
                    {item.ownedCount > 0 && (
                      <Badge tone="green" data-testid={`release-owned-${item.eventId}`}>
                        已入柜
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs" style={{ color: "var(--ink-50)" }}>
                    {formatDateZh(item.announcedAt)}
                    {item.sourceName ? ` · ${item.sourceName}` : ""}
                  </p>
                  {item.officialName !== (item.nameZh ?? item.officialName) && (
                    <p className="wb-mono-sm truncate text-xs" style={{ color: "var(--ink-50)" }}>
                      {item.officialName}
                    </p>
                  )}
                </div>
                {item.sourceUrl && (
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-xs hover:underline"
                    style={{ color: "var(--scanner-cyan)" }}
                  >
                    官方来源 ↗
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
        {/* —— 制作建议（既有报告流：无路线/无匹配分） —— */}
        <ReportView view={reportView} />
    </div>
  )
}
