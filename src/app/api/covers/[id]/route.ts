import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { getPrismaClientAsync } from "@/lib/prisma"
import { requireApiUser } from "@/lib/auth/guard"
import { readCoverFile } from "@/lib/services/covers"
import { toErrorResponse } from "@/lib/errors"

export const dynamic = "force-dynamic"

const FALLBACK = path.resolve(process.cwd(), "public/demo/fallback.svg")

/**
 * 实体封面伺服（返工轮任务 2）：
 * - 只读当前租户自己的封面（userId 强校验，他人封面一律 404）；
 * - LOCAL：流式返回 private-assets/user-covers/ 中的处理图（EXIF 修正 + 压缩后）；
 * - HOSTED：用户封面不落盘，返回占位图（托管 Demo 边界）。
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(await getPrismaClientAsync(), request)
    const { id } = await ctx.params
    if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) {
      return new Response("Not Found", { status: 404 })
    }
    const db = await getPrismaClientAsync()
    const cover = await readCoverFile(db, user.id, id)
    if (!cover) {
      return new Response("Not Found", { status: 404 })
    }
    if (cover.provenance === "hosted-placeholder") {
      const placeholder = existsSync(FALLBACK) ? readFileSync(FALLBACK) : Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")
      return new Response(new Uint8Array(placeholder), {
        headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, max-age=300", "X-Cover-Provenance": "hosted-placeholder" },
      })
    }
    return new Response(new Uint8Array(cover.bytes), {
      headers: {
        "Content-Type": cover.mimeType,
        "Cache-Control": "private, max-age=3600",
        "X-Cover-Provenance": "local-user-cover",
      },
    })
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return Response.json(body, { status })
  }
}
