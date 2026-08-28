import type { PrismaClient } from "@prisma/client"
import { ROUTE_DATA_VERSION, ROUTE_DEFS, edgesForRoute } from "../routes/route-data"
import { DEMO_USER } from "../demo-dataset"
import { DEMO_TENANT_USER_ID } from "../auth/service"

/**
 * 基础行确保（非破坏）：Owner/Demo 身份与版本化路线。
 * - 只创建缺失的行，绝不更新/删除既有行（与 seedDemoData 的先清空后写入相反）；
 * - 幂等：任何状态重复调用结果一致。
 */

export interface EnsureBaseRowsResult {
  createdOwner: boolean
  createdDemoTenant: boolean
  routeNodes: number
  routeEdges: number
}

export async function ensureBaseRows(db: PrismaClient): Promise<EnsureBaseRowsResult> {
  let createdOwner = false
  let createdDemoTenant = false

  if (!(await db.user.findUnique({ where: { id: DEMO_USER.id } }))) {
    await db.user.create({
      data: {
        id: DEMO_USER.id,
        displayName: DEMO_USER.displayName,
        role: "OWNER",
        locale: DEMO_USER.locale,
        timezone: DEMO_USER.timezone,
      },
    })
    createdOwner = true
  }

  if (!(await db.user.findUnique({ where: { id: DEMO_TENANT_USER_ID } }))) {
    await db.user.create({
      data: { id: DEMO_TENANT_USER_ID, displayName: "面试访客", role: "DEMO" },
    })
    createdDemoTenant = true
  }

  // 版本化路线（幂等 upsert；只补缺失定义，不重置历史）
  for (const route of ROUTE_DEFS) {
    for (const node of route.nodes) {
      await db.routeNode.upsert({
        where: { routeId_version_order: { routeId: route.routeId, version: ROUTE_DATA_VERSION, order: node.order } },
        create: {
          id: node.key,
          routeId: route.routeId,
          version: ROUTE_DATA_VERSION,
          order: node.order,
          label: node.label,
          nodeKind: node.nodeKind,
          productKey: node.productKey ?? null,
          note: node.note ?? null,
        },
        update: {},
      })
    }
    for (const edge of edgesForRoute(route)) {
      await db.routeEdge.upsert({
        where: {
          routeId_version_fromNodeId_toNodeId: {
            routeId: route.routeId,
            version: ROUTE_DATA_VERSION,
            fromNodeId: edge.fromNodeId,
            toNodeId: edge.toNodeId,
          },
        },
        create: {
          routeId: route.routeId,
          version: ROUTE_DATA_VERSION,
          fromNodeId: edge.fromNodeId,
          toNodeId: edge.toNodeId,
        },
        update: {},
      })
    }
  }

  const [routeNodes, routeEdges] = await Promise.all([
    db.routeNode.count({ where: { version: ROUTE_DATA_VERSION } }),
    db.routeEdge.count({ where: { version: ROUTE_DATA_VERSION } }),
  ])
  return { createdOwner, createdDemoTenant, routeNodes, routeEdges }
}
