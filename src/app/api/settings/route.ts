import { getPrismaClientAsync } from "@/lib/prisma"
import { requireApiUser } from "@/lib/auth/guard"
import { AppError, toErrorResponse } from "@/lib/errors"
import { getAiSettingsView, saveAiSettings, saveAiSettingsSchema } from "@/lib/services/ai-settings"

/**
 * /api/settings（仅 Owner）：
 * - GET：模型名 + configured 标志（write-only：永不返回/预填明文 Key）；
 * - POST：保存设置（同源 CSRF 校验；空白 Key = 保留旧 Key），立即生效。
 * Visitor → 403；未登录 → 401。
 */
export async function GET(request: Request) {
  try {
    const db = await getPrismaClientAsync()
    const user = await requireApiUser(db, request)
    if (user.role !== "OWNER") {
      throw new AppError("仅 Owner 可访问设置", { status: 403, code: "FORBIDDEN" })
    }
    return Response.json(await getAiSettingsView(db))
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return Response.json(body, { status })
  }
}

export async function POST(request: Request) {
  try {
    const db = await getPrismaClientAsync()
    const user = await requireApiUser(db, request)
    if (user.role !== "OWNER") {
      throw new AppError("仅 Owner 可访问设置", { status: 403, code: "FORBIDDEN" })
    }
    const raw = (await request.json()) as unknown
    const parsed = saveAiSettingsSchema.safeParse(raw)
    if (!parsed.success) {
      throw new AppError("参数不合法", { status: 422, code: "INVALID_INPUT" })
    }
    const view = await saveAiSettings(db, parsed.data)
    return Response.json(view)
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return Response.json(body, { status })
  }
}
