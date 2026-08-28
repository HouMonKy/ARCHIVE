import { describe, expect, it } from "vitest"
import type { AssetDTO } from "@/lib/services/assets"
import { assetCoverSrc, hasOfficialCatalogImage, sortAssetDTOs } from "@/lib/services/assets"
import { CabinetPreview } from "@/components/dashboard-view"
import { render, screen } from "@testing-library/react"

/**
 * 收藏柜封面优先级与计数文案（官网资料闭环 + UI 修复）：
 * - 官网目录图（imageStatus=OK）优先；失败回退用户上传照片；再回退占位；
 * - 「查看全部 N件 →」少于 10 件显示真实数字，≥10 显示 10+。
 */

function asset(overrides: Partial<AssetDTO> = {}): AssetDTO {
  return {
    id: "a1",
    displayName: "MGEX 1/100 强袭自由高达",
    originalName: "MGEX 1/100 ストライクフリーダムガンダム",
    nameZh: "MGEX 1/100 强袭自由高达",
    catalogProductId: "bandai-manual-646",
    customName: null,
    customBrand: null,
    brand: "Bandai",
    grade: "MGEX",
    line: "CE",
    releaseYear: 2022,
    modelNumber: "ZGMF-X20A",
    officialPageUrl: "https://manual.bandai-hobby.net/menus/detail/646",
    catalogImageStatus: "OK",
    dispositionState: "ACTIVE",
    archivedAt: null,
    buildState: "UNOPENED",
    progress: 0,
    purchasePriceMinor: null,
    currency: null,
    purchasedAt: null,
    completedAt: null,
    note: null,
    confirmedAt: new Date(),
    lastActivityAt: new Date(),
    recognitionCorrected: null,
    cover: { id: "c1", url: "/api/covers/c1" },
    ...overrides,
  }
}

describe("柜格封面优先级", () => {
  it("官网图 OK → 目录图优先（上传照片保留在详情页）", () => {
    const a = asset()
    expect(assetCoverSrc(a)).toBe("/api/demo-images/bandai-manual-646")
    expect(hasOfficialCatalogImage(a)).toBe(true)
  })

  it("官网图 FAILED → 回退用户上传照片", () => {
    const a = asset({ catalogImageStatus: "FAILED" })
    expect(assetCoverSrc(a)).toBe("/api/covers/c1")
    expect(hasOfficialCatalogImage(a)).toBe(false)
  })

  it("无上传照报且官网图失败 → 回退目录图路由（占位由路由兜底）", () => {
    const a = asset({ catalogImageStatus: "FAILED", cover: null })
    expect(assetCoverSrc(a)).toBe("/api/demo-images/bandai-manual-646")
  })

  it("自定义实体（无目录）→ 用户上传照片 → 占位", () => {
    const custom = asset({
      catalogProductId: null,
      catalogImageStatus: null,
      customName: "自制收藏",
    })
    expect(assetCoverSrc(custom)).toBe("/api/covers/c1")
    expect(assetCoverSrc(asset({ catalogProductId: null, catalogImageStatus: null, cover: null }))).toBe("/demo/fallback.svg")
  })

  it("旧目录商品（imageStatus=null，如 demo-v1）→ 用户上传照片优先", () => {
    const a = asset({ catalogImageStatus: null })
    expect(assetCoverSrc(a)).toBe("/api/covers/c1")
  })
})

describe("收藏柜预览「查看全部」计数", () => {
  it("少于 10 件显示真实数字（回归：<10 漏数字）", () => {
    render(<CabinetPreview assets={[asset()]} totalCount={2} />)
    expect(screen.getByTestId("cabinet-preview-all")).toHaveTextContent("查看全部 2件 →")
  })

  it("达到 10 件显示 10+", () => {
    render(<CabinetPreview assets={[asset()]} totalCount={12} />)
    expect(screen.getByTestId("cabinet-preview-all")).toHaveTextContent("查看全部 10+件 →")
  })

  it("恰好 10 件显示 10+", () => {
    render(<CabinetPreview assets={[asset()]} totalCount={10} />)
    expect(screen.getByTestId("cabinet-preview-all")).toHaveTextContent("查看全部 10+件 →")
  })

  it("总览按购买时间展示 LEGO / GUNDAM 各自最新 5 件", () => {
    const lego = Array.from({ length: 7 }, (_, index) => asset({
      id: `lego-${index}`,
      brand: "LEGO",
      displayName: `LEGO ${index}`,
      purchasedAt: new Date(Date.UTC(2026, 0, index + 1)),
      // 特意与购买时间相反，防止总览误用确认入库时间。
      confirmedAt: new Date(Date.UTC(2026, 0, 7 - index)),
    }))
    const bandai = Array.from({ length: 6 }, (_, index) => asset({
      id: `bandai-${index}`,
      brand: "Bandai",
      displayName: `GUNDAM ${index}`,
      purchasedAt: new Date(Date.UTC(2026, 1, index + 1)),
      confirmedAt: new Date(Date.UTC(2026, 1, 6 - index)),
    }))
    const other = asset({
      id: "other-newest",
      brand: "Kotobukiya",
      displayName: "OTHER",
      purchasedAt: new Date("2026-12-31T00:00:00Z"),
      confirmedAt: new Date("2026-12-31T00:00:00Z"),
    })

    render(<CabinetPreview assets={[...lego, other, ...bandai].reverse()} totalCount={14} />)

    expect(screen.getByRole("heading", { name: "最新入库" })).toBeInTheDocument()
    expect(screen.getByTestId("preview-section-title-LEGO")).toHaveTextContent("LEGO · 最新 5 件")
    expect(screen.getByTestId("preview-section-title-GUNDAM")).toHaveTextContent("GUNDAM · 最新 5 件")
    expect(screen.getAllByTestId(/^preview-cell-/)).toHaveLength(10)
    expect(screen.getByTestId("preview-cell-lego-6")).toBeInTheDocument()
    expect(screen.queryByTestId("preview-cell-lego-1")).not.toBeInTheDocument()
    expect(screen.getByTestId("preview-cell-bandai-5")).toBeInTheDocument()
    expect(screen.queryByTestId("preview-cell-bandai-0")).not.toBeInTheDocument()
    expect(screen.queryByTestId("preview-section-OTHER")).not.toBeInTheDocument()
  })
})

describe("收藏柜排序", () => {
  it("默认购入日期新→旧，同日按展示名首字母，未填日期放最后", () => {
    const sorted = sortAssetDTOs([
      asset({ id: "older", displayName: "Charlie", purchasedAt: new Date("2025-01-01T00:00:00Z") }),
      asset({ id: "same-b", displayName: "Beta", purchasedAt: new Date("2026-01-01T00:00:00Z") }),
      asset({ id: "missing", displayName: "Aaron", purchasedAt: null }),
      asset({ id: "same-a", displayName: "Alpha", purchasedAt: new Date("2026-01-01T00:00:00Z") }),
    ])
    expect(sorted.map((item) => item.id)).toEqual(["same-a", "same-b", "older", "missing"])
  })
})
