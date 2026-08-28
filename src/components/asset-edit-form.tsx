"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import type { AssetDTO } from "@/lib/services/assets"
import { BUILD_STATES, DISPOSITION_STATES } from "@/lib/asset-states"
import { buildStateLabel, dispositionLabel, parseYuanToMinor } from "@/lib/format"

const BUILD_OPTIONS = BUILD_STATES.map((s) => ({ value: s, label: buildStateLabel(s) }))
const DISPOSITION_OPTIONS = DISPOSITION_STATES.map((s) => ({ value: s, label: dispositionLabel(s) }))

function toIsoDateString(d: Date | null): string {
  if (!d) return ""
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function AssetEditForm({ asset }: { asset: AssetDTO }) {
  const router = useRouter()
  const [buildState, setBuildState] = useState(asset.buildState)
  const [progress, setProgress] = useState(asset.progress)
  const [disposition, setDisposition] = useState(asset.dispositionState)
  const [priceYuan, setPriceYuan] = useState(asset.purchasePriceMinor != null ? String(asset.purchasePriceMinor / 100) : "")
  const [purchasedAt, setPurchasedAt] = useState(toIsoDateString(asset.purchasedAt))
  const [note, setNote] = useState(asset.note ?? "")
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error"; message?: string }>({ kind: "idle" })

  const building = buildState === "BUILDING"
  const completed = buildState === "COMPLETED"

  function handleBuildStateChange(next: string) {
    setBuildState(next as typeof buildState)
    if (next === "COMPLETED") setProgress(100)
    if (next === "NOT_APPLICABLE") setProgress(0)
    if (next === "UNOPENED" || next === "OPENED") setProgress(0)
    setStatus({ kind: "idle" })
  }

  function buildPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      buildState,
      dispositionState: disposition,
    }
    if (building) payload.progress = progress
    if (completed) payload.progress = 100
    payload.purchasePriceMinor = parseYuanToMinor(priceYuan)
    payload.purchasedAt = purchasedAt || null
    payload.note = note.trim() || null
    return payload
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (building && (progress < 1 || progress > 99)) {
      setStatus({ kind: "error", message: "制作中的进度必须为 1–99%" })
      return
    }
    setStatus({ kind: "saving" })
    try {
      const res = await fetch(`/api/assets/${asset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) {
        setStatus({ kind: "error", message: data.error ?? "保存失败，请重试" })
        return
      }
      setStatus({ kind: "saved", message: "已保存，Dashboard 统计已同步更新" })
      router.refresh()
    } catch {
      setStatus({ kind: "error", message: "网络异常，请重试" })
    }
  }

  async function toggleArchive() {
    const next = asset.archivedAt == null
    setStatus({ kind: "saving" })
    try {
      const res = await fetch(`/api/assets/${asset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: next }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        setStatus({ kind: "error", message: data.error ?? "操作失败" })
        return
      }
      setStatus({ kind: "saved", message: next ? "已归档（不再计入收藏统计）" : "已取消归档" })
      router.refresh()
    } catch {
      setStatus({ kind: "error", message: "网络异常，请重试" })
    }
  }

  return (
    <form noValidate className="mb-card space-y-4 p-4" onSubmit={save} data-testid="asset-edit-form" aria-label="编辑实体">
      <h2 className="text-sm font-semibold text-ink">编辑实体</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-label" htmlFor="edit-build-state">
            制作状态
          </label>
          <select
            id="edit-build-state"
            className="mb-input"
            value={buildState}
            onChange={(e) => handleBuildStateChange(e.target.value)}
          >
            {BUILD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {building && (
          <div>
            <label className="mb-label" htmlFor="edit-progress">
              制作进度（1–99%）
            </label>
            <input
              id="edit-progress"
              className="mb-input"
              type="number"
              min={1}
              max={99}
              value={progress}
              onChange={(e) => setProgress(Number(e.target.value))}
            />
            <p className="mt-1 text-xs text-[color:var(--ink-50)]">制作中的进度必须为 1–99%。</p>
          </div>
        )}
        {completed && (
          <div>
            <span className="mb-label">完成进度</span>
            <p className="mb-input bg-workbench" aria-live="polite">
              100%（切换为已完成时自动写入）
            </p>
          </div>
        )}
        <div>
          <label className="mb-label" htmlFor="edit-disposition">
            去向
          </label>
          <select
            id="edit-disposition"
            className="mb-input"
            value={disposition}
            onChange={(e) => setDisposition(e.target.value as typeof disposition)}
          >
            {DISPOSITION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-label" htmlFor="edit-price">
            购入价（元，选填）
          </label>
          <input
            id="edit-price"
            className="mb-input"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            placeholder="例如 450"
            value={priceYuan}
            onChange={(e) => setPriceYuan(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-label" htmlFor="edit-purchased-at">
            购买日期（选填）
          </label>
          <input
            id="edit-purchased-at"
            className="mb-input"
            type="date"
            value={purchasedAt}
            onChange={(e) => setPurchasedAt(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-label" htmlFor="edit-note">
            备注（选填）
          </label>
          <textarea id="edit-note" className="mb-input" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      {status.kind === "error" && (
        <p className="text-sm font-medium text-rose-600" role="alert" data-testid="edit-error">
          {status.message}
        </p>
      )}
      {status.kind === "saved" && (
        <p className="text-sm font-medium text-emerald-600" role="status" data-testid="edit-saved">
          {status.message}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="mb-btn mb-btn-primary" disabled={status.kind === "saving"} data-testid="asset-save">
          {status.kind === "saving" ? "保存中…" : "保存修改"}
        </button>
        <button type="button" className="mb-btn mb-btn-secondary" onClick={toggleArchive} disabled={status.kind === "saving"} data-testid="asset-archive">
          {asset.archivedAt == null ? "归档" : "取消归档"}
        </button>
      </div>
    </form>
  )
}
