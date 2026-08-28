import { z } from "zod"
import { getPrismaClientAsync } from "@/lib/prisma"
import { requireApiUser } from "@/lib/auth/guard"
import { AppError, toErrorResponse } from "@/lib/errors"
import { testProviderConnection } from "@/lib/services/ai-settings"

/**
 * /api/settings/test（仅 Owner，同源校验）：连接测试。
 * 只返回 成功 / 模型 / 耗时 / 安全错误摘要——不含密钥、请求体或内部 URL 参数。
 * E2E_MODE=1 的测试服务器不执行真实网络连接（确定性；真实连接由验收脚本验证）。
 */
const bodySchema = z.object({
  provider: z.enum(["recognition", "advice"]),
  /** 表单当前值（未保存也可测试；空白字段回退已保存配置） */
  model: z.string().trim().max(120).optional(),
  baseUrl: z.string().trim().max(300).optional(),
  apiKey: z.string().max(4096).optional(),
})

export async function POST(request: Request) {
  try {
    const db = await getPrismaClientAsync()
    const user = await requireApiUser(db, request)
    if (user.role !== "OWNER") {
      throw new AppError("仅 Owner 可访问设置", { status: 403, code: "FORBIDDEN" })
    }
    let body: z.infer<typeof bodySchema>
    try {
      body = bodySchema.parse(await request.json())
    } catch {
      throw new AppError("参数不合法", { status: 422, code: "INVALID_INPUT" })
    }
    if (process.env.E2E_MODE === "1") {
      return Response.json({ ok: false, provider: body.provider, model: body.model ?? "", latencyMs: 0, error: "E2E 模式不执行真实连接测试" })
    }
    return Response.json(
      await testProviderConnection(db, body.provider, {
        model: body.model,
        baseUrl: body.baseUrl,
        apiKey: body.apiKey,
      }),
    )
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return Response.json(body, { status })
  }
}
