/**
 * D0 冻结演示数据集（dataset_version=demo-v1）。
 * 全部为 PRD 第 19 节规定的合成演示记录，不代表真实新品或在售价格。
 */

export const DATASET_VERSION = "demo-v1"

/** 演示时钟：PRD 第 19 节统一口径（Asia/Shanghai，报告日期 2026-08-25） */
export const DEMO_EPOCH_ISO = "2026-08-25T00:00:00+08:00"

export const DEMO_USER = {
  id: "kai",
  displayName: "Kai",
  locale: "zh-CN",
  timezone: "Asia/Shanghai",
} as const

export interface DemoCatalogProduct {
  id: string
  brand: string
  category: string
  line: string
  grade: string
  canonicalName: string
  releaseYear: number
  /** 官方机体型号/识别码（公开事实，用于识别匹配的附加文本） */
  modelCode?: string
}

/** 目录固定 12 条：品牌均为 Bandai，品类均为 Gundam */
export const DEMO_CATALOG_PRODUCTS: DemoCatalogProduct[] = [
  { id: "P01", brand: "Bandai", category: "Gundam", line: "UC", grade: "MG", canonicalName: "MG RX-78-2 Gundam Ver.3.0", releaseYear: 2013, modelCode: "RX-78-2" },
  { id: "P02", brand: "Bandai", category: "Gundam", line: "UC", grade: "MG", canonicalName: "MG Zeta Gundam Ver.Ka", releaseYear: 2023, modelCode: "MSZ-006" },
  { id: "P03", brand: "Bandai", category: "Gundam", line: "UC", grade: "MGEX", canonicalName: "MGEX Unicorn Gundam Ver.Ka", releaseYear: 2020, modelCode: "RX-0" },
  { id: "P04", brand: "Bandai", category: "Gundam", line: "UC", grade: "RG", canonicalName: "RG ν Gundam", releaseYear: 2019, modelCode: "RX-93" },
  { id: "P05", brand: "Bandai", category: "Gundam", line: "UC", grade: "PG", canonicalName: "PG Unleashed RX-78-2 Gundam", releaseYear: 2020, modelCode: "RX-78-2" },
  { id: "P06", brand: "Bandai", category: "Gundam", line: "UC", grade: "HG", canonicalName: "HGUC Narrative Gundam C-Packs", releaseYear: 2019, modelCode: "RX-95" },
  { id: "P07", brand: "Bandai", category: "Gundam", line: "UC", grade: "MG", canonicalName: "MG Sinanju Stein Narrative Ver. Ver.Ka", releaseYear: 2024, modelCode: "MSN-06S" },
  { id: "P08", brand: "Bandai", category: "Gundam", line: "UC", grade: "RG", canonicalName: "RG Sazabi", releaseYear: 2018, modelCode: "MSN-04" },
  { id: "P09", brand: "Bandai", category: "Gundam", line: "UC", grade: "HG", canonicalName: "HGUC Gundam Mk-II Revive", releaseYear: 2015, modelCode: "RX-178" },
  { id: "P10", brand: "Bandai", category: "Gundam", line: "UC", grade: "MG", canonicalName: "MG Hyaku-Shiki Ver.2.0", releaseYear: 2015, modelCode: "MSN-00100" },
  { id: "P11", brand: "Bandai", category: "Gundam", line: "AC", grade: "MG", canonicalName: "MG Wing Gundam Zero EW Ver.Ka", releaseYear: 2020, modelCode: "XXXG-00W0" },
  { id: "P12", brand: "Bandai", category: "Gundam", line: "CE", grade: "MG", canonicalName: "MG Freedom Gundam Ver.2.0", releaseYear: 2016, modelCode: "ZGMF-X10A" },
]

export interface DemoAsset {
  id: string
  catalogProductId: string | null
  customName: string | null
  customBrand: string | null
  dispositionState: "ACTIVE" | "SOLD"
  buildState: "UNOPENED" | "OPENED" | "BUILDING" | "COMPLETED" | "NOT_APPLICABLE"
  progress: number
  purchasePriceMinor: number | null
  /** 最后更新（PRD 第 19 节表格），亦作为制作停滞判定基准 */
  lastActivityIso: string
}

/** Kai 的实体固定 8 件；价格单位为分，均已确认且未归档 */
export const DEMO_ASSETS: DemoAsset[] = [
  { id: "A01", catalogProductId: "P01", customName: null, customBrand: null, dispositionState: "ACTIVE", buildState: "COMPLETED", progress: 100, purchasePriceMinor: 45000, lastActivityIso: "2026-08-10T00:00:00+08:00" },
  { id: "A02", catalogProductId: "P03", customName: null, customBrand: null, dispositionState: "ACTIVE", buildState: "BUILDING", progress: 65, purchasePriceMinor: 120000, lastActivityIso: "2026-08-01T00:00:00+08:00" },
  { id: "A03", catalogProductId: "P04", customName: null, customBrand: null, dispositionState: "ACTIVE", buildState: "UNOPENED", progress: 0, purchasePriceMinor: 32000, lastActivityIso: "2026-08-12T00:00:00+08:00" },
  { id: "A04", catalogProductId: "P08", customName: null, customBrand: null, dispositionState: "ACTIVE", buildState: "OPENED", progress: 0, purchasePriceMinor: 35000, lastActivityIso: "2026-08-14T00:00:00+08:00" },
  { id: "A05", catalogProductId: "P09", customName: null, customBrand: null, dispositionState: "ACTIVE", buildState: "COMPLETED", progress: 100, purchasePriceMinor: null, lastActivityIso: "2026-08-16T00:00:00+08:00" },
  { id: "A06", catalogProductId: "P10", customName: null, customBrand: null, dispositionState: "ACTIVE", buildState: "UNOPENED", progress: 0, purchasePriceMinor: 50000, lastActivityIso: "2026-08-18T00:00:00+08:00" },
  { id: "A07", catalogProductId: "P11", customName: null, customBrand: null, dispositionState: "SOLD", buildState: "COMPLETED", progress: 100, purchasePriceMinor: 48000, lastActivityIso: "2026-08-19T00:00:00+08:00" },
  { id: "A08", catalogProductId: null, customName: "Technic Supercar Demo", customBrand: "LEGO", dispositionState: "ACTIVE", buildState: "NOT_APPLICABLE", progress: 0, purchasePriceMinor: 90000, lastActivityIso: "2026-08-20T00:00:00+08:00" },
]

export interface DemoReleaseEvent {
  id: string
  catalogProductId: string
  title: string
  announcedIso: string
  priceMinor: number
}

/** 新品事件固定 4 条；来源统一为 ARCHIVE Demo Feed 与本地 /demo/sources/{id} */
export const DEMO_RELEASE_EVENTS: DemoReleaseEvent[] = [
  { id: "E01", catalogProductId: "P02", title: "MG Zeta Gundam Ver.Ka 补货发售（演示事件）", announcedIso: "2026-08-20T00:00:00+08:00", priceMinor: 70000 },
  { id: "E02", catalogProductId: "P06", title: "HGUC Narrative Gundam C-Packs 新品（演示事件）", announcedIso: "2026-08-18T00:00:00+08:00", priceMinor: 28000 },
  { id: "E03", catalogProductId: "P12", title: "MG Freedom Gundam Ver.2.0 再版（演示事件）", announcedIso: "2026-08-15T00:00:00+08:00", priceMinor: 55000 },
  { id: "E04", catalogProductId: "P03", title: "MGEX Unicorn Gundam Ver.Ka 限定套装（演示事件）", announcedIso: "2026-08-22T00:00:00+08:00", priceMinor: 130000 },
]

export const DEMO_EVENT_SOURCE_NAME = "ARCHIVE Demo Feed"

/** 意向 I01 = P11/WISHLIST */
export const DEMO_INTENTS = [{ catalogProductId: "P11", state: "WISHLIST" as const }]

/** 显式偏好：品类 Gundam、等级 MG、路线 UC、月预算 200000 分 */
export const DEMO_PREFERENCES = [
  { kind: "CATEGORY", value: "Gundam" },
  { kind: "GRADE", value: "MG" },
  { kind: "ROUTE", value: "UC" },
  { kind: "MONTHLY_BUDGET_MINOR", value: "200000" },
]

export interface RecognitionFixtureSample {
  /** 样例文件名（public/demo/samples/ 下） */
  fileName: string
  /** 期望结果：候选商品与置信度 */
  candidates: { productId: string; confidence: number }[]
  /** 字段级不确定项（低置信样例使用） */
  fieldConfidences?: Record<string, number>
  /** 模拟的视觉提取（识别主链路重构：结果页展示 AI 识别结果） */
  extraction?: { brand: string; name: string; series: string; grade: string; scale: string; modelNumber: string }
  errorCode?: "TIMEOUT"
}

/** 识别样例固定 4 个（PRD 第 19 节 3 个 + 超时演示样例），按文件内容 SHA-256 匹配 */
export const RECOGNITION_SAMPLES: RecognitionFixtureSample[] = [
  {
    fileName: "box-unicorn-demo.svg",
    candidates: [{ productId: "P03", confidence: 0.96 }],
    fieldConfidences: { name: 0.96, grade: 0.95, line: 0.93, releaseYear: 0.9 },
    extraction: { brand: "Bandai", name: "MG Unicorn Gundam Ver.Ka", series: "机动战士高达UC", grade: "MG", scale: "1/100", modelNumber: "RX-0" },
  },
  {
    fileName: "box-zeta-glare-demo.svg",
    candidates: [
      { productId: "P02", confidence: 0.74 },
      { productId: "P09", confidence: 0.66 },
      { productId: "P10", confidence: 0.61 },
    ],
    fieldConfidences: { name: 0.6, grade: 0.55, line: 0.52, releaseYear: 0.5 },
    extraction: { brand: "Bandai", name: "MG Zeta Gundam Ver.Ka", series: "机动战士Z高达", grade: "MG", scale: "1/100", modelNumber: "MSZ-006" },
  },
  {
    fileName: "box-unknown-demo.svg",
    candidates: [],
    extraction: { brand: "Bandai", name: "未知商品", series: "", grade: "", scale: "", modelNumber: "" },
  },
  {
    fileName: "box-timeout-demo.svg",
    candidates: [],
    errorCode: "TIMEOUT",
  },
  {
    // 真实照片形态样例（合成 JPEG，非官方摄影）：验证栅格图上传→封面存储→一键确认全链路
    fileName: "photo-sample.jpg",
    candidates: [{ productId: "P03", confidence: 0.95 }],
    extraction: { brand: "Bandai", name: "MG Unicorn Gundam Ver.Ka", series: "机动战士高达UC", grade: "MG", scale: "1/100", modelNumber: "RX-0" },
  },
]
