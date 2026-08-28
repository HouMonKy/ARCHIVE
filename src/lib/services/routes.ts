import type { PrismaClient } from "@prisma/client"
import { ROUTE_DATA_VERSION } from "../routes/route-data"

/**
 * 收藏路线（任务 3）：版本化节点/边的确定性完整度与缺口计算。
 * - 完整度 = 已拥有节点（productKey 在用户当前收藏 ACTIVE 实体中）/ 全部 PRODUCT 节点；
 * - 缺口 = 按顺序排列的未拥有 PRODUCT 节点；
 * - 纯函数 computeRouteProgress 可测；读取层 getRouteProgress 汇总当前最新版本。
 */

export interface RouteNodeView {
  id: string
  order: number
  label: string
  nodeKind: string
  productKey: string | null
  note: string | null
  owned: boolean
  productId: string | null
}

export interface RouteProgress {
  routeId: string
  title: string
  version: string
  nodes: RouteNodeView[]
  totalProductNodes: number
  ownedProductNodes: number
  completionPercent: number
  completionDisplay: string
  gaps: { label: string; productKey: string | null; note: string | null }[]
  nextGap: { label: string; productKey: string | null; note: string | null } | null
}

const ROUTE_META: Record<string, { title: string }> = {
  UC: { title: "UC 宇宙世纪主线" },
  "TECHNIC-SUPERCAR": { title: "LEGO Technic 超跑路线" },
}

export function computeRouteProgress(
  routeId: string,
  version: string,
  nodes: { id: string; order: number; label: string; nodeKind: string; productKey: string | null; note: string | null }[],
  ownedProductKeys: ReadonlySet<string>,
  productKeyToId: ReadonlyMap<string, string>,
): RouteProgress {
  const sorted = [...nodes].sort((a, b) => a.order - b.order)
  const views: RouteNodeView[] = sorted.map((n) => ({
    id: n.id,
    order: n.order,
    label: n.label,
    nodeKind: n.nodeKind,
    productKey: n.productKey,
    note: n.note,
    owned: n.productKey != null && ownedProductKeys.has(n.productKey),
    productId: n.productKey != null ? (productKeyToId.get(n.productKey) ?? null) : null,
  }))
  const productNodes = views.filter((n) => n.nodeKind === "PRODUCT" && n.productKey != null)
  const owned = productNodes.filter((n) => n.owned)
  const gaps = productNodes
    .filter((n) => !n.owned)
    .map((n) => ({ label: n.label, productKey: n.productKey, note: n.note }))
  const percent = productNodes.length === 0 ? 0 : Math.round((owned.length / productNodes.length) * 100)
  return {
    routeId,
    title: ROUTE_META[routeId]?.title ?? routeId,
    version,
    nodes: views,
    totalProductNodes: productNodes.length,
    ownedProductNodes: owned.length,
    completionPercent: percent,
    completionDisplay: productNodes.length === 0 ? "—" : `${percent}%（${owned.length}/${productNodes.length}）`,
    gaps,
    nextGap: gaps[0] ?? null,
  }
}

export async function getRouteProgress(db: PrismaClient, userId: string): Promise<RouteProgress[]> {
  const [nodes, activeAssets] = await Promise.all([
    db.routeNode.findMany({ where: { version: ROUTE_DATA_VERSION } }),
    db.collectionAsset.findMany({
      where: { userId, dispositionState: "ACTIVE", archivedAt: null, catalogProductId: { not: null } },
      select: { catalogProductId: true },
    }),
  ])
  const ownedProductKeys = new Set(activeAssets.map((a) => a.catalogProductId as string))
  const productIds = [...new Set(nodes.map((n) => n.productKey).filter((k): k is string => k != null))]
  const products = await db.catalogProduct.findMany({ where: { id: { in: productIds } }, select: { id: true } })
  const productKeyToId = new Map(products.map((p) => [p.id, p.id]))
  const routeIds = [...new Set(nodes.map((n) => n.routeId))]
  return routeIds
    .map((routeId) =>
      computeRouteProgress(
        routeId,
        ROUTE_DATA_VERSION,
        nodes.filter((n) => n.routeId === routeId),
        ownedProductKeys,
        productKeyToId,
      ),
    )
    .sort((a, b) => a.routeId.localeCompare(b.routeId))
}
