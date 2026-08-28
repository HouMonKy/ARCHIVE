import type { PrismaClient } from "@prisma/client"
import { legoDisplayName } from "../names/lego-naming"

/**
 * 新品动态（收藏工作台改造）：
 * - 真实 ReleaseEvent 覆盖近 90 天官网更新 + 未来 180 天明确发售信息，最多 limit 条；
 * - 展示官网图、品牌、正式名称、公布/发售日期、官方来源与「已入柜」标记；
 * - 不做匹配打分/推荐排序——事实排序只有官方发布时间倒序；
 * - 全部/Bandai/LEGO 筛选；官网暂不可达时沿用上次已验证数据（本服务只读库内事件）。
 */

export interface NewReleaseItem {
  eventId: string
  productId: string
  brand: string
  officialName: string
  nameZh: string | null
  announcedAt: Date
  sourceUrl: string | null
  sourceName: string | null
  /** 官网图路由（imageStatus=OK 才有；否则前端回退占位） */
  hasImage: boolean
  /** 当前用户已入柜该商品的数量（>0 显示已入柜标记） */
  ownedCount: number
}

export async function listRecentReleases(
  db: PrismaClient,
  userId: string,
  options: { brand?: "Bandai" | "LEGO"; windowDays?: number; futureDays?: number; limit?: number; now?: Date } = {},
): Promise<NewReleaseItem[]> {
  const now = options.now ?? new Date()
  const windowDays = options.windowDays ?? 90
  const futureDays = options.futureDays ?? 180
  const limit = options.limit ?? 20
  const since = new Date(now.getTime() - windowDays * 24 * 3600_000)
  const until = new Date(now.getTime() + futureDays * 24 * 3600_000)

  const events = await db.releaseEvent.findMany({
    where: {
      announcedAt: { gte: since, lte: until },
      ...(options.brand ? { product: { brand: options.brand } } : {}),
    },
    include: { product: true },
    orderBy: { announcedAt: "desc" },
    take: limit * 4, // 扩展到未来窗口后，在官方 ID/品番去重前多取
  })

  // 已公布信息按最新日期排在前；未来发售条目随后按离现在最近排序。
  events.sort((a, b) => {
    const aFuture = a.announcedAt.getTime() > now.getTime()
    const bFuture = b.announcedAt.getTime() > now.getTime()
    if (aFuture !== bFuture) return aFuture ? 1 : -1
    return aFuture
      ? a.announcedAt.getTime() - b.announcedAt.getTime()
      : b.announcedAt.getTime() - a.announcedAt.getTime()
  })

  // 按官方商品去重（同商品多事件保留最新一条）+ 已入柜计数
  const ownedCounts = await db.collectionAsset.groupBy({
    by: ["catalogProductId"],
    where: { userId, dispositionState: "ACTIVE", archivedAt: null, catalogProductId: { not: null } },
    _count: { _all: true },
  })
  const ownedMap = new Map(ownedCounts.map((o) => [o.catalogProductId as string, o._count._all]))

  const seenProducts = new Set<string>()
  const items: NewReleaseItem[] = []
  for (const e of events) {
    if (seenProducts.has(e.catalogProductId)) continue
    seenProducts.add(e.catalogProductId)
    items.push({
      eventId: e.id,
      productId: e.catalogProductId,
      brand: e.product.brand,
      officialName: legoDisplayName(e.product.brand, e.product.canonicalName, e.product.nameZh, e.product.modelNumber),
      // LEGO 名称策略：展示恒用 canonicalName（nameZh 置 null）；Bandai 保留 nameZh
      nameZh: e.product.brand === "LEGO" ? null : e.product.nameZh,
      announcedAt: e.announcedAt,
      sourceUrl: e.sourceUrl,
      sourceName: e.sourceName,
      hasImage: e.product.imageStatus === "OK",
      ownedCount: ownedMap.get(e.catalogProductId) ?? 0,
    })
    if (items.length >= limit) break
  }
  return items
}
