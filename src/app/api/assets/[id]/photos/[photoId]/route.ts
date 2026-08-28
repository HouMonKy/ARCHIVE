import { getPrismaClientAsync } from "@/lib/prisma"
import { requireApiUser } from "@/lib/auth/guard"
import { toErrorResponse } from "@/lib/errors"
import { readAssetPhotoFile, deleteAssetPhoto } from "@/lib/services/asset-photos"

/**
 * /api/assets/[id]/photos/[photoId]（资产所属用户专用）：
 * - GET：照片字节（仅本人）；DELETE：删除用户照片（识别图不在照片区，不可误删）。
 * 每个请求都校验 session 用户与 asset.userId + 照片归属（跨用户 404）。
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string; photoId: string }> }) {
  try {
    const { id, photoId } = await ctx.params
    const db = await getPrismaClientAsync()
    const user = await requireApiUser(db, request)
    const file = await readAssetPhotoFile(db, user.id, id, photoId)
    if (!file) return new Response("Not Found", { status: 404 })
    return new Response(new Uint8Array(file.bytes), {
      headers: { "Content-Type": file.mimeType, "Cache-Control": "private, max-age=3600", "X-Photo-Provenance": "local-asset-photo" },
    })
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return Response.json(body, { status })
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string; photoId: string }> }) {
  try {
    const { id, photoId } = await ctx.params
    const db = await getPrismaClientAsync()
    const user = await requireApiUser(db, request)
    await deleteAssetPhoto(db, user.id, id, photoId)
    return Response.json({ ok: true })
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return Response.json(body, { status })
  }
}
