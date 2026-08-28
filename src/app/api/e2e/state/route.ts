import { getPrismaClientAsync } from "@/lib/prisma"
import { setDemoNowOverride } from "@/lib/clock"
import { seedDemoData } from "@/lib/services/seed"
import { toErrorResponse } from "@/lib/errors"

/**
 * E2E 演练专用状态控制（仅在 E2E_MODE=1 的本地测试服务器上生效，生产/默认模式返回 404）。
 * 用途：D-06（<3 件解锁说明）、D-09（空收藏/无新品）、D-07（跨周期抑制验证）。
 */

type E2EAction = "demo" | "minimal" | "empty" | "noEvents" | "setTime" | "resetTime"

export async function POST(request: Request) {
  try {
    if (process.env.E2E_MODE !== "1") {
      return new Response("Not Found", { status: 404 })
    }
    const db = await getPrismaClientAsync()
    const body = (await request.json()) as { action?: E2EAction; iso?: string }
    switch (body.action) {
      case "demo":
        await seedDemoData(db, { assets: "all", events: true, intents: true })
        setDemoNowOverride(null)
        break
      case "minimal":
        await seedDemoData(db, { assets: "minimal", events: true, intents: false })
        setDemoNowOverride(null)
        break
      case "empty":
        await seedDemoData(db, { assets: "none", events: true, intents: false })
        setDemoNowOverride(null)
        break
      case "noEvents":
        await seedDemoData(db, { assets: "all", events: false, intents: true })
        setDemoNowOverride(null)
        break
      case "setTime":
        if (!body.iso) throw new Error("setTime 需要 iso 参数")
        setDemoNowOverride(new Date(body.iso))
        break
      case "resetTime":
        setDemoNowOverride(null)
        break
      default:
        return Response.json({ ok: false, error: "未知 action" }, { status: 400 })
    }
    return Response.json({ ok: true, action: body.action })
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return Response.json(body, { status })
  }
}
