"use client"

import { useState } from "react"
import type { BuildState } from "@/lib/asset-states"
import { buildStateLabel, parseYuanToMinor } from "@/lib/format"
import { BUILD_STATES } from "@/lib/asset-states"

const BUILD_OPTIONS = BUILD_STATES.map((s) => ({ value: s, label: buildStateLabel(s) }))

export interface AssetFieldsPayload {
  buildState: BuildState
  progress: number
  purchasePriceMinor: number | null
  purchasedAt: string | null
  note: string | null
}

export function useAssetFields(initial?: { buildState?: BuildState; progress?: number }) {
  const [buildState, setBuildState] = useState<BuildState>(initial?.buildState ?? "UNOPENED")
  const [progress, setProgress] = useState(initial?.progress ?? 0)
  const [priceYuan, setPriceYuan] = useState("")
  const [purchasedAt, setPurchasedAt] = useState("")
  const [note, setNote] = useState("")

  function updateBuildState(next: BuildState) {
    setBuildState(next)
    if (next === "COMPLETED") setProgress(100)
    if (next === "UNOPENED" || next === "OPENED" || next === "NOT_APPLICABLE") setProgress(0)
  }

  function payload(): AssetFieldsPayload {
    return {
      buildState,
      progress: buildState === "BUILDING" ? progress : buildState === "COMPLETED" ? 100 : 0,
      purchasePriceMinor: parseYuanToMinor(priceYuan),
      purchasedAt: purchasedAt || null,
      note: note.trim() || null,
    }
  }

  function validate(): string | null {
    if (buildState === "BUILDING" && (progress < 1 || progress > 99)) return "制作中的进度必须为 1–99%"
    return null
  }

  return { buildState, setBuildState: updateBuildState, progress, setProgress, priceYuan, setPriceYuan, purchasedAt, setPurchasedAt, note, setNote, payload, validate }
}

export type AssetFieldsState = ReturnType<typeof useAssetFields>

export function AssetFields({ fields, idPrefix }: { fields: AssetFieldsState; idPrefix: string }) {
  const building = fields.buildState === "BUILDING"
  const completed = fields.buildState === "COMPLETED"
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className="mb-label" htmlFor={`${idPrefix}-build-state`}>
          制作状态
        </label>
        <select
          id={`${idPrefix}-build-state`}
          className="mb-input"
          value={fields.buildState}
          onChange={(e) => fields.setBuildState(e.target.value as BuildState)}
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
          <label className="mb-label" htmlFor={`${idPrefix}-progress`}>
            制作进度（1–99%）
          </label>
          <input
            id={`${idPrefix}-progress`}
            className="mb-input"
            type="number"
            min={1}
            max={99}
            value={fields.progress}
            onChange={(e) => fields.setProgress(Number(e.target.value))}
          />
        </div>
      )}
      {completed && (
        <div>
          <span className="mb-label">完成进度</span>
          <p className="mb-input bg-slate-50">100%（自动写入）</p>
        </div>
      )}
      <div>
        <label className="mb-label" htmlFor={`${idPrefix}-price`}>
          购入价（元，选填）
        </label>
        <input
          id={`${idPrefix}-price`}
          className="mb-input"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          placeholder="例如 450"
          value={fields.priceYuan}
          onChange={(e) => fields.setPriceYuan(e.target.value)}
        />
      </div>
      <div>
        <label className="mb-label" htmlFor={`${idPrefix}-purchased-at`}>
          购买日期（选填）
        </label>
        <input
          id={`${idPrefix}-purchased-at`}
          className="mb-input"
          type="date"
          value={fields.purchasedAt}
          onChange={(e) => fields.setPurchasedAt(e.target.value)}
        />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-label" htmlFor={`${idPrefix}-note`}>
          备注（选填）
        </label>
        <textarea
          id={`${idPrefix}-note`}
          className="mb-input"
          rows={2}
          maxLength={500}
          value={fields.note}
          onChange={(e) => fields.setNote(e.target.value)}
        />
      </div>
    </div>
  )
}
