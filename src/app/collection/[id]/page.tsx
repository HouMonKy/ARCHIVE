import Link from "next/link"
import { notFound } from "next/navigation"
import { headers } from "next/headers"
import { getPrismaClientAsync } from "@/lib/prisma"
import { requirePageUser } from "@/lib/auth/guard"
import { getAsset, assetCoverSrc } from "@/lib/services/assets"
import { listAssetPhotos } from "@/lib/services/asset-photos"
import { AssetPhotosSection } from "@/components/asset-photos-section"
import { AppError } from "@/lib/errors"
import { buildStateLabel, dispositionLabel, formatCnyFromMinor } from "@/lib/format"
import { formatDateZh } from "@/lib/clock"
import { Badge, ProgressBar } from "@/components/ui"
import { AssetEditForm } from "@/components/asset-edit-form"

export const dynamic = "force-dynamic"

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = await getPrismaClientAsync()
  const h = await headers()
  const user = await requirePageUser(db, new Request(`http://local/collection/${id}`, { headers: h }))
  let asset
  try {
    asset = await getAsset(db, user.id, id)
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound()
    throw e
  }
  const photos = await listAssetPhotos(db, user.id, id)

  return (
    <div className="space-y-4" data-testid="asset-detail">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/collection" className="hover:underline" style={{ color: "var(--scanner-cyan)" }}>
          ← 返回收藏柜
        </Link>
      </div>

      <section className="mb-card flex flex-wrap gap-4 p-4" aria-label="实体信息">
        {/* 与收藏柜一致：4:3 展示台 + contain，完整显示商品图，不被方形框裁切。 */}
        <div
          className="cabinet-image-stage relative w-full shrink-0 rounded border border-aluminium sm:w-64"
          style={{ aspectRatio: "4 / 3" }}
        >
          <img
            src={assetCoverSrc(asset, { display: true })}
            alt={asset.displayName}
            width={320}
            height={240}
            className="cabinet-product-image"
            data-testid="asset-cover"
          />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="wb-num text-lg font-bold tracking-tight" data-testid="asset-name">
              {asset.displayName}
            </h1>
            {asset.grade && <Badge tone="sky">{asset.grade}</Badge>}
            <Badge>{asset.brand}</Badge>
            <Badge tone={asset.dispositionState === "ACTIVE" ? "green" : "amber"}>{dispositionLabel(asset.dispositionState)}</Badge>
            {asset.archivedAt && <Badge tone="slate">已归档</Badge>}
          </div>
          {asset.nameZh && asset.originalName && asset.originalName !== asset.displayName && (
            <p className="text-xs" style={{ color: "var(--ink-50)" }} data-testid="asset-original-name">
              {asset.originalName}
            </p>
          )}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-[color:var(--ink-70)] sm:grid-cols-3" data-testid="asset-facts">
            <div>
              <dt className="text-[color:var(--ink-50)]">制作状态</dt>
              <dd className="font-medium text-ink" data-testid="fact-build-state">
                {buildStateLabel(asset.buildState)}
              </dd>
            </div>
            <div>
              <dt className="text-[color:var(--ink-50)]">进度</dt>
              <dd className="font-medium text-ink" data-testid="fact-progress">
                {asset.progress}%
              </dd>
            </div>
            <div>
              <dt className="text-[color:var(--ink-50)]">购入价</dt>
              <dd className="font-medium text-ink" data-testid="fact-price">
                {formatCnyFromMinor(asset.purchasePriceMinor)}
              </dd>
            </div>
            <div>
              <dt className="text-[color:var(--ink-50)]">购买日期</dt>
              <dd className="font-medium text-ink">{formatDateZh(asset.purchasedAt)}</dd>
            </div>
            {asset.modelNumber && (
              <div>
                <dt className="text-[color:var(--ink-50)]">型号/编号</dt>
                <dd className="wb-mono-sm font-medium text-ink" data-testid="fact-model-number">
                  {asset.modelNumber}
                </dd>
              </div>
            )}
            {asset.officialPageUrl && (
              <div className="col-span-2 sm:col-span-3">
                <dt className="text-[color:var(--ink-50)]">官网商品页</dt>
                <dd className="font-medium">
                  <a
                    href={asset.officialPageUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="wb-mono-sm break-all hover:underline"
                    style={{ color: "var(--scanner-cyan)" }}
                    data-testid="fact-official-page"
                  >
                    {asset.officialPageUrl}
                  </a>
                </dd>
              </div>
            )}
            {asset.note && (
              <div className="col-span-2 sm:col-span-3">
                <dt className="text-[color:var(--ink-50)]">备注</dt>
                <dd className="font-medium text-ink">{asset.note}</dd>
              </div>
            )}
          </dl>
          {asset.buildState === "BUILDING" && (
            <div className="max-w-xs">
              <ProgressBar value={asset.progress} label={`${asset.displayName} 进度`} />
            </div>
          )}
          {asset.recognitionCorrected === true && (
            <p className="text-xs text-amber-700">该实体在识别确认时被用户修正过候选。</p>
          )}
        </div>
      </section>

      <AssetPhotosSection
        assetId={asset.id}
        assetName={asset.displayName}
        recognitionPhotoUrl={asset.cover?.url ?? null}
        initialPhotos={photos.map((p) => ({ id: p.id, url: p.url, createdAt: p.createdAt.toISOString() }))}
      />

      <AssetEditForm asset={asset} />
    </div>
  )
}
