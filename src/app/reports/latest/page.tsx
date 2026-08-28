import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

/** 旧路由永久重定向：周报页已演进为「收藏建议」（返工轮任务 3） */
export default function ReportsLatestPage() {
  redirect("/advice")
}
