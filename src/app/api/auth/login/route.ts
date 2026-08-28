import { z } from "zod"
import { getPrismaClientAsync } from "@/lib/prisma"
import { isHostedRuntime } from "@/lib/db-mode"
import { login } from "@/lib/auth/service"
import { toErrorResponse } from "@/lib/errors"
import { assertSameOrigin } from "@/lib/auth/guard"

const bodySchema = z.object({
  mode: z.enum(["owner", "demo"]),
  secret: z.string().min(1).max(200),
})

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: "请输入访问凭据", code: "BAD_REQUEST" }, { status: 400 })
    }
    const db = await getPrismaClientAsync()
    const secure =
      request.headers.get("x-forwarded-proto") === "https" ||
      new URL(request.url).protocol === "https:" ||
      isHostedRuntime()
    const result = await login(db, parsed.data, { hosted: isHostedRuntime(), secure })
    return Response.json(
      { ok: true, user: result.user },
      { headers: { "Set-Cookie": result.setCookie } },
    )
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return Response.json(body, { status })
  }
}
