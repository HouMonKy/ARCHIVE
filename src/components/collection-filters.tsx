"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useState, useTransition } from "react"

const STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "UNOPENED", label: "未开盒" },
  { value: "OPENED", label: "已开盒" },
  { value: "BUILDING", label: "制作中" },
  { value: "COMPLETED", label: "已完成" },
  { value: "NOT_APPLICABLE", label: "不适用" },
]

const BRAND_OPTIONS = [
  { value: "", label: "全部品牌" },
  { value: "Bandai", label: "Bandai" },
  { value: "LEGO", label: "LEGO" },
]

const GRADE_OPTIONS = [
  { value: "", label: "全部等级" },
  { value: "MG", label: "MG" },
  { value: "RG", label: "RG" },
  { value: "HG", label: "HG" },
  { value: "PG", label: "PG" },
  { value: "MGEX", label: "MGEX" },
  { value: "其他", label: "其他" },
]

const DISPOSITION_OPTIONS = [
  { value: "", label: "在藏" },
  { value: "ALL", label: "全部去向" },
  { value: "SOLD", label: "已售出" },
  { value: "GIFTED", label: "已赠出" },
  { value: "RETURNED", label: "已退货" },
]

const SORT_OPTIONS = [
  { value: "purchase", label: "购入时间（新→旧）" },
  { value: "recent", label: "最近更新" },
  { value: "price", label: "价格优先" },
  { value: "name", label: "名称" },
]

export function CollectionFilters() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [q, setQ] = useState(searchParams.get("q") ?? "")

  function pushWith(updates: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    startTransition(() => {
      router.push(`/collection${params.size > 0 ? `?${params.toString()}` : ""}`)
    })
  }

  return (
    <form
      className="mb-card flex flex-wrap items-end gap-3 p-3"
      data-testid="collection-filters"
      onSubmit={(e) => {
        e.preventDefault()
        pushWith({ q })
      }}
      role="search"
      aria-label="收藏筛选"
    >
      <div className="min-w-0 flex-1 basis-40">
        <label className="mb-label" htmlFor="filter-q">
          搜索
        </label>
        <input
          id="filter-q"
          className="mb-input"
          type="search"
          placeholder="商品名关键词"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div>
        <label className="mb-label" htmlFor="filter-status">
          制作状态
        </label>
        <select
          id="filter-status"
          className="mb-input"
          value={searchParams.get("status") ?? ""}
          onChange={(e) => pushWith({ status: e.target.value })}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-label" htmlFor="filter-brand">
          品牌
        </label>
        <select
          id="filter-brand"
          className="mb-input"
          value={searchParams.get("brand") ?? ""}
          onChange={(e) => pushWith({ brand: e.target.value })}
        >
          {BRAND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-label" htmlFor="filter-grade">
          等级
        </label>
        <select
          id="filter-grade"
          className="mb-input"
          value={searchParams.get("grade") ?? ""}
          onChange={(e) => pushWith({ grade: e.target.value })}
        >
          {GRADE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-label" htmlFor="filter-disposition">
          去向
        </label>
        <select
          id="filter-disposition"
          className="mb-input"
          value={searchParams.get("disposition") ?? ""}
          onChange={(e) => pushWith({ disposition: e.target.value })}
        >
          {DISPOSITION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-label" htmlFor="filter-sort">
          排序
        </label>
        <select
          id="filter-sort"
          className="mb-input"
          value={searchParams.get("sort") ?? "purchase"}
          onChange={(e) => pushWith({ sort: e.target.value })}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="mb-btn mb-btn-primary" disabled={isPending}>
        搜索
      </button>
    </form>
  )
}
