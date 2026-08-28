"use client"

import { useState } from "react"
import type { RecognitionJobDTO, CandidateDTO, ExtractionDTO } from "@/lib/services/recognition"
import { ErrorBanner, InfoBanner } from "./ui"
import { AssetFields, useAssetFields } from "./asset-fields"

/**
 * 识别结果核对流（识别主链路重构）：
 * - 第一区「AI 识别结果，请核对」：Kimi 原始结构化提取原样可见、可编辑
 *   （品牌/商品完整名称/中文名称/等级/比例/型号/所属作品），绝不被目录覆盖；
 * - 第二区「官网搜索结果」：Kimi $web_search 验证过的官方候选（官方名称/品番/
 *   页面链接/官网图/来源域名），用户显式选择——无自动 Top-1 推荐；
 *   无结果显示「未找到官网商品」，可修改名称后「重新搜索官网」；
 * - 第三区入库：官网候选 → 确认后下载官网图设为收藏封面；无候选 → 按编辑结果
 *   建立自定义收藏（上传照片只作实拍图）。
 */

const BRANDS = ["Bandai", "LEGO"]

interface ExtractionEdits {
  brand: string
  name: string
  nameZh: string
  series: string
  grade: string
  scale: string
  modelNumber: string
}

export function ReviewFlow({
  job,
  submitting,
  confirmError,
  onRetry,
  onManual,
  onConfirm,
}: {
  job: RecognitionJobDTO
  submitting: boolean
  confirmError: string | null
  onRetry: () => void
  onManual: () => void
  onConfirm: (
    edits: ExtractionDTO & { nameZh: string },
    candidate: CandidateDTO | null,
    opts: { buildState: string; progress: number; purchasePriceMinor?: number | null; purchasedAt?: string | null },
  ) => void
}) {
  const initial: ExtractionEdits = {
    brand: job.extraction?.brand ?? "",
    name: job.extraction?.name ?? "",
    nameZh: job.nameZhDefault ?? "",
    series: job.extraction?.series ?? "",
    grade: job.extraction?.grade ?? "",
    scale: job.extraction?.scale ?? "",
    modelNumber: job.extraction?.modelNumber ?? "",
  }
  const [edits, setEdits] = useState<ExtractionEdits>(initial)
  const [candidates, setCandidates] = useState<CandidateDTO[]>(job.candidates)
  const [searchQueries, setSearchQueries] = useState<string[]>(job.searchQueries)
  const [searchState, setSearchState] = useState<string>(job.searchState ?? "")
  const [searchMessage, setSearchMessage] = useState<string | null>(job.searchMessage)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const fields = useAssetFields()

  const selected = candidates.find((c) => (c.key ? c.key === selectedKey : c.productId === selectedKey)) ?? null

  function set<K extends keyof ExtractionEdits>(key: K, value: string) {
    setEdits((prev) => ({ ...prev, [key]: value }))
  }

  /** 重新搜索官网：以编辑后的字段执行 Kimi $web_search（修改名称后重搜） */
  async function reSearch() {
    setSearching(true)
    setSearchError(null)
    try {
      const res = await fetch("/api/recognition/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.jobId,
          extraction: {
            brand: edits.brand,
            name: edits.name,
            nameZh: edits.nameZh,
            series: edits.series,
            grade: edits.grade,
            scale: edits.scale,
            modelNumber: edits.modelNumber,
          },
        }),
      })
      const data = (await res.json()) as {
        candidates?: CandidateDTO[]
        searchQueries?: string[]
        searchState?: string
        searchMessage?: string | null
        error?: string
      }
      if (!res.ok) {
        setSearchError(data.error ?? "重新搜索失败，请重试")
        return
      }
      setCandidates(data.candidates ?? [])
      setSearchQueries(data.searchQueries ?? [])
      setSearchState(data.searchState ?? "")
      setSearchMessage(data.searchMessage ?? null)
      setSelectedKey(null) // 重搜后候选变化：取消选择，用户重新核对
    } catch {
      setSearchError("网络异常，请重试")
    } finally {
      setSearching(false)
    }
  }

  async function submitConfirm() {
    const invalid = fields.validate()
    if (invalid) {
      setSearchError(null)
      // AssetFields 校验错误由内部展示；这里只拦提交
      return
    }
    onConfirm(edits, selected, fields.payload())
  }

  if (job.state === "FAILED") {
    return (
      <section className="space-y-4" aria-label="识别结果" data-testid="review-panel">
        <div className="mb-card space-y-3 p-4" data-testid="recognition-failed">
          <ErrorBanner message={job.message} hint={`错误码 ${job.errorCode ?? "UNKNOWN"}`} />
          <div className="flex flex-wrap gap-3">
            <button type="button" className="mb-btn mb-btn-primary" onClick={onRetry} data-testid="retry-recognition">
              重试识别
            </button>
            <button type="button" className="mb-btn mb-btn-secondary" onClick={onManual}>
              改用手动录入
            </button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-4" aria-label="识别结果" data-testid="review-panel">
      {/* —— 第一区：AI 图片识别结果（原始提取，可编辑） —— */}
      <div className="mb-card space-y-4 p-4" data-testid="ai-extraction-panel">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-bold text-ink" data-testid="ai-extraction-title">
            AI 识别结果，请核对
          </h3>
          {job.cover && (
            <img
              src={job.cover.url}
              alt="本次识别照片"
              className="ml-auto h-16 w-16 rounded border border-aluminium object-cover"
              data-testid="top1-cover-thumb"
            />
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-label">品牌</span>
            <input className="mb-input" list="brand-options" value={edits.brand} onChange={(e) => set("brand", e.target.value)} data-testid="edit-brand" />
            <datalist id="brand-options">
              {BRANDS.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className="mb-label">等级</span>
            <input className="mb-input" value={edits.grade} onChange={(e) => set("grade", e.target.value)} placeholder="MG / RG / HG / TECHNIC…" data-testid="edit-grade" />
          </label>
          <label className="block">
            <span className="mb-label">比例</span>
            <input className="mb-input" value={edits.scale} onChange={(e) => set("scale", e.target.value)} placeholder="1/100" data-testid="edit-scale" />
          </label>
          <label className="block">
            <span className="mb-label">型号/机体编号</span>
            <input className="mb-input" value={edits.modelNumber} onChange={(e) => set("modelNumber", e.target.value)} placeholder="MSN-04 / 42172" data-testid="edit-model-number" />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-label">商品完整名称</span>
            <input className="mb-input" value={edits.name} onChange={(e) => set("name", e.target.value)} data-testid="edit-name" />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-label">中文名称</span>
            <input className="mb-input" value={edits.nameZh} onChange={(e) => set("nameZh", e.target.value)} placeholder="沙扎比" data-testid="edit-name-zh" />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-label">所属作品/系列</span>
            <input className="mb-input" value={edits.series} onChange={(e) => set("series", e.target.value)} placeholder="机动战士高达 逆袭的夏亚" data-testid="edit-series" />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="mb-btn mb-btn-secondary"
            disabled={searching}
            onClick={() => void reSearch()}
            data-testid="re-search-official"
          >
            {searching ? "搜索官网中…" : "重新搜索官网"}
          </button>
          <p className="text-xs text-[color:var(--ink-50)]">按当前编辑值在 Bandai 官方域名内联网搜索商品页。</p>
        </div>
        {searchError && <ErrorBanner message={searchError} />}
      </div>

      {/* —— 第二区：官网搜索结果（与 AI 识别结果分开显示） —— */}
      <div className="mb-card space-y-3 p-4" data-testid="official-search-panel">
        <h3 className="text-base font-bold text-ink" data-testid="official-search-title">
          {job.isFixture ? "识别候选（演示模式）" : "官网搜索结果"}
        </h3>
        {searchState === "SKIPPED" && !job.isFixture && (
          <InfoBanner>{searchMessage ?? "未执行联网搜索"}</InfoBanner>
        )}
        {searchQueries.length > 0 && (
          <p className="wb-mono-sm text-xs" style={{ color: "var(--ink-50)" }} data-testid="search-queries">
            搜索词：{searchQueries.join(" · ")}
          </p>
        )}
        {searching ? (
          <p className="flex items-center gap-2 text-sm text-blueprint" role="status" data-testid="official-searching">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blueprint border-t-indigo-600" aria-hidden />
            搜索官网中…
          </p>
        ) : candidates.length === 0 ? (
          <div className="space-y-2" data-testid="no-official-result">
            <p className="text-sm font-medium" style={{ color: "var(--signal)" }}>
              未找到官网商品
            </p>
            <p className="text-xs text-[color:var(--ink-50)]">
              {searchMessage ?? "可修改上方名称后点击「重新搜索官网」，或直接按识别结果建立自定义收藏。"}
            </p>
          </div>
        ) : (
          <ul className="space-y-2" data-testid="official-candidates" aria-label="官网候选">
            {candidates.map((c) => {
              const key = c.key ?? c.productId ?? ""
              const checked = key === selectedKey
              return (
                <li key={key}>
                  <label
                    className={`mb-card flex cursor-pointer flex-wrap items-start gap-3 p-3 transition ${
                      checked ? "border-indigo-400 bg-workbench/50 ring-1 ring-indigo-200" : "hover:border-indigo-200"
                    }`}
                  >
                    <input
                      type="radio"
                      name="official-candidate"
                      className="mt-1 h-4 w-4 accent-indigo-600"
                      checked={checked}
                      onChange={() => setSelectedKey(key)}
                      aria-label={`选择候选 ${c.nameZh ?? c.officialName}`}
                      data-testid={`candidate-radio-${key}`}
                    />
                    {c.imageUrl && (
                      <img
                        src={c.productId ? `/api/demo-images/${c.productId}` : `/api/official-image?url=${encodeURIComponent(c.imageUrl)}`}
                        alt={c.officialName}
                        className="h-20 w-20 shrink-0 rounded border border-aluminium bg-workbench object-contain"
                        data-testid={`candidate-image-${key}`}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {/* 官方完整商品名称优先中文，原名副标题 */}
                        <span className="text-sm font-semibold text-ink">{c.nameZh ?? c.officialName}</span>
                        {c.nameZh && c.officialName !== c.nameZh && (
                          <span className="text-xs text-[color:var(--ink-50)]">{c.officialName}</span>
                        )}
                        {c.origin === "lego_set_exact" && (
                          <span className="mb-badge" style={{ color: "var(--blueprint)", borderColor: "var(--blueprint)" }}>
                            Set Number 精确
                          </span>
                        )}
                        {c.confidencePercent && (
                          <span className="mb-badge">置信度 {c.confidencePercent}</span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-[color:var(--ink-50)]" data-testid={`candidate-facts-${key}`}>
                        {c.brand}
                        {c.grade ? ` · ${c.grade}` : ""}
                        {c.scale ? ` · ${c.scale}` : ""}
                        {c.modelNumber ? ` · ${c.modelNumber}` : ""}
                        {c.productCode ? ` · 品番 ${c.productCode}` : ""}
                        {c.releaseYear ? ` · ${c.releaseYear} 年` : ""}
                        {c.sourceDomain ? ` · 来源 ${c.sourceDomain}` : ""}
                        {c.ownedCount > 0 ? ` · 已有 ${c.ownedCount} 件` : ""}
                      </p>
                      {c.ownedCount > 0 && (
                        <p className="mt-1 text-xs font-medium" style={{ color: "var(--signal)" }} data-testid={`duplicate-warning-${c.key ?? c.productId}`}>
                          重复提示：你已有 {c.ownedCount} 件该 SKU 实体。可取消，或确认新增第二件（允许收藏同款多件）。
                        </p>
                      )}
                      {c.pageUrl && (
                        <a
                          href={c.pageUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="wb-mono-sm mt-1 inline-block break-all text-xs hover:underline"
                          style={{ color: "var(--scanner-cyan)" }}
                          data-testid={`candidate-page-${key}`}
                        >
                          {c.pageUrl}
                        </a>
                      )}
                    </div>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* —— 第三区：入库 —— */}
      <div className="mb-card space-y-3 p-4" data-testid="confirm-panel">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-ink">入库</h3>
          <p className="text-xs text-[color:var(--ink-50)]" data-testid="confirm-summary">
            {selected
              ? `已选择：${selected.nameZh ?? selected.officialName}${selected.key ? "（官网商品，确认后下载官网图作封面）" : "（确认后入库）"}`
              : candidates.length > 0
                ? "未选择候选——将按上方编辑结果建立自定义收藏"
                : "将按上方编辑结果建立自定义收藏"}
          </p>
        </div>
        <details className="space-y-3" data-testid="secondary-options" open>
          <summary className="cursor-pointer text-xs font-semibold text-ink">价格 / 购入日期 / 制作状态（可选）</summary>
          <div className="pt-2">
            <AssetFields fields={fields} idPrefix="confirm" />
          </div>
        </details>
        {confirmError && <ErrorBanner message={confirmError} />}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="mb-btn mb-btn-primary"
            disabled={submitting}
            onClick={() => void submitConfirm()}
            data-testid="confirm-save"
          >
            {submitting
              ? "入柜中…"
              : selected?.key
                ? "确认入柜"
                : selected?.productId
                  ? "确认入柜"
                  : candidates.length > 0
                    ? "按编辑结果建立自定义收藏"
                    : "建立自定义收藏"}
          </button>
          <button type="button" className="mb-btn mb-btn-secondary" onClick={onRetry} data-testid="retry-recognition">
            重新识别
          </button>
          <button type="button" className="mb-btn mb-btn-secondary" onClick={onManual} data-testid="no-candidate-manual">
            手动录入
          </button>
        </div>
        <p className="text-xs text-[color:var(--ink-50)]">
          默认按未开盒入库；官网候选确认后下载官网商品图作为收藏封面，你的照片保留为详情页实拍图。
        </p>
      </div>
    </section>
  )
}
