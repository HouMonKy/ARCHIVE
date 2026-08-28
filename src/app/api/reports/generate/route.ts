import { getPrismaClientAsync } from "@/lib/prisma"
import { requireApiUser } from "@/lib/auth/guard"
import { demoNow } from "@/lib/clock"
import { generateReport } from "@/lib/services/report"
import { toErrorResponse } from "@/lib/errors"

/** 兼容别名：与 /api/advice/generate 同一处理（收藏建议刷新；Demo 租户每日 1 次限额） */
export async function POST(request: Request) {
  try {
    const user = await requireApiUser(await getPrismaClientAsync(), request, {
      demoQuota: "REPORT",
      now: demoNow(),
    })
    const db = await getPrismaClientAsync()
    const result = await generateReport(db, user.id, demoNow())
    return Response.json(result)
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return Response.json(body, { status })
  }
}
