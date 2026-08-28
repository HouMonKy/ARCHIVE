import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ManualEntryForm } from "@/components/manual-entry-form"
import type { CatalogItem } from "@/lib/services/catalog"
import type { AssetDTO } from "@/lib/services/assets"
import { getTestDb, resetTestDb } from "../../helpers/db"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

const catalog: CatalogItem[] = [
  { id: "P01", nameZh: null, canonicalName: "MG RX-78-2 Gundam Ver.3.0", brand: "Bandai", category: "Gundam", grade: "MG", line: "UC", releaseYear: 2013, ownedCount: 1, imageSourcePage: null, imageSourceUrl: null, rightsBasis: null },
  { id: "P02", nameZh: null, canonicalName: "MG Zeta Gundam Ver.Ka", brand: "Bandai", category: "Gundam", grade: "MG", line: "UC", releaseYear: 2023, ownedCount: 0, imageSourcePage: null, imageSourceUrl: null, rightsBasis: null },
]

function setupFetchMock(payload: Record<string, unknown>, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => payload,
  })
}

/** 手动录入兜底（FR-01/FR-10）：任何识别失败都不阻塞手动新增 */
describe("ManualEntryForm 组件", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it("未选择商品提交时显示错误，不发起请求", async () => {
    const fetchMock = setupFetchMock({})
    vi.stubGlobal("fetch", fetchMock)
    render(<ManualEntryForm catalog={catalog} />)
    fireEvent.click(screen.getByTestId("manual-submit"))
    expect(await screen.findByTestId("error-banner")).toHaveTextContent("请选择目录商品")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("自定义商品缺少品牌时显示错误", async () => {
    vi.stubGlobal("fetch", setupFetchMock({}))
    render(<ManualEntryForm catalog={catalog} />)
    fireEvent.change(screen.getByLabelText("商品来源"), { target: { value: "custom" } })
    fireEvent.change(screen.getByLabelText("商品名"), { target: { value: "Technic Supercar Demo" } })
    fireEvent.click(screen.getByTestId("manual-submit"))
    expect(await screen.findByTestId("error-banner")).toHaveTextContent("品牌")
  })

  it("制作中进度越界时显示错误（0 与 100 均非法）", async () => {
    vi.stubGlobal("fetch", setupFetchMock({}))
    render(<ManualEntryForm catalog={catalog} />)
    fireEvent.change(screen.getByLabelText("目录商品"), { target: { value: "P02" } })
    fireEvent.change(screen.getByLabelText("制作状态"), { target: { value: "BUILDING" } })
    fireEvent.click(screen.getByTestId("manual-submit"))
    expect(await screen.findByTestId("error-banner")).toHaveTextContent("1–99")
  })

  it("选择已拥有商品时显示重复提示（FR-04）", () => {
    vi.stubGlobal("fetch", setupFetchMock({}))
    render(<ManualEntryForm catalog={catalog} />)
    fireEvent.change(screen.getByLabelText("目录商品"), { target: { value: "P01" } })
    expect(screen.getByTestId("manual-duplicate-warning-P01")).toHaveTextContent("已有 1 件")
  })

  it("合法提交携带幂等键与商品字段调用确认接口", async () => {
    const asset = {
      id: "asset-new",
      displayName: "MG Zeta Gundam Ver.Ka",
    } as unknown as AssetDTO
    const fetchMock = setupFetchMock({ asset, created: true })
    vi.stubGlobal("fetch", fetchMock)
    render(<ManualEntryForm catalog={catalog} />)
    fireEvent.change(screen.getByLabelText("目录商品"), { target: { value: "P02" } })
    fireEvent.change(screen.getByLabelText("制作状态"), { target: { value: "BUILDING" } })
    fireEvent.change(screen.getByLabelText(/制作进度/), { target: { value: "40" } })
    fireEvent.change(screen.getByLabelText(/购入价/), { target: { value: "700" } })
    fireEvent.click(screen.getByTestId("manual-submit"))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/assets")
    expect(init.method).toBe("POST")
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.productId).toBe("P02")
    expect(body.buildState).toBe("BUILDING")
    expect(body.progress).toBe(40)
    expect(body.purchasePriceMinor).toBe(70000)
    expect(typeof body.idempotencyKey).toBe("string")
    expect((body.idempotencyKey as string).length).toBeGreaterThanOrEqual(8)
  })

  it("服务端返回错误时显示错误信息且不误报成功", async () => {
    const fetchMock = setupFetchMock({ error: "制作中的进度必须为 1–99%" }, false)
    vi.stubGlobal("fetch", fetchMock)
    render(<ManualEntryForm catalog={catalog} />)
    fireEvent.change(screen.getByLabelText("目录商品"), { target: { value: "P02" } })
    fireEvent.click(screen.getByTestId("manual-submit"))
    expect(await screen.findByTestId("error-banner")).toHaveTextContent("1–99")
  })
})

describe("确认入库服务与组件口径一致性（真实数据库）", () => {
  it("手动提交的数据可以通过服务层确认（端到端一致性冒烟）", async () => {
    await resetTestDb()
    const { confirmAsset } = await import("@/lib/services/assets")
    const result = await confirmAsset(getTestDb(), "kai", {
      idempotencyKey: "manual-e2e-key-1",
      productId: "P02",
      dispositionState: "ACTIVE",
      buildState: "BUILDING",
      progress: 40,
      purchasePriceMinor: 70000,
    })
    expect(result.created).toBe(true)
    expect(result.asset.displayName).toBe("MG Zeta Gundam Ver.Ka")
  })
})
