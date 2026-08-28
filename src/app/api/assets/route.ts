import { getPrismaClientAsync } from "@/lib/prisma"
import { requireApiUser } from "@/lib/auth/guard"
import { confirmAsset } from "@/lib/services/assets"
import { toErrorResponse } from "@/lib/errors"

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(await getPrismaClientAsync(), request)
    const db = await getPrismaClientAsync()
    const body = await request.json()
    const result = await confirmAsset(db, user.id, body)
    return Response.json(result, { status: result.created ? 201 : 200 })
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return Response.json(body, { status })
  }
}
