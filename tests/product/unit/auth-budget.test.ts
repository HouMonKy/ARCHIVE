import { describe, expect, it, beforeAll, afterAll } from "vitest"
import { getTestDb, resetTestDb } from "../../helpers/db"

/**
 * 产品级单元/契约测试（任务 5）——身份、租户隔离与预算熔断。
 * 使用真实 SQLite（test.db），不 mock 业务逻辑。
 */
import {
  login,
  logout,
  getUserFromCookie,
  readSessionIdFromCookie,
  OWNER_USER_ID,
  DEMO_TENANT_USER_ID,
  DEMO_RECOGNITION_DAILY_LIMIT,
  DEMO_REPORT_DAILY_LIMIT,
} from "@/lib/auth/service"
import { checkDemoQuota } from "@/lib/auth/guard"
import { buildSessionCookieValue, verifySessionCookie, signSessionId, newSessionId, SESSION_COOKIE } from "@/lib/auth/cookie"
import { assertSameOrigin } from "@/lib/auth/guard"
import { AppError } from "@/lib/errors"
import { createRecognitionJob } from "@/lib/services/recognition"
import { generateReport } from "@/lib/services/report"
import { recordAiUsage, getMonthlyBudgetStatus, estimateCostMinor, BUDGET_HARD_LIMIT_MINOR } from "@/lib/ai/usage"
import { demoNow } from "@/lib/clock"

const opts = { hosted: false, secure: false }
const OWNER_TEST_SECRET = "unit-owner-secret"
const VISITOR_TEST_SECRET = "unit-visitor-secret"
const originalOwnerPassword = process.env.OWNER_PASSWORD
const originalVisitorAccessCode = process.env.VISITOR_ACCESS_CODE

function restoreEnv(key: "OWNER_PASSWORD" | "VISITOR_ACCESS_CODE", value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

describe("会话 Cookie 签名（契约）", () => {
  it("签名 Cookie 可验证；篡改任意一位即失效", () => {
    const id = newSessionId()
    const secret = "unit-test-secret-0123456789"
    const cookie = buildSessionCookieValue(id, secret)
    expect(verifySessionCookie(cookie, secret)).toBe(id)
    expect(verifySessionCookie(cookie, "other-secret-0123456789")).toBeNull()
    expect(verifySessionCookie(`${id.slice(0, -1)}${id.slice(-1) === "0" ? "1" : "0"}.${cookie.split(".")[1]}`, secret)).toBeNull()
    expect(verifySessionCookie(undefined, secret)).toBeNull()
    expect(verifySessionCookie("garbage", secret)).toBeNull()
  })

  it("同 sessionId 签名确定；不同 id 签名不同", () => {
    const secret = "unit-test-secret-0123456789"
    const a = newSessionId()
    expect(signSessionId(a, secret)).toBe(signSessionId(a, secret))
    expect(signSessionId(a, secret)).not.toBe(signSessionId(newSessionId(), secret))
  })

  it("readSessionIdFromCookie 从 Cookie 头拆出 id（登出用）", () => {
    const id = newSessionId()
    const cookie = buildSessionCookieValue(id, "unit-test-secret-0123456789")
    expect(readSessionIdFromCookie(`${SESSION_COOKIE}=${cookie}`)).toBe(id)
    expect(readSessionIdFromCookie("other=x")).toBeNull()
  })
})

describe("登录/登出与租户身份（契约）", () => {
  beforeAll(async () => {
    process.env.OWNER_PASSWORD = OWNER_TEST_SECRET
    process.env.VISITOR_ACCESS_CODE = VISITOR_TEST_SECRET
    await resetTestDb()
  })

  afterAll(() => {
    restoreEnv("OWNER_PASSWORD", originalOwnerPassword)
    restoreEnv("VISITOR_ACCESS_CODE", originalVisitorAccessCode)
  })

  it("Owner 正确密码登录成功并下发会话 Cookie", async () => {
    const db = getTestDb()
    const result = await login(db, { mode: "owner", secret: OWNER_TEST_SECRET }, opts)
    expect(result.user.id).toBe(OWNER_USER_ID)
    expect(result.user.role).toBe("OWNER")
    expect(result.setCookie).toContain(`${SESSION_COOKIE}=`)
    expect(result.setCookie).toContain("HttpOnly")
    expect(result.setCookie).toContain("SameSite=Lax")
  })

  it("错误密码拒绝（401），不给 Cookie", async () => {
    const db = getTestDb()
    await expect(login(db, { mode: "owner", secret: "wrong" }, opts)).rejects.toMatchObject({ status: 401 })
  })

  it("Visitor 访问码登录进入独立租户（demo-guest，DEMO 角色）", async () => {
    const db = getTestDb()
    const result = await login(db, { mode: "demo", secret: VISITOR_TEST_SECRET }, opts)
    expect(result.user.id).toBe(DEMO_TENANT_USER_ID)
    expect(result.user.role).toBe("DEMO")
  })

  it("本地 Owner 未配置密码时明确拒绝登录，不使用默认值", async () => {
    const db = getTestDb()
    delete process.env.OWNER_PASSWORD
    try {
      await expect(login(db, { mode: "owner", secret: OWNER_TEST_SECRET }, opts)).rejects.toMatchObject({
        status: 500,
        code: "AUTH_NOT_CONFIGURED",
      })
    } finally {
      process.env.OWNER_PASSWORD = OWNER_TEST_SECRET
    }
  })

  it("本地 Visitor 未配置访问码时明确拒绝登录，不使用默认值", async () => {
    const db = getTestDb()
    delete process.env.VISITOR_ACCESS_CODE
    try {
      await expect(login(db, { mode: "demo", secret: VISITOR_TEST_SECRET }, opts)).rejects.toMatchObject({
        status: 500,
        code: "AUTH_NOT_CONFIGURED",
      })
    } finally {
      process.env.VISITOR_ACCESS_CODE = VISITOR_TEST_SECRET
    }
  })

  it("Cookie 解析出用户；登出（撤销）后失效", async () => {
    const db = getTestDb()
    const { setCookie } = await login(db, { mode: "owner", secret: OWNER_TEST_SECRET }, opts)
    const cookieHeader = setCookie.split(";")[0]!
    const user = await getUserFromCookie(db, cookieHeader)
    expect(user?.id).toBe(OWNER_USER_ID)
    const sessionId = readSessionIdFromCookie(cookieHeader)!
    await logout(db, sessionId)
    expect(await getUserFromCookie(db, cookieHeader)).toBeNull()
  })

  it("伪造/过期会话一律拒绝", async () => {
    const db = getTestDb()
    expect(await getUserFromCookie(db, `${SESSION_COOKIE}=${newSessionId()}.deadbeef`)).toBeNull()
    // 过期：手工把会话 expiresAt 改到过去
    const { setCookie } = await login(db, { mode: "owner", secret: OWNER_TEST_SECRET }, opts)
    const header = setCookie.split(";")[0]!
    const sessionId = readSessionIdFromCookie(header)!
    await db.session.update({ where: { id: sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect(await getUserFromCookie(db, header)).toBeNull()
  })
})

describe("CSRF 同源校验（契约）", () => {
  const req = (origin: string | null, host = "127.0.0.1:3000") =>
    new Request("http://127.0.0.1:3000/api/assets", {
      method: "POST",
      headers: { ...(origin ? { origin } : {}), host },
    })

  it("同源写放行；跨站写 403；无 Origin（非浏览器客户端）放行", () => {
    expect(() => assertSameOrigin(req("http://127.0.0.1:3000"))).not.toThrow()
    expect(() => assertSameOrigin(req(null))).not.toThrow()
    expect(() => assertSameOrigin(req("https://evil.example"))).toThrowError(AppError)
    try {
      assertSameOrigin(req("https://evil.example"))
    } catch (e) {
      expect((e as AppError).status).toBe(403)
      expect((e as AppError).code).toBe("CSRF_REJECTED")
    }
  })

  it("GET 不校验 Origin", () => {
    const get = new Request("http://127.0.0.1:3000/api/demo-images/P01", { headers: { origin: "https://evil.example" } })
    expect(() => assertSameOrigin(get)).not.toThrow()
  })
})

describe("Demo 租户每日限额（识别 3 / 周报 1，Asia/Shanghai 日界）", () => {
  beforeAll(async () => {
    await resetTestDb()
  })

  it("限额计数按用户隔离且只算当日", async () => {
    const db = getTestDb()
    const now = demoNow()
    // Demo 用户今天跑 2 次识别
    await db.recognitionJob.create({ data: { userId: DEMO_TENANT_USER_ID, state: "SUCCEEDED", provider: "fixture", providerVersion: "v1", fileSha256: "a".repeat(64) } })
    await db.recognitionJob.create({ data: { userId: DEMO_TENANT_USER_ID, state: "SUCCEEDED", provider: "fixture", providerVersion: "v1", fileSha256: "b".repeat(64) } })
    const demoUser = { id: DEMO_TENANT_USER_ID, displayName: "面试访客", role: "DEMO" as const }
    let check = await checkDemoQuota(db, demoUser, "RECOGNITION", now)
    expect(check.used).toBe(2)
    expect(check.allowed).toBe(true)
    await db.recognitionJob.create({ data: { userId: DEMO_TENANT_USER_ID, state: "SUCCEEDED", provider: "fixture", providerVersion: "v1", fileSha256: "c".repeat(64) } })
    check = await checkDemoQuota(db, demoUser, "RECOGNITION", now)
    expect(check.used).toBe(DEMO_RECOGNITION_DAILY_LIMIT)
    expect(check.allowed).toBe(false)
    // Owner 不受限
    const owner = { id: OWNER_USER_ID, displayName: "Kai", role: "OWNER" as const }
    expect((await checkDemoQuota(db, owner, "RECOGNITION", now)).allowed).toBe(true)
    // 昨日的用量不计入今日
    const yesterday = new Date(now.getTime() - 24 * 3600_000)
    await db.recognitionJob.create({ data: { userId: DEMO_TENANT_USER_ID, state: "SUCCEEDED", provider: "fixture", providerVersion: "v1", fileSha256: "d".repeat(64), createdAt: yesterday } })
    check = await checkDemoQuota(db, demoUser, "RECOGNITION", new Date(now.getTime() + 48 * 3600_000))
    expect(check.used).toBe(0)
  })

  it("周报限额 1 次/日", async () => {
    const db = getTestDb()
    const now = demoNow()
    const demoUser = { id: DEMO_TENANT_USER_ID, displayName: "面试访客", role: "DEMO" as const }
    await db.agentRun.create({ data: { userId: DEMO_TENANT_USER_ID, runType: "REPORT_GENERATION", latencyMs: 10, status: "OK" } })
    const check = await checkDemoQuota(db, demoUser, "REPORT", now)
    expect(check.limit).toBe(DEMO_REPORT_DAILY_LIMIT)
    expect(check.used).toBe(1)
    expect(check.allowed).toBe(false)
  })
})

describe("AI 月度预算熔断（¥50 硬上限）", () => {
  beforeAll(async () => {
    await resetTestDb()
  })

  it("成本估算：kimi ¥4/¥16、deepseek ¥1/¥4 每百万 token", () => {
    expect(estimateCostMinor("kimi-k2.6", 1_000_000, 0)).toBe(400)
    expect(estimateCostMinor("kimi-k2.6", 0, 1_000_000)).toBe(1600)
    expect(estimateCostMinor("deepseek-v4-flash", 1_000_000, 1_000_000)).toBe(500)
    expect(estimateCostMinor("unknown-model", 999_999, 999_999)).toBe(0)
  })

  it("月内累计达硬上限 → exceeded；当月用量窗口正确聚合", async () => {
    const db = getTestDb()
    const now = demoNow()
    await recordAiUsage(db, { provider: "moonshot", model: "kimi-k2.6", kind: "EVAL", latencyMs: 100, promptTokens: 2_500_000, completionTokens: 0 })
    let status = await getMonthlyBudgetStatus(db, now)
    expect(status.monthKey).toBe("2026-08")
    expect(status.usedMinor).toBe(1000)
    expect(status.warn).toBe(false)
    expect(status.exceeded).toBe(false)
    await recordAiUsage(db, { provider: "deepseek", model: "deepseek-v4-flash", kind: "REPORT", latencyMs: 100, promptTokens: 1_500_000, completionTokens: 0 })
    status = await getMonthlyBudgetStatus(db, now)
    expect(status.usedMinor).toBe(1150)
    expect(status.hardLimitMinor).toBe(BUDGET_HARD_LIMIT_MINOR)
    // 补到硬上限
    await recordAiUsage(db, { provider: "moonshot", model: "kimi-k2.6", kind: "RECOGNITION", latencyMs: 100, promptTokens: 10_000_000, completionTokens: 0 })
    status = await getMonthlyBudgetStatus(db, now)
    expect(status.usedMinor).toBe(5150)
    expect(status.exceeded).toBe(true)
    // 下月窗口清零（不同自然月）
    const nextMonth = new Date("2026-09-15T00:00:00+08:00")
    expect((await getMonthlyBudgetStatus(db, nextMonth)).usedMinor).toBe(0)
  })

  it("预算超限后识别任务直接 BUDGET_EXCEEDED，不再调用模型（无网络请求）", async () => {
    const db = getTestDb()
    // 自足播种：当月用量推超 ¥50 硬上限（不依赖其他用例）
    await db.aiUsageLog.create({
      data: {
        provider: "moonshot",
        model: "kimi-k2.6",
        kind: "RECOGNITION",
        latencyMs: 1,
        promptTokens: 100_000_000, // ¥400 估算，远超上限
        completionTokens: 0,
        costMinor: BUDGET_HARD_LIMIT_MINOR + 100,
      },
    })
    const statusBefore = await getMonthlyBudgetStatus(db, new Date())
    expect(statusBefore.exceeded).toBe(true)
    // 启用 Kimi 形态（E2E/无密钥环境不会意外启用）
    const prevKey = process.env.MOONSHOT_API_KEY
    const prevUrl = process.env.RECOGNITION_API_URL
    process.env.MOONSHOT_API_KEY = "test-key-budget"
    delete process.env.RECOGNITION_API_URL
    try {
      const fs = await import("node:fs")
      const path = await import("node:path")
      const bytes = fs.readFileSync(path.resolve(process.cwd(), "public/demo/samples/box-zeta-glare-demo.svg"))
      const dto = await createRecognitionJob(db, OWNER_USER_ID, {
        name: "box-zeta-glare-demo.svg",
        mimeType: "image/svg+xml",
        bytes,
      })
      expect(dto.state).toBe("FAILED")
      expect(dto.errorCode).toBe("BUDGET_EXCEEDED")
      expect(dto.message).toContain("预算")
    } finally {
      if (prevKey === undefined) delete process.env.MOONSHOT_API_KEY
      else process.env.MOONSHOT_API_KEY = prevKey
      if (prevUrl === undefined) delete process.env.RECOGNITION_API_URL
      else process.env.RECOGNITION_API_URL = prevUrl
    }
    // 且失败路径没有产生新的 AI 调用成本
    const statusAfter = await getMonthlyBudgetStatus(db, new Date())
    expect(statusAfter.usedMinor).toBe(statusBefore.usedMinor)
  })
})

describe("周报幂等（事务/唯一键兜底）", () => {
  beforeAll(async () => {
    await resetTestDb()
  })

  it("同周期重复生成只保留一期；跨周期生成新的一期", async () => {
    const db = getTestDb()
    const now = demoNow()
    const r1 = await generateReport(db, OWNER_USER_ID, now)
    expect(r1.created).toBe(true)
    const r2 = await generateReport(db, OWNER_USER_ID, now)
    expect(r2.created).toBe(false)
    expect(r2.reportId).toBe(r1.reportId)
    expect(await db.insightReport.count()).toBe(1)
    const nextWeek = new Date("2026-09-01T00:00:00+08:00")
    const r3 = await generateReport(db, OWNER_USER_ID, nextWeek)
    expect(r3.created).toBe(true)
    expect(await db.insightReport.count()).toBe(2)
  })
})
