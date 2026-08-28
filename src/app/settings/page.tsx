import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getPrismaClientAsync } from "@/lib/prisma"
import { requirePageUser } from "@/lib/auth/guard"
import { getAiSettingsView } from "@/lib/services/ai-settings"
import { SettingsForm } from "./settings-form"

export const dynamic = "force-dynamic"
export const metadata = { title: "设置 · ARCHIVE" }

export default async function SettingsPage() {
  const db = await getPrismaClientAsync()
  const h = await headers()
  const user = await requirePageUser(db, new Request("http://local/settings", { headers: h }))
  // 仅 Owner 可见与访问；Visitor 跳回首页
  if (user.role !== "OWNER") redirect("/")
  const view = await getAiSettingsView(db)
  return (
    <div className="space-y-4" data-testid="settings-page">
      <div>
        <h1 className="wb-num text-xl font-bold tracking-tight">设置</h1>
        <p className="mt-1 text-sm text-[color:var(--ink-50)]">
          「拍照识别」与「收藏建议」两部分，各自可配置任意 OpenAI 兼容的模型（不绑定厂商）：填模型名、API 地址与 Key 即可；保存后立即生效（环境变量作为后备）。
        </p>
      </div>
      <SettingsForm initial={view} />
    </div>
  )
}
