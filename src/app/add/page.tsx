import { headers } from "next/headers"
import { getPrismaClientAsync } from "@/lib/prisma"
import { requirePageUser } from "@/lib/auth/guard"
import { listCatalogWithOwnedCounts } from "@/lib/services/catalog"
import { resolveRecognitionMode } from "@/lib/ai/provider"
import { getLatestDraft } from "@/lib/services/recognition"
import { AddFlow } from "@/components/add-flow"

export const dynamic = "force-dynamic"

interface AddPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function AddPage({ searchParams }: AddPageProps) {
  const sp = await searchParams
  const db = await getPrismaClientAsync()
  const h = await headers()
  const user = await requirePageUser(db, new Request("http://local/add", { headers: h }))
  const mode = Array.isArray(sp.mode) ? sp.mode[0] : sp.mode
  const catalog = await listCatalogWithOwnedCounts(db, user.id, user.role)
  // 识别草稿：刷新后可选继续最近一次成功未确认识别（24 小时内；不自动替换上传首屏）
  const draft = user.role === "OWNER" ? await getLatestDraft(db, user.id) : null
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">藏品入柜</h1>
        <p className="mt-1 text-sm text-[color:var(--ink-50)]">
          拍照或选择照片识别，核对官网信息后确认入柜；识别结果未经确认不会写入收藏库。
        </p>
      </div>
      <AddFlow
        catalog={catalog}
        initialMode={mode === "manual" ? "manual" : undefined}
        recognitionMode={await resolveRecognitionMode(db)}
        fixtureUi={process.env.E2E_MODE === "1"}
        initialDraft={draft}
      />
    </div>
  )
}
