import type { PrismaClient, CollectionAsset, CatalogProduct } from "@prisma/client"
import { legoDisplayName } from "../names/lego-naming"

/**
 * 动态收藏地图（收藏工作台改造）：
 * - 从 ACTIVE 未归档藏品实时生成（不依赖固定 RouteNode，历史表不删但建议页停用）；
 * - 成图规则：同 series/主题 ≥2 件，或同品牌 + 等级/比例 ≥2 件；
 * - 卡片列出形成依据的真实藏品、共同特征与可关注方向；无固定总量、无完成百分比；
 * - DeepSeek 只可润色标题/摘要/制作建议（AI 失败回退确定性文案），事实来自传入藏品。
 */

export interface MapCardAsset {
  id: string
  displayName: string
  brand: string
  grade: string | null
  scale: string | null
  series: string | null
  releaseYear: number | null
}

export interface CollectionMapCard {
  /** 卡片标识（确定性派生：groupKey） */
  key: string
  title: string
  /** 共同特征（事实描述：依据什么把藏品聚成一组） */
  commonTrait: string
  /** 形成依据的真实藏品（全部列出） */
  assets: MapCardAsset[]
  /** 可关注方向（确定性建议文案；润色只改写不添事实） */
  suggestion: string
  /** 依据类型：series（同作品/主题）或 brand-grade（同品牌等级/比例） */
  basis: "series" | "brand-grade"
}

type AssetRow = CollectionAsset & { product: CatalogProduct | null }

function toMapAsset(a: AssetRow): MapCardAsset {
  return {
    id: a.id,
    displayName: a.product
      ? legoDisplayName(a.product.brand, a.product.canonicalName, a.product.nameZh, a.product.modelNumber)
      : (a.customName ?? "未命名"),
    brand: a.product?.brand ?? a.customBrand ?? "其他",
    grade: a.product?.grade ?? null,
    scale: a.product?.scale ?? null,
    series: a.product?.series ?? null,
    releaseYear: a.product?.releaseYear ?? null,
  }
}

/** 从 ACTIVE 未归档藏品生成收藏地图卡（纯函数：单测覆盖）；最多 maxCards 张 */
export function buildCollectionMaps(assets: AssetRow[], maxCards = 3): CollectionMapCard[] {
  const active = assets.filter((a) => a.dispositionState === "ACTIVE" && a.archivedAt == null)
  const mapAssets = active.map(toMapAsset)
  const cards: CollectionMapCard[] = []
  const usedAssetIds = new Set<string>()

  // 规则 1：同 series/主题 ≥2 件（series 非空才参与——不猜）
  const bySeries = new Map<string, AssetRow[]>()
  for (const a of active) {
    const series = a.product?.series?.trim()
    if (!series) continue
    const list = bySeries.get(series) ?? []
    list.push(a)
    bySeries.set(series, list)
  }
  const seriesGroups = [...bySeries.entries()]
    .filter(([, list]) => list.length >= 2)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))

  for (const [series, list] of seriesGroups) {
    if (cards.length >= maxCards) break
    cards.push({
      key: `series-${series}`,
      title: `${series}`,
      commonTrait: `同属「${series}」系列/主题`,
      assets: list.map(toMapAsset),
      basis: "series",
      suggestion: `「${series}」已有 ${list.length} 件藏品；可关注该系列的后续新品或补齐已公布的关联商品。`,
    })
    for (const a of list) usedAssetIds.add(a.id)
  }

  // 规则 2：同品牌 + 等级/比例 ≥2 件（未被 series 卡使用的藏品参与，避免重复堆叠）
  const byBrandGrade = new Map<string, AssetRow[]>()
  for (const a of active) {
    if (usedAssetIds.has(a.id)) continue
    const brand = a.product?.brand ?? a.customBrand
    if (!brand) continue
    const grade = a.product?.grade?.trim()
    const scale = a.product?.scale?.trim()
    // 等级优先，缺等级用比例，两者皆缺不参与
    const trait = grade ? `${brand}·${grade}` : scale ? `${brand}·${scale}` : null
    if (!trait) continue
    const list = byBrandGrade.get(trait) ?? []
    list.push(a)
    byBrandGrade.set(trait, list)
  }
  const brandGradeGroups = [...byBrandGrade.entries()]
    .filter(([, list]) => list.length >= 2)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))

  for (const [trait, list] of brandGradeGroups) {
    if (cards.length >= maxCards) break
    const first = toMapAsset(list[0]!)
    cards.push({
      key: `brand-grade-${trait}`,
      title: `${trait}${first.scale ? `（${first.scale}）` : ""}`,
      commonTrait: `同为 ${trait}${first.scale ? "，比例 " + first.scale : ""}`,
      assets: list.map(toMapAsset),
      basis: "brand-grade",
      suggestion: `${trait} 已有 ${list.length} 件；可围绕该等级/比例关注同线新品或推进制作。`,
    })
    for (const a of list) usedAssetIds.add(a.id)
  }
  void mapAssets
  return cards
}

/** 读取用户 ACTIVE 藏品并生成地图卡（服务端入口） */
export async function getCollectionMaps(db: PrismaClient, userId: string): Promise<CollectionMapCard[]> {
  const assets = await db.collectionAsset.findMany({
    where: { userId, dispositionState: "ACTIVE", archivedAt: null },
    include: { product: true },
    orderBy: { lastActivityAt: "desc" },
  })
  return buildCollectionMaps(assets)
}
