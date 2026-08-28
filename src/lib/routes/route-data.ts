/**
 * 版本化收藏路线（任务 3）：节点/边的唯一事实来源，seed 幂等写入 RouteNode/RouteEdge。
 * - productKey 与 CatalogProduct.id 解耦：目录缺商品时路线仍可展示（缺口可见）；
 * - version 变更即新版本路线，旧版本保留（可追溯），计算始终取最新 version。
 */

export const ROUTE_DATA_VERSION = "route-v1"

export interface RouteNodeDef {
  key: string // 稳定节点 id
  order: number
  label: string
  nodeKind: "MILESTONE" | "PRODUCT"
  productKey?: string
  note?: string
}

export interface RouteDef {
  routeId: string
  title: string
  description: string
  brand: "Bandai" | "LEGO"
  nodes: RouteNodeDef[]
}

/** UC（宇宙世纪）主线：从入门 HG 到 PG 旗舰的代表机型序列 */
const UC_ROUTE: RouteDef = {
  routeId: "UC",
  title: "UC 宇宙世纪主线",
  description: "从 Zeta 时代入门机到 PG 旗舰的宇宙世纪代表作序列。",
  brand: "Bandai",
  nodes: [
    { key: "uc-v1-n1", order: 1, label: "HGUC Gundam Mk-II Revive", nodeKind: "PRODUCT", productKey: "P09", note: "入门：HG 熟悉 UC 造型语言" },
    { key: "uc-v1-n2", order: 2, label: "MG Hyaku-Shiki Ver.2.0", nodeKind: "PRODUCT", productKey: "P10", note: "MG 首选：百式镀金外装" },
    { key: "uc-v1-n3", order: 3, label: "MG RX-78-2 Gundam Ver.3.0", nodeKind: "PRODUCT", productKey: "P01", note: "元祖 MS 的现代 MG 答卷" },
    { key: "uc-v1-n4", order: 4, label: "RG ν Gundam", nodeKind: "PRODUCT", productKey: "P04", note: "RG 精密骨架体验" },
    { key: "uc-v1-n5", order: 5, label: "RG Sazabi", nodeKind: "PRODUCT", productKey: "P08", note: "与 ν 对置的大型 RG" },
    { key: "uc-v1-n6", order: 6, label: "MG Zeta Gundam Ver.Ka", nodeKind: "PRODUCT", productKey: "P02", note: "可变机验证 MG 装配功力" },
    { key: "uc-v1-n7", order: 7, label: "MGEX Unicorn Gundam Ver.Ka", nodeKind: "PRODUCT", productKey: "P03", note: "MGEX 心理框架表现" },
    { key: "uc-v1-n8", order: 8, label: "PG Unleashed RX-78-2", nodeKind: "PRODUCT", productKey: "P05", note: "终点：PG UNLEASHED 灯光旗舰" },
  ],
}

/** LEGO Technic 超跑路线：从入门套件到 1:8 旗舰（产品键为官方目录当前在售条目） */
const TECHNIC_SUPERCAR_ROUTE: RouteDef = {
  routeId: "TECHNIC-SUPERCAR",
  title: "LEGO Technic 超跑路线",
  description: "机械组超跑从中型套件到 1:8 旗舰序列（产品键对应官方目录同步条目）。",
  brand: "LEGO",
  nodes: [
    { key: "tec-v1-n1", order: 1, label: "Lamborghini Huracán Técnica（42161）", nodeKind: "PRODUCT", productKey: "lego-42161", note: "入门：V10 引擎与转向结构" },
    { key: "tec-v1-n2", order: 2, label: "Bugatti Bolide（42151）", nodeKind: "PRODUCT", productKey: "lego-42151", note: "W16 引擎细节进阶" },
    { key: "tec-v1-n3", order: 3, label: "Koenigsegg Jesko Absolut（42173）", nodeKind: "PRODUCT", productKey: "lego-42173", note: "精密变速箱挑战" },
    { key: "tec-v1-n4", order: 4, label: "Ferrari Daytona SP3（42143）", nodeKind: "PRODUCT", productKey: "lego-42143", note: "1:8 旗舰：法拉利序列开端" },
    { key: "tec-v1-n5", order: 5, label: "Lamborghini Revuelto（42214）", nodeKind: "PRODUCT", productKey: "lego-42214", note: "1:8 旗舰：混动 V12" },
    { key: "tec-v1-n6", order: 6, label: "McLaren P1（42172）", nodeKind: "PRODUCT", productKey: "lego-42172", note: "终点：二面悬挂与蝶门机构" },
  ],
}

export const ROUTE_DEFS: RouteDef[] = [UC_ROUTE, TECHNIC_SUPERCAR_ROUTE]

/** 路线边：默认线性链（n1→n2→…），按节点顺序生成 */
export function edgesForRoute(route: RouteDef): { fromNodeId: string; toNodeId: string }[] {
  const edges: { fromNodeId: string; toNodeId: string }[] = []
  for (let i = 1; i < route.nodes.length; i++) {
    edges.push({ fromNodeId: route.nodes[i - 1]!.key, toNodeId: route.nodes[i]!.key })
  }
  return edges
}
