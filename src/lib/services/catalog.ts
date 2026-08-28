import type { PrismaClient } from "@prisma/client"
import { DATASET_VERSION } from "../demo-dataset"

/** 官方目录同步版本（scripts/catalog-sync.ts 写入；人工清单 + Bandai 官网实时同步） */
export const OFFICIAL_CATALOG_VERSION = "official-v1"

/** 目录可见版本：冻结演示数据 + 官方同步数据 */
export const CATALOG_VERSIONS = [DATASET_VERSION, OFFICIAL_CATALOG_VERSION]

/**
 * 目录版本可见性（返工轮任务 1）：Owner 只读官方目录（demo-v1 是演示种子，
 * 不得进入真实收藏的查询/匹配）；Demo 沙箱与 E2E（固定演示时钟）仍可读全部版本。
 */
export function catalogVersionsForRole(role: "OWNER" | "DEMO"): string[] {
  if (process.env.E2E_MODE === "1") return CATALOG_VERSIONS
  return role === "OWNER" ? [OFFICIAL_CATALOG_VERSION] : CATALOG_VERSIONS
}

export interface CatalogItem {
  id: string
  canonicalName: string
  /** 中文标准名（优先展示；null 回退 canonicalName） */
  nameZh: string | null
  brand: string
  category: string
  grade: string
  line: string | null
  releaseYear: number | null
  ownedCount: number
  imageSourcePage: string | null
  imageSourceUrl: string | null
  rightsBasis: string | null
}

export async function listCatalogWithOwnedCounts(
  db: PrismaClient,
  userId: string,
  role: "OWNER" | "DEMO" = "OWNER",
): Promise<CatalogItem[]> {
  const products = await db.catalogProduct.findMany({
    where: { catalogVersion: { in: catalogVersionsForRole(role) } },
    orderBy: { id: "asc" },
  })
  const owned = await db.collectionAsset.groupBy({
    by: ["catalogProductId"],
    where: {
      userId,
      dispositionState: "ACTIVE",
      archivedAt: null,
      catalogProductId: { not: null },
    },
    _count: { _all: true },
  })
  const ownedMap = new Map(owned.map((o) => [o.catalogProductId as string, o._count._all]))
  return products.map((p) => ({
    id: p.id,
    canonicalName: p.canonicalName,
    nameZh: p.nameZh,
    brand: p.brand,
    category: p.category,
    grade: p.grade,
    line: p.line,
    releaseYear: p.releaseYear,
    ownedCount: ownedMap.get(p.id) ?? 0,
    imageSourcePage: p.imageSourcePage,
    imageSourceUrl: p.imageSourceUrl,
    rightsBasis: p.rightsBasis,
  }))
}

export async function getCatalogProduct(db: PrismaClient, productId: string) {
  return db.catalogProduct.findUnique({ where: { id: productId } })
}
