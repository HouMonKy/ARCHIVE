import { headers } from "next/headers"
import { getPrismaClientAsync } from "@/lib/prisma"
import { demoNow, formatDateZh } from "@/lib/clock"
import { requirePageUser } from "@/lib/auth/guard"
import { getDashboardStats } from "@/lib/services/stats"
import { getLatestReportView, generateReport } from "@/lib/services/report"
import { getRouteProgress } from "@/lib/services/routes"
import { listAssets } from "@/lib/services/assets"
import { DashboardView } from "@/components/dashboard-view"

export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  const now = demoNow()
  const db = await getPrismaClientAsync()
  const h = await headers()
  const user = await requirePageUser(db, new Request("http://local/", { headers: h }))

  // 收藏建议自动刷新（Owner）：过期（收藏变化/跨日）或缺失时生成；Demo 租户走手动按钮（每日限额在 API 层）
  let reportView = await getLatestReportView(db, user.id, now)
  if (user.role === "OWNER" && !reportView.locked && reportView.canGenerate) {
    await generateReport(db, user.id, now).catch(() => undefined)
    reportView = await getLatestReportView(db, user.id, now)
  }

  const [stats, routes, activeAssets] = await Promise.all([
    getDashboardStats(db, user.id, now),
    getRouteProgress(db, user.id),
    listAssets(db, user.id, { disposition: "ACTIVE" }),
  ])
  return (
    <DashboardView
      userName={user.displayName}
      dateLabel={formatDateZh(now)}
      stats={stats}
      reportView={reportView}
      routes={routes}
      cabinetAssets={activeAssets}
      totalCount={activeAssets.length}
    />
  )
}
