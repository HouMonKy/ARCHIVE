/**
 * Visitor 面试样例数据。
 *
 * 这是 Owner 当前收藏中各取 5 件 LEGO / Bandai 后形成的脱敏快照：只保留
 * 官方商品元数据、收藏状态、购买日期与价格。原始识别照片、用户照片、备注、
 * 识别任务、会话、偏好与 API 配置均不会复制到 Visitor 租户或 Git 仓库。
 */

export interface VisitorCatalogSeed {
  id: string
  brand: "LEGO" | "Bandai"
  category: string
  line: string | null
  grade: string
  series: string
  canonicalName: string
  nameZh: string | null
  nameZhSource: string | null
  modelNumber: string
  scale: string | null
  releaseYear: number | null
  officialProductCode: string | null
  officialPageUrl: string
  officialImageUrl: string
}

export interface VisitorAssetSeed {
  id: string
  catalogProductId: string
  purchasedAtIso: string
  purchasePriceMinor: number
}

export const VISITOR_CATALOG_PRODUCTS: readonly VisitorCatalogSeed[] = [
  {
    id: "lego-76178",
    brand: "LEGO",
    category: "LEGO",
    line: null,
    grade: "MARVEL",
    series: "Marvel",
    canonicalName: "Daily Bugle",
    nameZh: null,
    nameZhSource: null,
    modelNumber: "76178",
    scale: null,
    releaseYear: null,
    officialProductCode: "76178",
    officialPageUrl: "https://www.lego.com/en-us/product/daily-bugle-76178",
    officialImageUrl: "https://www.lego.com/cdn/product-assets/product.img.pri/76178_Prod.png",
  },
  {
    id: "lego-11389",
    brand: "LEGO",
    category: "LEGO",
    line: null,
    grade: "PROJECT HAIL MARY",
    series: "Project Hail Mary",
    canonicalName: "Project Hail Mary",
    nameZh: null,
    nameZhSource: null,
    modelNumber: "11389",
    scale: null,
    releaseYear: null,
    officialProductCode: "11389",
    officialPageUrl: "https://www.lego.com/en-us/product/11389",
    officialImageUrl: "https://www.lego.com/cdn/product-assets/product.img.pri/11389_Prod.png",
  },
  {
    id: "lego-10327",
    brand: "LEGO",
    category: "LEGO",
    line: null,
    grade: "DUNE",
    series: "Dune",
    canonicalName: "Dune Atreides Royal Ornithopter",
    nameZh: null,
    nameZhSource: null,
    modelNumber: "10327",
    scale: null,
    releaseYear: null,
    officialProductCode: "10327",
    officialPageUrl: "https://www.lego.com/en-us/product/dune-atreides-royal-ornithopter-10327",
    officialImageUrl: "https://www.lego.com/cdn/product-assets/product.img.pri/10327_Prod.png",
  },
  {
    id: "lego-77240",
    brand: "LEGO",
    category: "LEGO",
    line: null,
    grade: "SPEED CHAMPIONS",
    series: "Speed Champions",
    canonicalName: "Bugatti Centodieci Hyper Sports Car",
    nameZh: null,
    nameZhSource: null,
    modelNumber: "77240",
    scale: null,
    releaseYear: null,
    officialProductCode: "77240",
    officialPageUrl: "https://www.lego.com/en-us/product/bugatti-centodieci-hyper-sports-car-77240",
    officialImageUrl: "https://www.lego.com/cdn/product-assets/product.img.pri/77240_Prod.png",
  },
  {
    id: "lego-40891",
    brand: "LEGO",
    category: "LEGO",
    line: null,
    grade: "STRANGER THINGS",
    series: "Stranger Things",
    canonicalName: "The Squawk Radio Station",
    nameZh: null,
    nameZhSource: null,
    modelNumber: "40891",
    scale: null,
    releaseYear: null,
    officialProductCode: "40891",
    officialPageUrl: "https://www.lego.com/en-us/product/the-squawk-radio-station-40891",
    officialImageUrl: "https://www.lego.com/cdn/product-assets/product.img.pri/40891_Prod.png",
  },
  {
    id: "bandai-item-01_4230",
    brand: "Bandai",
    category: "Gundam",
    line: "CE",
    grade: "MGEX",
    series: "机动战士高达SEED DESTINY",
    canonicalName: "MGEX 1/100 ストライクフリーダムガンダム",
    nameZh: "MGEX 1/100 强袭自由高达",
    nameZhSource: "official",
    modelNumber: "ZGMF-X20A",
    scale: "1/100",
    releaseYear: 2022,
    officialProductCode: "01_4230",
    officialPageUrl: "https://bandai-hobby.net/item/01_4230/",
    officialImageUrl: "https://d3bk8pkqsprcvh.cloudfront.net/product/4549660823772/4549660823772_a.jpg",
  },
  {
    id: "bandai-item-01_15",
    brand: "Bandai",
    category: "Gundam",
    line: "OTHER",
    grade: "MG",
    series: "机动战士高达 逆袭的夏亚",
    canonicalName: "MG 1/100 サザビーVer.Ka",
    nameZh: "MG 1/100 沙扎比 Ver.Ka",
    nameZhSource: "official",
    modelNumber: "MSN-04",
    scale: "1/100",
    releaseYear: 2013,
    officialProductCode: "01_15",
    officialPageUrl: "https://bandai-hobby.net/item/01_15/",
    officialImageUrl: "https://bandai-a.akamaihd.net/bc/img/model/b/1000083059_1.jpg",
  },
  {
    id: "bandai-item-01_3328",
    brand: "Bandai",
    category: "Gundam",
    line: "OTHER",
    grade: "PG",
    series: "机动战士高达",
    canonicalName: "PG UNLEASHED 1/60 RX-78-2 ガンダム",
    nameZh: "PG UNLEASHED 1/60 RX-78-2 高达",
    nameZhSource: "official",
    modelNumber: "RX-78-2",
    scale: "1/60",
    releaseYear: 2020,
    officialProductCode: "01_3328",
    officialPageUrl: "https://bandai-hobby.net/item/01_3328/",
    officialImageUrl: "https://bandai-a.akamaihd.net/bc/images/shop_product_image_d/4573102607652_01.jpg",
  },
  {
    id: "bandai-item-01_3524",
    brand: "Bandai",
    category: "Gundam",
    line: "OTHER",
    grade: "RG",
    series: "机动战士高达 逆袭的夏亚",
    canonicalName: "RG 1/144 Hi-νガンダム",
    nameZh: "RG 1/144 Hi-ν高达",
    nameZhSource: "official",
    modelNumber: "RX-93-ν2",
    scale: "1/144",
    releaseYear: 2021,
    officialProductCode: null,
    officialPageUrl: "https://bandai-hobby.net/item/01_3524/",
    officialImageUrl: "https://bandai-a.akamaihd.net/bc/img/model/b/1000152507_1.jpg",
  },
  {
    id: "bandai-item-01_3656",
    brand: "Bandai",
    category: "Gundam",
    line: "AD",
    grade: "MG",
    series: "机动战士高达00",
    canonicalName: "MG 1/100 ガンダムヴァーチェ",
    nameZh: "MG 1/100 高达德天使",
    nameZhSource: "official",
    modelNumber: "GN-005",
    scale: "1/100",
    releaseYear: 2021,
    officialProductCode: null,
    officialPageUrl: "https://bandai-hobby.net/item/01_3656/",
    officialImageUrl: "https://bandai-a.akamaihd.net/bc/img/model/b/1000152509_1.jpg",
  },
] as const

export const VISITOR_ASSETS: readonly VisitorAssetSeed[] = [
  { id: "visitor-lego-76178", catalogProductId: "lego-76178", purchasedAtIso: "2026-08-13T16:00:00.000Z", purchasePriceMinor: 230_000 },
  { id: "visitor-lego-11389", catalogProductId: "lego-11389", purchasedAtIso: "2026-03-23T16:00:00.000Z", purchasePriceMinor: 75_000 },
  { id: "visitor-lego-10327", catalogProductId: "lego-10327", purchasedAtIso: "2026-01-26T16:00:00.000Z", purchasePriceMinor: 98_000 },
  { id: "visitor-lego-77240", catalogProductId: "lego-77240", purchasedAtIso: "2026-01-26T16:00:00.000Z", purchasePriceMinor: 16_800 },
  { id: "visitor-lego-40891", catalogProductId: "lego-40891", purchasedAtIso: "2026-01-01T16:00:00.000Z", purchasePriceMinor: 49_800 },
  { id: "visitor-bandai-01_4230", catalogProductId: "bandai-item-01_4230", purchasedAtIso: "2023-08-11T16:00:00.000Z", purchasePriceMinor: 97_000 },
  { id: "visitor-bandai-01_15", catalogProductId: "bandai-item-01_15", purchasedAtIso: "2023-02-15T16:00:00.000Z", purchasePriceMinor: 48_500 },
  { id: "visitor-bandai-01_3328", catalogProductId: "bandai-item-01_3328", purchasedAtIso: "2022-06-04T16:00:00.000Z", purchasePriceMinor: 182_000 },
  { id: "visitor-bandai-01_3524", catalogProductId: "bandai-item-01_3524", purchasedAtIso: "2022-01-26T16:00:00.000Z", purchasePriceMinor: 37_500 },
  { id: "visitor-bandai-01_3656", catalogProductId: "bandai-item-01_3656", purchasedAtIso: "2022-01-23T16:00:00.000Z", purchasePriceMinor: 35_000 },
] as const
