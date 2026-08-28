"use client"

import { useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import type { CatalogItem } from "@/lib/services/catalog"
import type { AssetDTO } from "@/lib/services/assets"
import { AssetFields, useAssetFields } from "./asset-fields"
import { ErrorBanner } from "./ui"

/**
 * 手动录入（FR-01/FR-02 兜底）：识别失败/低置信/目录外时永远可用。
 * 同样使用幂等确认接口；未提交前不写任何收藏数据。
 */
export function ManualEntryForm({
  catalog,
  onCreated,
  presetProductId,
}: {
  catalog: CatalogItem[]
  onCreated?: (asset: AssetDTO) => void
  presetProductId?: string | null
}) {
  const router = useRouter()
  const fields = useAssetFields()
  const [source, setSource] = useState<"catalog" | "custom">(presetProductId ? "catalog" : "catalog")
  const [productId, setProductId] = useState(presetProductId ?? "")
  const [customName, setCustomName] = useState("")
  const [customBrand, setCustomBrand] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const idempotencyKeyRef = useRef<string | null>(null)

  function ensureIdempotencyKey(): string {
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `key-${Date.now()}-${Math.random()}`
    }
    return idempotencyKeyRef.current
  }

  function rotateIdempotencyKey(): void {
    idempotencyKeyRef.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `key-${Date.now()}-${Math.random()}`
  }

  const selectedProduct = useMemo(() => catalog.find((c) => c.id === productId), [catalog, productId])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (source === "catalog" && !productId) {
      setError("请选择目录商品，或切换到自定义商品录入")
      return
    }
    if (source === "custom" && (!customName.trim() || !customBrand.trim())) {
      setError("自定义商品需要填写商品名与品牌")
      return
    }
    const invalid = fields.validate()
    if (invalid) {
      setError(invalid)
      return
    }
    const payload = {
      idempotencyKey: ensureIdempotencyKey(),
      ...(source === "catalog" ? { productId } : { custom: { name: customName.trim(), brand: customBrand.trim() } }),
      dispositionState: "ACTIVE" as const,
      ...fields.payload(),
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = (await res.json()) as { asset?: AssetDTO; created?: boolean; error?: string }
      if (!res.ok || !data.asset) {
        setError(data.error ?? "保存失败，请重试")
        return
      }
      rotateIdempotencyKey()
      onCreated?.(data.asset)
      router.refresh()
    } catch {
      setError("网络异常，请重试（同一内容重复提交不会产生重复实体）")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form noValidate className="space-y-4" onSubmit={submit} data-testid="manual-entry-form" aria-label="手动录入">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-label" htmlFor="manual-source">
            商品来源
          </label>
          <select
            id="manual-source"
            className="mb-input"
            value={source}
            onChange={(e) => setSource(e.target.value as "catalog" | "custom")}
          >
            <option value="catalog">目录商品（高达）</option>
            <option value="custom">自定义商品（其他品类）</option>
          </select>
        </div>
        {source === "catalog" ? (
          <div>
            <label className="mb-label" htmlFor="manual-product">
              目录商品
            </label>
            <select id="manual-product" className="mb-input" value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">请选择商品</option>
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameZh ?? c.canonicalName}（{c.grade}）
                </option>
              ))}
            </select>
            {selectedProduct && selectedProduct.ownedCount > 0 && (
              <p className="mt-1.5 text-xs font-medium text-rose-700" data-testid={`manual-duplicate-warning-${selectedProduct.id}`}>
                重复提示：你已有 {selectedProduct.ownedCount} 件 {selectedProduct.nameZh ?? selectedProduct.canonicalName}。可取消，或确认新增第二件。
              </p>
            )}
          </div>
        ) : (
          <>
            <div>
              <label className="mb-label" htmlFor="manual-custom-name">
                商品名
              </label>
              <input
                id="manual-custom-name"
                className="mb-input"
                type="text"
                maxLength={80}
                placeholder="例如 Technic Supercar Demo"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-label" htmlFor="manual-custom-brand">
                品牌
              </label>
              <input
                id="manual-custom-brand"
                className="mb-input"
                type="text"
                maxLength={40}
                placeholder="例如 LEGO"
                value={customBrand}
                onChange={(e) => setCustomBrand(e.target.value)}
              />
            </div>
          </>
        )}
      </div>
      <AssetFields fields={fields} idPrefix="manual" />
      {error && <ErrorBanner message={error} />}
      <button type="submit" className="mb-btn mb-btn-primary" disabled={submitting} data-testid="manual-submit">
        {submitting ? "保存中…" : "手动保存入库"}
      </button>
    </form>
  )
}
