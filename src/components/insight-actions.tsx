"use client"

import { useRouter } from "next/navigation"
import Link from "next/link"
import { useState } from "react"
import type { InsightDTO } from "@/lib/services/report"

export function InsightActions({ insight }: { insight: InsightDTO }) {
  const router = useRouter()
  const [feedback, setFeedback] = useState<string | null>(insight.myFeedback)
  const [wishlisted, setWishlisted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function sendFeedback(value: "USEFUL" | "NOT_INTERESTED") {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/insights/${insight.id}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        setError(data.error ?? "反馈失败")
        return
      }
      setFeedback(value)
      router.refresh()
    } catch {
      setError("网络异常")
    } finally {
      setPending(false)
    }
  }

  async function addToWishlist() {
    if (!insight.productId) return
    setPending(true)
    setError(null)
    try {
      const res = await fetch("/api/intents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: insight.productId, state: "WISHLIST" }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        setError(data.error ?? "加入愿望单失败")
        return
      }
      setWishlisted(true)
      router.refresh()
    } catch {
      setError("网络异常")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`insight-actions-${insight.id}`}>
      {insight.type === "NEW_PRODUCT_RECOMMENDATION" && insight.productId && (
        <button
          type="button"
          className="mb-btn mb-btn-primary text-xs"
          onClick={addToWishlist}
          disabled={pending || wishlisted}
          data-testid={`wishlist-${insight.id}`}
        >
          {wishlisted ? "已在愿望单" : "加入愿望单"}
        </button>
      )}
      {insight.type === "STALLED_BUILDING" && insight.assetId && (
        <Link className="mb-btn mb-btn-primary text-xs" href={`/collection/${insight.assetId}`} data-testid={`update-state-${insight.id}`}>
          去更新状态
        </Link>
      )}
      {insight.type === "STRUCTURE_COMPLETION" && (
        <Link className="mb-btn mb-btn-primary text-xs" href="/collection?status=BUILDING" data-testid={`view-collection-${insight.id}`}>
          查看制作中收藏
        </Link>
      )}
      <button
        type="button"
        className="mb-btn mb-btn-secondary text-xs"
        onClick={() => sendFeedback("USEFUL")}
        disabled={pending || feedback === "USEFUL"}
        aria-pressed={feedback === "USEFUL"}
        data-testid={`useful-${insight.id}`}
      >
        {feedback === "USEFUL" ? "已反馈：有用" : "有用"}
      </button>
      <button
        type="button"
        className="mb-btn mb-btn-secondary text-xs"
        onClick={() => sendFeedback("NOT_INTERESTED")}
        disabled={pending || feedback === "NOT_INTERESTED"}
        aria-pressed={feedback === "NOT_INTERESTED"}
        data-testid={`not-interested-${insight.id}`}
      >
        {feedback === "NOT_INTERESTED" ? "已标记：不感兴趣（30 天内不再推荐）" : "不感兴趣"}
      </button>
      {error && <span className="text-xs text-rose-600" role="alert">{error}</span>}
    </div>
  )
}

export function GenerateReportButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setPending(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch("/api/advice/generate", { method: "POST" })
      const data = (await res.json()) as { message?: string; status?: string; error?: string }
      if (!res.ok) {
        setError(data.error ?? "刷新失败")
        return
      }
      setResult(data.message ?? "已更新")
      router.refresh()
    } catch {
      setError("网络异常，请重试")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-2">
      <button type="button" className="mb-btn mb-btn-primary" onClick={generate} disabled={pending} data-testid="generate-report">
        {pending ? "刷新中…" : "更新收藏建议"}
      </button>
      {result && (
        <p className="text-sm text-emerald-700" role="status">
          {result}
        </p>
      )}
      {error && (
        <p className="text-sm text-rose-600" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
