import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { AssetEditForm } from "@/components/asset-edit-form"
import type { AssetDTO } from "@/lib/services/assets"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

function demoAsset(overrides: Partial<AssetDTO> = {}): AssetDTO {
  return {
    id: "A03",
    displayName: "RG ν Gundam",
    originalName: null,
    nameZh: null,
    catalogProductId: "P04",
    customName: null,
    customBrand: null,
    brand: "Bandai",
    grade: "RG",
    line: "UC",
    releaseYear: 2019,
    modelNumber: null,
    officialPageUrl: null,
    catalogImageStatus: null,
    dispositionState: "ACTIVE",
    archivedAt: null,
    buildState: "UNOPENED",
    progress: 0,
    purchasePriceMinor: 32000,
    currency: "CNY",
    purchasedAt: null,
    completedAt: null,
    note: null,
    confirmedAt: new Date("2026-08-12T00:00:00+08:00"),
    cover: null,
    lastActivityAt: new Date("2026-08-12T00:00:00+08:00"),
    recognitionCorrected: null,
    ...overrides,
  }
}

/** D-04：状态变更遵守 §7 约束；切换 COMPLETED 自动 100% */
describe("AssetEditForm 组件", () => {
  it("切换为制作中时出现 1–99 进度输入", () => {
    render(<AssetEditForm asset={demoAsset()} />)
    expect(screen.queryByLabelText(/制作进度/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("制作状态"), { target: { value: "BUILDING" } })
    expect(screen.getByLabelText(/制作进度/)).toBeInTheDocument()
  })

  it("切换为已完成时显示自动 100%（不可改小）", () => {
    render(<AssetEditForm asset={demoAsset()} />)
    fireEvent.change(screen.getByLabelText("制作状态"), { target: { value: "COMPLETED" } })
    expect(screen.getByText(/100%（切换为已完成时自动写入）/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/制作进度/)).not.toBeInTheDocument()
  })

  it("制作中输入越界进度时客户端拦截并提示", async () => {
    vi.stubGlobal("fetch", vi.fn())
    render(<AssetEditForm asset={demoAsset({ buildState: "BUILDING", progress: 40 })} />)
    fireEvent.change(screen.getByLabelText(/制作进度/), { target: { value: "0" } })
    fireEvent.click(screen.getByTestId("asset-save"))
    expect(await screen.findByTestId("edit-error")).toHaveTextContent("1–99")
  })

  it("保存提交 PATCH 且携带状态与进度字段", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ asset: {} }) })
    vi.stubGlobal("fetch", fetchMock)
    render(<AssetEditForm asset={demoAsset({ buildState: "UNOPENED" })} />)
    fireEvent.change(screen.getByLabelText("制作状态"), { target: { value: "BUILDING" } })
    fireEvent.change(screen.getByLabelText(/制作进度/), { target: { value: "40" } })
    fireEvent.click(screen.getByTestId("asset-save"))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/assets/A03")
    expect(init.method).toBe("PATCH")
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.buildState).toBe("BUILDING")
    expect(body.progress).toBe(40)
  })

  it("服务端校验失败时展示错误信息", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "已完成时进度必须为 100%" }),
    })
    vi.stubGlobal("fetch", fetchMock)
    render(<AssetEditForm asset={demoAsset({ buildState: "COMPLETED", progress: 100 })} />)
    fireEvent.click(screen.getByTestId("asset-save"))
    expect(await screen.findByTestId("edit-error")).toHaveTextContent("100%")
  })
})
