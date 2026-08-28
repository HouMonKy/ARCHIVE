import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { AddFlow } from "@/components/add-flow"
import { ReviewFlow } from "@/components/review-flow"
import type { CatalogItem } from "@/lib/services/catalog"
import type { RecognitionJobDTO, CandidateDTO } from "@/lib/services/recognition"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

/**
 * 添加页形态（识别主链路重构）：
 * - 生产无 Key（fixtureUi=false 且 recognitionMode=fixture）：显示「AI 未配置」，
 *   不渲染拍照/相册按钮，也绝不渲染演示样例区（不静默演示）；
 * - E2E（fixtureUi=true）：渲染两个大按钮（capture=environment）与演示样例区；
 * - 旧识别草稿不得自动替换上传首屏，只显示可选「继续上次识别」入口。
 */

const catalog: CatalogItem[] = [
  {
    id: "P01",
    canonicalName: "MG RX-78-2 Gundam Ver.3.0",
    nameZh: null,
    brand: "Bandai",
    category: "Gundam",
    grade: "MG",
    line: "UC",
    releaseYear: 2013,
    ownedCount: 0,
    imageSourcePage: null,
    imageSourceUrl: null,
    rightsBasis: null,
  },
]

describe("添加页：AI 未配置与拍照入口", () => {
  it("生产无 Key：显示 AI 未配置，无拍照/相册/演示样例入口，保留手动录入", () => {
    render(<AddFlow catalog={catalog} recognitionMode="fixture" fixtureUi={false} />)
    expect(screen.getByText(/AI 未配置/)).toBeTruthy()
    expect(screen.queryByTestId("input-capture")).toBeNull()
    expect(screen.queryByTestId("input-album")).toBeNull()
    expect(screen.queryByTestId("button-capture")).toBeNull()
    expect(screen.queryByTestId("button-album")).toBeNull()
    expect(screen.queryByTestId(/sample-/i)).toBeNull()
    expect(screen.getByTestId("goto-manual")).toBeTruthy()
  })

  it("E2E 演示形态：拍照按钮 capture=environment + 相册按钮 + 演示样例区", () => {
    render(<AddFlow catalog={catalog} recognitionMode="fixture" fixtureUi={true} />)
    const capture = screen.getByTestId("input-capture") as HTMLInputElement
    expect(capture.getAttribute("capture")).toBe("environment")
    expect(capture.getAttribute("accept")).toBe("image/*")
    expect(screen.getByTestId("input-album")).toBeTruthy()
    expect(screen.getByTestId("button-capture")).toBeTruthy()
    expect(screen.getByTestId("button-album")).toBeTruthy()
    expect(screen.getByTestId("sample-box-unicorn-demo.svg")).toBeTruthy()
  })

  it("Kimi 已配置：渲染拍照入口，不渲染演示样例区", () => {
    render(<AddFlow catalog={catalog} recognitionMode="kimi" fixtureUi={false} />)
    expect(screen.getByTestId("input-capture")).toBeTruthy()
    expect(screen.getByTestId("input-album")).toBeTruthy()
    expect(screen.queryByText(/AI 未配置/)).toBeNull()
    expect(screen.queryByTestId(/sample-/i)).toBeNull()
  })
})

function makeCandidate(overrides: Partial<CandidateDTO> = {}): CandidateDTO {
  return {
    key: "bandai-manual-949",
    productId: null,
    origin: "web_search",
    officialName: "MG 1/100 MSN-04 サザビーVer.ka",
    nameZh: "MG 1/100 沙扎比Ver.ka",
    productCode: "2204932",
    pageUrl: "https://manual.bandai-hobby.net/menus/detail/949",
    imageUrl: "https://bandai-hobby.net/images/155_1012_s_xxx.jpg",
    sourceDomain: "manual.bandai-hobby.net",
    snippet: "说明书页面",
    brand: "Bandai",
    grade: "MG",
    scale: "1/100",
    modelNumber: "MSN-04",
    series: "機動戦士ガンダム 逆襲のシャア",
    releaseYear: 2013,
    line: "UC",
    confidence: null,
    confidencePercent: null,
    fieldConfidences: null,
    uncertainFields: [],
    ownedCount: 0,
    ...overrides,
  }
}

function makeJob(overrides: Partial<RecognitionJobDTO> = {}): RecognitionJobDTO {
  return {
    jobId: "job-1",
    state: "SUCCEEDED",
    provider: "moonshot",
    providerVersion: "kimi/kimi-k2.6",
    isFixture: false,
    demoMode: false,
    extraction: {
      brand: "Bandai",
      name: "MG 1/100 サザビー Ver.Ka",
      series: "機動戦士ガンダム 逆襲のシャア",
      grade: "MG",
      scale: "1/100",
      modelNumber: "MSN-04",
    },
    candidates: [makeCandidate()],
    searchQueries: ["MG 1/100 MSN-04 サザビー Ver.Ka"],
    searchState: "OK",
    searchMessage: "找到 1 个官网候选，请核对后选择",
    nameZhDefault: "MG 1/100 沙扎比 Ver.Ka",
    cover: null,
    errorCode: null,
    message: "找到 1 个候选，请核对后选择",
    ...overrides,
  }
}

describe("识别结果核对流（AI 识别结果 / 官网搜索结果分开显示）", () => {
  it("标题为「AI 识别结果，请核对」，Kimi 原始提取原样可见且可编辑", () => {
    render(<ReviewFlow job={makeJob()} submitting={false} confirmError={null} onRetry={() => {}} onManual={() => {}} onConfirm={() => {}} />)
    expect(screen.getByTestId("ai-extraction-title")).toHaveTextContent("AI 识别结果，请核对")
    // 原始提取值可见（输入框 value）
    expect((screen.getByTestId("edit-name") as HTMLInputElement).value).toBe("MG 1/100 サザビー Ver.Ka")
    expect((screen.getByTestId("edit-brand") as HTMLInputElement).value).toBe("Bandai")
    expect((screen.getByTestId("edit-grade") as HTMLInputElement).value).toBe("MG")
    expect((screen.getByTestId("edit-scale") as HTMLInputElement).value).toBe("1/100")
    expect((screen.getByTestId("edit-model-number") as HTMLInputElement).value).toBe("MSN-04")
    expect((screen.getByTestId("edit-series") as HTMLInputElement).value).toBe("機動戦士ガンダム 逆襲のシャア")
    // 中文名称预填（词典默认值）且可编辑
    expect((screen.getByTestId("edit-name-zh") as HTMLInputElement).value).toBe("MG 1/100 沙扎比 Ver.Ka")
    fireEvent.change(screen.getByTestId("edit-name"), { target: { value: "改写的名称" } })
    expect((screen.getByTestId("edit-name") as HTMLInputElement).value).toBe("改写的名称")
  })

  it("官网搜索结果区：官方名称/品番/页面链接/官网图/来源域名；候选须显式选择（无自动选中）", () => {
    render(<ReviewFlow job={makeJob()} submitting={false} confirmError={null} onRetry={() => {}} onManual={() => {}} onConfirm={() => {}} />)
    expect(screen.getByTestId("official-search-title")).toHaveTextContent("官网搜索结果")
    const radio = screen.getByTestId("candidate-radio-bandai-manual-949") as HTMLInputElement
    expect(radio.checked).toBe(false) // 不自动选择
    expect(screen.getByTestId("candidate-facts-bandai-manual-949").textContent).toContain("品番 2204932")
    expect(screen.getByTestId("candidate-facts-bandai-manual-949").textContent).toContain("manual.bandai-hobby.net")
    expect(screen.getByTestId("candidate-page-bandai-manual-949")).toHaveAttribute(
      "href",
      "https://manual.bandai-hobby.net/menus/detail/949",
    )
    expect(screen.getByTestId("candidate-image-bandai-manual-949")).toBeTruthy()
    fireEvent.click(radio)
    expect((screen.getByTestId("candidate-radio-bandai-manual-949") as HTMLInputElement).checked).toBe(true)
    expect(screen.getByTestId("confirm-summary").textContent).toContain("官网商品")
  })

  it("无官网结果：显示「未找到官网商品」+「重新搜索官网」按钮", () => {
    render(
      <ReviewFlow
        job={makeJob({ candidates: [], searchState: "OK", searchMessage: null, searchQueries: [] })}
        submitting={false}
        confirmError={null}
        onRetry={() => {}}
        onManual={() => {}}
        onConfirm={() => {}}
      />,
    )
    expect(screen.getByTestId("no-official-result")).toHaveTextContent("未找到官网商品")
    expect(screen.getByTestId("re-search-official")).toBeTruthy()
    expect(screen.getByTestId("confirm-save").textContent).toContain("建立自定义收藏")
  })

  it("「重新搜索官网」调用重搜接口并替换候选（修改名称后重搜）", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [makeCandidate({ key: "bandai-item-01_15", pageUrl: "https://bandai-hobby.net/item/01_15/", productCode: null })],
        searchQueries: ["site:bandai-hobby.net サザビー"],
        searchState: "OK",
        searchMessage: "找到 1 个官网候选，请核对后选择",
      }),
    })
    vi.stubGlobal("fetch", fetchMock)
    render(<ReviewFlow job={makeJob()} submitting={false} confirmError={null} onRetry={() => {}} onManual={() => {}} onConfirm={() => {}} />)
    // 修改名称
    fireEvent.change(screen.getByTestId("edit-name"), { target: { value: "MG 1/100 MSN-04 サザビー Ver.Ka" } })
    fireEvent.click(screen.getByTestId("re-search-official"))
    await screen.findByTestId("candidate-radio-bandai-item-01_15")
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/recognition/search",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as { extraction: { name: string } }
    expect(body.extraction.name).toBe("MG 1/100 MSN-04 サザビー Ver.Ka")
    // 重搜后无自动选择
    expect((screen.getByTestId("candidate-radio-bandai-item-01_15") as HTMLInputElement).checked).toBe(false)
    vi.unstubAllGlobals()
  })
})

describe("添加页：旧识别草稿不得自动替换上传首屏（回归）", () => {
  it("有草稿：首屏仍是拍照/相册两个按钮，草稿只作可选「继续上次识别」入口", () => {
    render(<AddFlow catalog={catalog} recognitionMode="kimi" fixtureUi={false} initialDraft={makeJob()} />)
    expect(screen.getByTestId("button-capture")).toBeTruthy()
    expect(screen.getByTestId("button-album")).toBeTruthy()
    // 首屏不是核对界面
    expect(screen.queryByTestId("review-panel")).toBeNull()
    // 可选继续入口
    expect(screen.getByTestId("continue-draft")).toBeTruthy()
    expect(screen.getByTestId("draft-resume")).toBeTruthy()
  })

  it("点击「继续上次识别」进入核对界面（AI 识别结果可编辑 + 官网候选）", () => {
    render(<AddFlow catalog={catalog} recognitionMode="kimi" fixtureUi={false} initialDraft={makeJob()} />)
    fireEvent.click(screen.getByTestId("continue-draft"))
    expect(screen.getByTestId("ai-extraction-title")).toHaveTextContent("AI 识别结果，请核对")
    expect(screen.getByTestId("official-search-panel")).toBeTruthy()
    expect(screen.getByTestId("confirm-save")).toBeTruthy()
  })

  it("无候选草稿（candidates 为空）：同样不隐藏上传首屏（可继续去重搜）", () => {
    render(
      <AddFlow
        catalog={catalog}
        recognitionMode="kimi"
        fixtureUi={false}
        initialDraft={makeJob({ candidates: [] })}
      />,
    )
    expect(screen.getByTestId("button-capture")).toBeTruthy()
    expect(screen.getByTestId("button-album")).toBeTruthy()
    // 首屏不被替换
    expect(screen.queryByTestId("review-panel")).toBeNull()
    // 无候选草稿仍可继续（进入核对页可修改名称重搜）
    expect(screen.getByTestId("continue-draft")).toBeTruthy()
    fireEvent.click(screen.getByTestId("continue-draft"))
    expect(screen.getByTestId("no-official-result")).toBeTruthy()
  })
})
