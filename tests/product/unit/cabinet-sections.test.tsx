import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import type { AssetDTO } from "@/lib/services/assets"
import { CollectionListView, groupBySection, sectionOf } from "@/components/collection-list-view"

/**
 * 收藏柜分区货架（收藏工作台改造）：
 * - LEGO 固定在前、GUNDAM 在后、其他最后；空分区不显示；
 * - 区内保持传入顺序（用户排序只在分区内部生效）；
 * - 分区标题「LEGO · N件 / GUNDAM · N件 / 其他 · N件」。
 */

function asset(overrides: Partial<AssetDTO> = {}): AssetDTO {
  return {
    id: "a-" + Math.random().toString(36).slice(2, 8),
    displayName: "某藏品",
    originalName: null,
    nameZh: null,
    catalogProductId: null,
    customName: "某藏品",
    customBrand: null,
    brand: "Bandai",
    grade: null,
    line: null,
    releaseYear: null,
    modelNumber: null,
    officialPageUrl: null,
    catalogImageStatus: null,
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
    cover: null,
    ...overrides,
  }
}

describe("分区归属", () => {
  it("LEGO 品牌 → LEGO；Bandai → GUNDAM；其余 → 其他", () => {
    expect(sectionOf(asset({ brand: "LEGO" }))).toBe("LEGO")
    expect(sectionOf(asset({ brand: "Bandai" }))).toBe("GUNDAM")
    expect(sectionOf(asset({ brand: "万代" }))).toBe("OTHER")
    expect(sectionOf(asset({ brand: "Zvezda" }))).toBe("OTHER")
  })
})

describe("分区排序与空区", () => {
  it("LEGO 始终在 GUNDAM 前、其他最后（无论传入顺序）", () => {
    const mixed = [
      asset({ id: "g1", brand: "Bandai" }),
      asset({ id: "o1", brand: "Zvezda" }),
      asset({ id: "l1", brand: "LEGO" }),
      asset({ id: "g2", brand: "Bandai" }),
      asset({ id: "l2", brand: "LEGO" }),
    ]
    const sections = groupBySection(mixed)
    expect(sections.map((s) => s.key)).toEqual(["LEGO", "GUNDAM", "OTHER"])
    expect(sections[0]!.assets.map((a) => a.id)).toEqual(["l1", "l2"])
    expect(sections[1]!.assets.map((a) => a.id)).toEqual(["g1", "g2"])
    expect(sections[2]!.assets.map((a) => a.id)).toEqual(["o1"])
  })

  it("空分区不显示", () => {
    const onlyLego = [asset({ brand: "LEGO" }), asset({ brand: "LEGO" })]
    const sections = groupBySection(onlyLego)
    expect(sections.map((s) => s.key)).toEqual(["LEGO"])
  })

  it("区内保持传入顺序（用户排序在分区内生效）", () => {
    // 模拟按价格排好序的 GUNDAM 资产
    const ordered = [
      asset({ id: "expensive", brand: "Bandai", purchasePriceMinor: 50000 }),
      asset({ id: "cheap", brand: "Bandai", purchasePriceMinor: 1000 }),
    ]
    const sections = groupBySection(ordered)
    expect(sections[0]!.assets.map((a) => a.id)).toEqual(["expensive", "cheap"])
  })
})

describe("收藏柜分区渲染与文案", () => {
  it("分区标题「LEGO · N件 / GUNDAM · N件」；CTA 为「入柜」", () => {
    render(
      <CollectionListView
        assets={[
          asset({ id: "g1", brand: "Bandai", displayName: "沙扎比" }),
          asset({ id: "l1", brand: "LEGO", displayName: "迈凯伦P1" }),
          asset({ id: "l2", brand: "LEGO", displayName: "复仇者大厦" }),
        ]}
        filters={{}}
      />,
    )
    expect(screen.getByTestId("section-title-LEGO")).toHaveTextContent("LEGO · 2件")
    expect(screen.getByTestId("section-title-GUNDAM")).toHaveTextContent("GUNDAM · 1件")
    expect(screen.queryByTestId("section-OTHER")).toBeNull() // 空区不显示
  })

  it("空收藏柜 CTA 为「入柜」", () => {
    render(<CollectionListView assets={[]} filters={{}} />)
    expect(screen.getByText("入柜", { selector: "a" })).toBeInTheDocument()
  })
})
