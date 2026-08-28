import { getPrismaClientAsync } from "@/lib/prisma"
import { requireApiUser } from "@/lib/auth/guard"
import { toErrorResponse } from "@/lib/errors"
import { addAssetPhoto, listAssetPhotos } from "@/lib/services/asset-photos"

/**
 * /api/assets/[id]/photos（资产所属用户专用）：
 * - GET：照片列表（createdAt 倒序）；POST：追加用户照片（multipart file ≤10MB，≤20 张）。
 * 每个请求都校验 session 用户与 asset.userId（跨用户 404）。
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const db = await getPrismaClientAsync()
    const user = await requireApiUser(db, request)
    return Response.json({ photos: await listAssetPhotos(db, user.id, id) })
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return Response.json(body, { status })
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const db = await getPrismaClientAsync()
    const user = await requireApiUser(db, request)
    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof File)) {
      return Response.json({ error: "缺少上传文件（字段名 file）", code: "NO_FILE" }, { status: 400 })
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const photo = await addAssetPhoto(db, user.id, id, { name: file.name, mimeType: file.type || "image/jpeg", bytes })
    return Response.json({ photo }, { status: 201 })
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return Response.json(body, { status })
  }
}
