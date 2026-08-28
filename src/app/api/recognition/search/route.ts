import { z } from "zod"
import { getPrismaClientAsync } from "@/lib/prisma"
import { requireApiUser } from "@/lib/auth/guard"
import { AppError, toErrorResponse } from "@/lib/errors"
import { demoNow } from "@/lib/clock"
import { extractionEditSchema } from "@/lib/validation"
import { getMonthlyBudgetStatus } from "@/lib/ai/usage"

/**
 * 重新搜索官网（识别主链路重构）：用户在「AI 识别结果」中修改字段（如商品名称）后，
 * 以编辑值重新执行 Kimi $web_search 官网搜索 + 候选逐条验证。
 * - 同一识别任务（jobId 归属校验）下替换候选（草稿恢复同步更新）；
 * - E2E/演示模式不联网；预算熔断同识别主链路；
 * - 失败/无结果返回空候选——绝不从本地目录找"最像的"顶替。
 */
const bodySchema = z.object({
  jobId: z.string().min(1).max(64),
  extraction: extractionEditSchema,
})

export async function POST(request: Request) {
  try {
    const db = await getPrismaClientAsync()
    const user = await requireApiUser(db, request, { demoQuota: "RECOGNITION", now: demoNow() })
    let parsed: z.infer<typeof bodySchema>
    try {
      parsed = bodySchema.parse(await request.json())
    } catch {
      throw new AppError("参数不合法", { status: 422, code: "INVALID_INPUT" })
    }

    const job = await db.recognitionJob.findUnique({ where: { id: parsed.jobId } })
    if (!job || job.userId !== user.id) {
      throw new AppError("识别任务不存在或已失效，请重新上传", { status: 404, code: "JOB_NOT_FOUND" })
    }

    // E2E/演示：不联网
    if (process.env.E2E_MODE === "1" || user.role === "DEMO") {
      return Response.json({
        candidates: [],
        searchQueries: [],
        searchState: "SKIPPED",
        searchMessage: "演示/测试模式不执行联网搜索",
      })
    }

    const budget = await getMonthlyBudgetStatus(db, new Date())
    if (budget.exceeded) {
      throw new AppError("本月 AI 预算已达上限，联网搜索暂不可用", { status: 429, code: "BUDGET_EXCEEDED" })
    }

    const { searchOfficialProducts } = await import("@/lib/services/official-search")
    const { resolveRecognitionConfig } = await import("@/lib/services/ai-settings")
    const { recordAiUsage } = await import("@/lib/ai/usage")
    const config = await resolveRecognitionConfig(db)
    if (!config.apiKey) {
      throw new AppError("AI 未配置，无法联网搜索", { status: 400, code: "AI_NOT_CONFIGURED" })
    }

    const e = parsed.extraction
    const search = await searchOfficialProducts(
      db,
      { brand: e.brand, name: e.name, series: e.series, grade: e.grade, scale: e.scale, modelNumber: e.modelNumber },
      { liveSearch: true, apiKey: config.apiKey, model: config.model, baseUrl: config.baseUrl },
    )
    await recordAiUsage(db, {
      provider: "moonshot",
      model: config.model,
      kind: "RECOGNITION",
      latencyMs: search.latencyMs,
      promptTokens: search.promptTokens,
      completionTokens: search.completionTokens,
    }).catch(() => undefined)

    // 草稿同步：重搜结果替换该任务的候选（识别结果本身不变，仍是同一图片任务）
    if (job.resultJson) {
      try {
        const persisted = JSON.parse(job.resultJson) as { candidates?: unknown[]; searchQueries?: string[]; searchState?: string; searchMessage?: string }
        await db.recognitionJob.update({
          where: { id: job.id },
          data: {
            resultJson: JSON.stringify({
              ...persisted,
              candidates: search.candidates,
              searchQueries: search.searchQueries,
              searchState: search.state === "FAILED" ? "FAILED" : "OK",
              searchMessage: search.message,
            }),
          },
        })
      } catch {
        // 持久化失败不阻断响应
      }
    }

    return Response.json({
      candidates: search.candidates,
      searchQueries: search.searchQueries,
      searchState: search.state === "FAILED" ? "FAILED" : "OK",
      searchMessage: search.message,
    })
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return Response.json(body, { status })
  }
}
