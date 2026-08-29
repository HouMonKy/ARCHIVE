/**
 * 本机生产启动冒烟（任务 5）：真实 app.db + 真实 Kimi 识别 + DeepSeek 周报幂等 + 图片边界 + 预算台账。
 * 用法：node --env-file=.env.local --import tsx scripts/smoke-prod.ts（启动独立 3300 端口，结束即杀）
 */
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"

async function main(): Promise<void> {
  const ownerPassword = process.env.OWNER_PASSWORD
  if (!ownerPassword?.trim()) {
    throw new Error("OWNER_PASSWORD 未配置：生产冒烟测试不会使用默认登录密码")
  }

  const server = spawn("npm", ["run", "start"], {
    env: { ...process.env, PORT: "3300" },
    stdio: "ignore",
  })
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

  let ok = false
  for (let i = 0; i < 30 && !ok; i++) {
    await wait(500)
    try {
      const r = await fetch("http://127.0.0.1:3300/login")
      ok = r.ok
    } catch {
      /* retry */
    }
  }
  if (!ok) {
    console.log("SMOKE_FAIL: server not ready")
    server.kill("SIGKILL")
    process.exit(1)
  }

  try {
    // 1. Owner 登录
    const login = await fetch("http://127.0.0.1:3300/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:3300" },
      body: JSON.stringify({ mode: "owner", secret: ownerPassword }),
    })
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!
    console.log("1. owner login:", login.status)

    // 2. Dashboard 结构（索引轨/行动区/新视觉）
    const dash = await fetch("http://127.0.0.1:3300/", { headers: { cookie } })
    const html = await dash.text()
    console.log(
      "2. dashboard:", dash.status,
      "| hangar-index-rail:", html.includes("hangar-index-rail"),
      "| next-actions:", html.includes("下一步该做什么"),
      "| WORKBENCH:", html.includes("WORKBENCH ARCHIVE"),
    )

    // 3. 真实 Kimi 识别
    const form = new FormData()
    form.append(
      "file",
      new Blob([readFileSync("private-assets/product-images/lego-42172.jpg")], { type: "image/jpeg" }),
      "lego.jpg",
    )
    const rec = await fetch("http://127.0.0.1:3300/api/recognition", {
      method: "POST",
      headers: { Origin: "http://127.0.0.1:3300", cookie },
      body: form,
    })
    const recBody = (await rec.json()) as { state: string; candidates?: { productId: string; confidencePercent: string }[] }
    console.log(
      "3. kimi recognition:", rec.status,
      "| state:", recBody.state,
      "| top1:", recBody.candidates?.[0]?.productId, recBody.candidates?.[0]?.confidencePercent,
    )

    // 4. 周报幂等（真实 DeepSeek 润色）
    const gen = (await fetch("http://127.0.0.1:3300/api/reports/generate", {
      method: "POST",
      headers: { Origin: "http://127.0.0.1:3300", cookie },
    }).then((r) => r.json())) as { created: boolean; reportId: string }
    const gen2 = (await fetch("http://127.0.0.1:3300/api/reports/generate", {
      method: "POST",
      headers: { Origin: "http://127.0.0.1:3300", cookie },
    }).then((r) => r.json())) as { created: boolean; reportId: string }
    console.log("4. report idempotent: first.created =", gen.created, "| replay.created =", gen2.created, "| sameId =", gen.reportId === gen2.reportId)

    // 5. 图片边界
    const img = await fetch("http://127.0.0.1:3300/api/demo-images/lego-42172")
    const imgUnknown = await fetch("http://127.0.0.1:3300/api/demo-images/UNKNOWN-1")
    console.log("5. images:", img.headers.get("x-image-provenance"), "/", imgUnknown.headers.get("x-image-provenance"))
  } finally {
    server.kill("SIGKILL")
  }

  // 6/7. 数据库侧核验
  const { PrismaClient } = await import("@prisma/client")
  const db = new PrismaClient({ datasources: { db: { url: `file:${process.cwd()}/prisma/app.db` } } })
  try {
    const logs = await db.aiUsageLog.count()
    const budget = await db.aiUsageLog.aggregate({ _sum: { costMinor: true } })
    console.log("6. aiUsageLog:", logs, "条, 累计 ¥" + ((budget._sum.costMinor ?? 0) / 100).toFixed(2))
    const report = await db.insightReport.findFirst({ orderBy: { createdAt: "desc" } })
    console.log("7. 最新周报 polishedBy:", report?.polishedBy, "| routeSummary:", Boolean(report?.routeSummaryJson))
    console.log("SMOKE_OK")
  } finally {
    await db.$disconnect()
  }
}

void main().catch((e) => {
  console.error("SMOKE_FAIL:", e instanceof Error ? e.message : String(e))
  process.exit(1)
})
