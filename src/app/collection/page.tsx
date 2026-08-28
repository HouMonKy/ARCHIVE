import Link from "next/link"
import { headers } from "next/headers"
import { getPrismaClientAsync } from "@/lib/prisma"
import { requirePageUser } from "@/lib/auth/guard"
import { listAssets } from "@/lib/services/assets"
import { CollectionFilters } from "@/components/collection-filters"
import { CollectionListView } from "@/components/collection-list-view"

export const dynamic = "force-dynamic"

interface CollectionPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

export default async function CollectionPage({ searchParams }: CollectionPageProps) {
  const sp = await searchParams
  const db = await getPrismaClientAsync()
  const h = await headers()
  const user = await requirePageUser(db, new Request("http://local/collection", { headers: h }))
  const sortRaw = first(sp.sort)
  const filters = {
    q: first(sp.q),
    status: first(sp.status),
    brand: first(sp.brand),
    grade: first(sp.grade),
    line: first(sp.line),
    product: first(sp.product),
    disposition: first(sp.disposition),
    sort:
      sortRaw === "price" || sortRaw === "name" || sortRaw === "recent"
        ? (sortRaw as "price" | "name" | "recent")
        : ("purchase" as const),
  }
  const assets = await listAssets(db, user.id, filters)
  const filterSummary: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(filters).filter(([, v]) => Boolean(v)),
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="wb-num text-xl font-bold tracking-tight">收藏柜</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-50)" }}>
            官网商品图优先展示，实拍照片保留在藏品详情中。
          </p>
        </div>
        <Link href="/add" className="mb-btn mb-btn-primary" data-testid="add-cta">
          入柜
        </Link>
      </div>
      <CollectionFilters />
      <CollectionListView assets={assets} filters={filterSummary} />
    </div>
  )
}
