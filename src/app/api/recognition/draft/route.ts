import { getPrismaClientAsync } from "@/lib/prisma"
import { requireApiUser } from "@/lib/auth/guard"
import { getLatestDraft } from "@/lib/services/recognition"
import { toErrorResponse } from "@/lib/errors"

/** 识别草稿：最近一次成功未确认的识别结果（24 小时内），刷新后可继续确认 */
export async function GET(request: Request) {
  try {
    const user = await requireApiUser(await getPrismaClientAsync(), request)
    const db = await getPrismaClientAsync()
    const draft = await getLatestDraft(db, user.id)
    return Response.json({ draft })
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return Response.json(body, { status })
  }
}
