import { getPrismaClientAsync } from "@/lib/prisma"
import { requireApiUser } from "@/lib/auth/guard"
import { updateAsset } from "@/lib/services/assets"
import { toErrorResponse } from "@/lib/errors"

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(await getPrismaClientAsync(), request)
    const db = await getPrismaClientAsync()
    const { id } = await ctx.params
    const body = await request.json()
    const asset = await updateAsset(db, user.id, id, body)
    return Response.json({ asset })
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return Response.json(body, { status })
  }
}
