import { getPrismaClientAsync } from "@/lib/prisma"
import { requireApiUser } from "@/lib/auth/guard"
import { recordFeedback } from "@/lib/services/feedback"
import { toErrorResponse } from "@/lib/errors"

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(await getPrismaClientAsync(), request)
    const db = await getPrismaClientAsync()
    const { id } = await ctx.params
    const body = await request.json()
    const result = await recordFeedback(db, user.id, id, body)
    return Response.json(result)
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return Response.json(body, { status })
  }
}
