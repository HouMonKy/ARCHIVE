import { getPrismaClientAsync } from "@/lib/prisma"
import { isHostedRuntime } from "@/lib/db-mode"
import { logout, readSessionIdFromCookie } from "@/lib/auth/service"
import { clearSessionCookie } from "@/lib/auth/cookie"
import { assertSameOrigin, requireUser } from "@/lib/auth/guard"
import { toErrorResponse } from "@/lib/errors"

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser(await getPrismaClientAsync(), request)
    const db = await getPrismaClientAsync()
    const sessionId = readSessionIdFromCookie(request.headers.get("cookie"))
    if (sessionId) await logout(db, sessionId)
    const secure =
      request.headers.get("x-forwarded-proto") === "https" ||
      new URL(request.url).protocol === "https:" ||
      isHostedRuntime()
    return Response.json(
      { ok: true, user: user.displayName },
      { headers: { "Set-Cookie": clearSessionCookie(secure) } },
    )
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return Response.json(body, { status })
  }
}
