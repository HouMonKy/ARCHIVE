import { PrismaClient } from "@prisma/client"
import {
  DATASET_VERSION,
  DEMO_ASSETS,
  DEMO_CATALOG_PRODUCTS,
  DEMO_EVENT_SOURCE_NAME,
  DEMO_INTENTS,
  DEMO_PREFERENCES,
  DEMO_RELEASE_EVENTS,
  DEMO_USER,
  DEMO_EPOCH_ISO,
} from "../demo-dataset"
import { readImageManifest } from "../image-manifest"
import type { ImageManifestEntry, ImageManifest } from "../image-manifest"
import { ROUTE_DATA_VERSION, ROUTE_DEFS, edgesForRoute } from "../routes/route-data"
import { DEMO_TENANT_USER_ID } from "../auth/service"

export { readImageManifest }
export type { ImageManifestEntry, ImageManifest }

export interface SeedOptions {
  /** all = PRD 第 19 节固定 8 件；minimal = 前 2 件（用于周报解锁阈值演练）；none = 空收藏 */
  assets?: "all" | "minimal" | "none"
  events?: boolean
  intents?: boolean
}

function toIsoDate(iso: string): Date {
  return new Date(iso)
}

/** 重建演示数据（幂等：先清空再写入，任何状态下重复调用结果一致） */
export async function seedDemoData(db: PrismaClient, options: SeedOptions = {}): Promise<void> {
  const { assets = "all", events = true, intents = true } = options
  const manifest = readImageManifest()
  const now = new Date(DEMO_EPOCH_ISO)

  // 清空（外键安全顺序；Session 保留——E2E 状态重置不得撤销已登录会话）
  await db.assetCover.deleteMany()
  await db.insightFeedback.deleteMany()
  await db.insight.deleteMany()
  await db.insightReport.deleteMany()
  await db.collectionAsset.deleteMany()
  await db.userProductIntent.deleteMany()
  await db.releaseEvent.deleteMany()
  await db.recognitionJob.deleteMany()
  await db.agentRun.deleteMany()
  await db.aiUsageLog.deleteMany()
  await db.userPreference.deleteMany()
  await db.catalogProduct.deleteMany()
  await db.user.deleteMany()
  // AI Provider 设置（/settings）：演示/测试重置清空（密钥与演示数据无关）
  await db.aiProviderConfig.deleteMany()

  await db.user.create({
    data: {
      id: DEMO_USER.id,
      displayName: DEMO_USER.displayName,
      role: "OWNER",
      locale: DEMO_USER.locale,
      timezone: DEMO_USER.timezone,
    },
  })

  // 面试沙箱租户（DEMO）：独立数据、每日限额，见 src/lib/auth
  await db.user.create({
    data: { id: DEMO_TENANT_USER_ID, displayName: "面试访客", role: "DEMO" },
  })

  // 版本化路线（幂等 upsert，独立于目录与实体生命周期）
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
        update: { label: node.label, nodeKind: node.nodeKind, productKey: node.productKey ?? null, note: node.note ?? null },
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

  await db.userPreference.createMany({
    data: DEMO_PREFERENCES.map((p) => ({
      userId: DEMO_USER.id,
      kind: p.kind,
      value: p.value,
      source: "USER",
      updatedAt: now,
    })),
  })

  await db.catalogProduct.createMany({
    data: DEMO_CATALOG_PRODUCTS.map((p) => {
      const image = manifest.products.find((m) => m.code === p.id)
      if (!image) throw new Error(`图片清单缺少商品 ${p.id} 的来源记录`)
      return {
        id: p.id,
        brand: p.brand,
        category: p.category,
        line: p.line,
        grade: p.grade,
        canonicalName: p.canonicalName,
        releaseYear: p.releaseYear,
        source: "Bandai 官网",
        catalogVersion: DATASET_VERSION,
        imageSourcePage: image.source_page,
        imageSourceUrl: image.image_url,
        imageFetchedAt: new Date(`${manifest.fetched_at}T00:00:00+08:00`),
        rightsBasis: manifest.rights_basis,
      }
    }),
  })

  const seedAssets =
    assets === "all" ? DEMO_ASSETS : assets === "minimal" ? DEMO_ASSETS.slice(0, 2) : []

  for (const a of seedAssets) {
    const lastActivity = toIsoDate(a.lastActivityIso)
    await db.collectionAsset.create({
      data: {
        id: a.id,
        userId: DEMO_USER.id,
        catalogProductId: a.catalogProductId,
        customName: a.customName,
        customBrand: a.customBrand,
        dispositionState: a.dispositionState,
        buildState: a.buildState,
        progress: a.progress,
        purchasePriceMinor: a.purchasePriceMinor,
        currency: a.purchasePriceMinor == null ? null : "CNY",
        completedAt: a.buildState === "COMPLETED" ? lastActivity : null,
        note: null,
        confirmedAt: lastActivity,
        lastActivityAt: lastActivity,
      },
    })
  }

  if (intents && seedAssets.length > 0) {
    for (const i of DEMO_INTENTS) {
      await db.userProductIntent.create({
        data: { userId: DEMO_USER.id, catalogProductId: i.catalogProductId, state: i.state },
      })
    }
  }

  if (events) {
    await db.releaseEvent.createMany({
      data: DEMO_RELEASE_EVENTS.map((e) => ({
        id: e.id,
        catalogProductId: e.catalogProductId,
        title: e.title,
        announcedAt: toIsoDate(e.announcedIso),
        sourceUrl: `/demo/sources/${e.id}`,
        sourceName: DEMO_EVENT_SOURCE_NAME,
        priceMinor: e.priceMinor,
        datasetVersion: DATASET_VERSION,
      })),
    })
  }
}
