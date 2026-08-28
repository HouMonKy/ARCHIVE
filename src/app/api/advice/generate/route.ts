import { getPrismaClientAsync } from "@/lib/prisma"
import { requireApiUser } from "@/lib/auth/guard"
import { demoNow } from "@/lib/clock"
import { generateReport } from "@/lib/services/report"
import { toErrorResponse } from "@/lib/errors"

/** 手动刷新收藏建议（数据未变化时幂等；Demo 租户每日 1 次限额） */
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
