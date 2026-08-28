import { getPrismaClientAsync } from "@/lib/prisma"
import { requireApiUser } from "@/lib/auth/guard"
import { addToWishlist } from "@/lib/services/feedback"
import { toErrorResponse } from "@/lib/errors"

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(await getPrismaClientAsync(), request)
    const db = await getPrismaClientAsync()
    const body = await request.json()
    const result = await addToWishlist(db, user.id, body)
    return Response.json(result, { status: 201 })
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return Response.json(body, { status })
  }
}
