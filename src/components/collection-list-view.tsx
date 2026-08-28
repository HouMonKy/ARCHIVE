import Link from "next/link"
import type { AssetDTO } from "@/lib/services/assets"
import { assetCoverSrc } from "@/lib/services/assets"
import { buildStateLabel, dispositionLabel, formatCnyFromMinor } from "@/lib/format"
import { Badge, EmptyState } from "./ui"

const STATE_ACCENT: Record<string, string> = {
  UNOPENED: "var(--aluminium)",
  OPENED: "var(--blueprint)",
  BUILDING: "var(--index-amber)",
  COMPLETED: "var(--success)",
  NOT_APPLICABLE: "var(--rule)",
}

/**
 * 收藏柜柜格（返工轮任务 4）：
 * - 上方 4:3 展示台（桌面高度 ≥190px）：官网目录图优先，完整展示且不被柜框裁切；
 * - 下方仅名称/型号/状态/购入价；
 * - 柜格有层板线（cabinet-shelf）与轻微聚光（cabinet-spotlight，仅格内）；
 * - hover 抬升 2px（reduced-motion 关闭）。
 */
export function AssetCell({ asset }: { asset: AssetDTO }) {
  return (
    <li>
      <Link
        href={`/collection/${asset.id}`}
        className="cabinet-cell cabinet-spotlight cabinet-shelf block"
        data-testid={`asset-row-${asset.id}`}
        aria-label={`${asset.displayName}，${buildStateLabel(asset.buildState)}，购入价 ${formatCnyFromMinor(asset.purchasePriceMinor)}`}
      >
        <div className="cabinet-image-stage relative w-full lg:min-h-[190px]" style={{ aspectRatio: "4 / 3" }}>
          <img
            src={assetCoverSrc(asset, { display: true })}
            alt={asset.displayName}
            loading="lazy"
            className="cabinet-product-image"
          />
          <span
            aria-hidden
            className="absolute left-0 top-0 h-full"
            style={{ width: 3, background: STATE_ACCENT[asset.buildState] ?? "var(--aluminium)" }}
          />
        </div>
        <div className="cabinet-label space-y-1">
          <p className="truncate text-sm font-semibold" title={asset.displayName}>
            {asset.displayName}
          </p>
          <p className="wb-mono-sm truncate" style={{ color: "var(--ink-50)" }}>
            {asset.modelNumber ?? asset.catalogProductId ?? asset.customBrand ?? "CUSTOM"}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <Badge tone={asset.buildState === "COMPLETED" ? "green" : asset.buildState === "BUILDING" ? "amber" : "slate"}>
              {buildStateLabel(asset.buildState)}
              {asset.dispositionState !== "ACTIVE" ? ` · ${dispositionLabel(asset.dispositionState)}` : ""}
            </Badge>
            <span className="wb-num text-xs tabular-nums" style={{ color: "var(--label-silver)" }}>
              {formatCnyFromMinor(asset.purchasePriceMinor)}
            </span>
          </div>
        </div>
      </Link>
    </li>
  )
}

/**
 * 分区货架：LEGO 固定在前、GUNDAM 在后、其他最后；空分区不显示。
 * 用户排序只在分区内部生效；默认购入时间新→旧，同日按展示名排序（listAssets 已完成稳定排序）。
 */
export type SectionKey = "LEGO" | "GUNDAM" | "OTHER"

export const SECTION_LABELS: Record<SectionKey, string> = {
  LEGO: "LEGO",
  GUNDAM: "GUNDAM",
  OTHER: "其他",
}

/** 资产归属分区：LEGO 品牌 → LEGO；Bandai（Gundam 类）→ GUNDAM；其余 → 其他 */
export function sectionOf(asset: AssetDTO): SectionKey {
  if (asset.brand === "LEGO") return "LEGO"
  if (asset.brand === "Bandai") return "GUNDAM"
  return "OTHER"
}

/** 分区排序：LEGO → GUNDAM → OTHER（固定） */
export const SECTION_ORDER: SectionKey[] = ["LEGO", "GUNDAM", "OTHER"]

export function groupBySection(assets: AssetDTO[]): { key: SectionKey; label: string; assets: AssetDTO[] }[] {
  const buckets = new Map<SectionKey, AssetDTO[]>()
  for (const asset of assets) {
    const key = sectionOf(asset)
    const list = buckets.get(key) ?? []
    list.push(asset)
    buckets.set(key, list)
  }
  return SECTION_ORDER.filter((key) => (buckets.get(key) ?? []).length > 0).map((key) => ({
    key,
    label: SECTION_LABELS[key],
    assets: buckets.get(key)!,
  }))
}

export function CollectionListView({ assets, filters }: { assets: AssetDTO[]; filters: Record<string, string | undefined> }) {
  const activeFilterChips = Object.entries(filters)
    .filter(([key, value]) => value && key !== "sort")
    .map(([key, value]) => `${key}=${value}`)
  const sections = groupBySection(assets)

  return (
    <div className="space-y-4" data-testid="collection-list">
      {assets.length === 0 ? (
        <EmptyState
          title={activeFilterChips.length > 0 ? "没有符合筛选条件的实体" : "收藏柜还是空的"}
          description={
            activeFilterChips.length > 0
              ? "换个筛选条件试试，或清除筛选查看全部收藏。"
              : "拍一张盒面照，AI 会识别候选；核对后一键入柜。"
          }
          actions={
            <Link href="/add" className="mb-btn mb-btn-primary">
              入柜
            </Link>
          }
        />
      ) : (
        <>
          <p className="wb-mono-sm" style={{ color: "var(--ink-50)" }} data-testid="collection-count">
            共 {assets.length} 条实体记录{activeFilterChips.length > 0 ? `（筛选：${activeFilterChips.join("、")}）` : ""}
          </p>
          {sections.map((section) => (
            <section key={section.key} aria-label={`${section.label}分区`} data-testid={`section-${section.key}`}>
              <h2 className="wb-num mb-2 text-sm font-bold tracking-wider" style={{ color: "var(--index-amber)" }} data-testid={`section-title-${section.key}`}>
                {section.label} · {section.assets.length}件
              </h2>
              <ul
                className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                data-testid={`cabinet-grid-${section.key}`}
                aria-label={`收藏柜 ${section.label}`}
              >
                {section.assets.map((asset) => (
                  <AssetCell key={asset.id} asset={asset} />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  )
}
