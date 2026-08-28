import type { PrismaClient } from "@prisma/client"
import { redirect } from "next/navigation"
import { AppError } from "../errors"
import {
  DEMO_RECOGNITION_DAILY_LIMIT,
  DEMO_REPORT_DAILY_LIMIT,
  OWNER_USER_ID,
  getUserFromCookie,
  demoRecognitionUsedToday,
  demoReportUsedToday,
  type AuthenticatedUser,
} from "./service"

/**
 * 请求守卫：会话解析 + 写操作 CSRF 防护 + Demo 租户限额。
 *
 * - E2E_MODE=1 且 E2E_AUTO_LOGIN!=0：自动以 Owner 身份运行（旧 E2E 不感知登录），
 *   产品级 E2E 设 E2E_AUTO_LOGIN=0 以检验真实登录；
 * - CSRF：浏览器同源写请求会带 Origin 头，校验其与 Host 一致（配合 SameSite=Lax 双保险）；
 * - Demo 限额：识别 3 次/日、周报 1 次/日（Asia/Shanghai 日界）。
 */

export function isE2eAutoLogin(): boolean {
  return process.env.E2E_MODE === "1" && process.env.E2E_AUTO_LOGIN !== "0"
}

export async function requireUser(db: PrismaClient, request: Request): Promise<AuthenticatedUser> {
  if (isE2eAutoLogin()) {
    const owner = await db.user.findUnique({ where: { id: OWNER_USER_ID } })
    if (owner) return { id: owner.id, displayName: owner.displayName, role: "OWNER" }
  }
  const user = await getUserFromCookie(db, request.headers.get("cookie"))
  if (!user) {
    throw new AppError("未登录或会话已过期", { status: 401, code: "UNAUTHENTICATED" })
  }
  return user
}

/** 页面用：未登录跳转 /login（API 用 requireUser 返回 401） */
export async function requirePageUser(db: PrismaClient, request: Request): Promise<AuthenticatedUser> {
  if (isE2eAutoLogin()) {
    const owner = await db.user.findUnique({ where: { id: OWNER_USER_ID } })
    if (owner) return { id: owner.id, displayName: owner.displayName, role: "OWNER" }
  }
  const user = await getUserFromCookie(db, request.headers.get("cookie"))
  if (!user) redirect("/login")
  return user
}

/** 校验写请求的 Origin（存在时必须同源；非浏览器客户端无 Origin，允许） */
export function assertSameOrigin(request: Request): void {
  const method = request.method.toUpperCase()
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return
  const origin = request.headers.get("origin")
  if (!origin) return
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  let originHost: string | null = null
  try {
    originHost = new URL(origin).host
  } catch {
    originHost = null
  }
  if (!host || !originHost || originHost !== host) {
    throw new AppError("跨站写请求已被拒绝（CSRF 防护）", { status: 403, code: "CSRF_REJECTED" })
  }
}

export interface DemoQuotaCheck {
  allowed: boolean
  used: number
  limit: number
  kind: "RECOGNITION" | "REPORT"
}

export async function checkDemoQuota(
  db: PrismaClient,
  user: AuthenticatedUser,
  kind: "RECOGNITION" | "REPORT",
  now: Date,
): Promise<DemoQuotaCheck> {
  if (user.role !== "DEMO") return { allowed: true, used: 0, limit: Infinity, kind }
  if (kind === "RECOGNITION") {
    const used = await demoRecognitionUsedToday(db, user.id, now)
    return {
      allowed: used < DEMO_RECOGNITION_DAILY_LIMIT,
      used,
      limit: DEMO_RECOGNITION_DAILY_LIMIT,
      kind,
    }
  }
  const used = await demoReportUsedToday(db, user.id, now)
  return { allowed: used < DEMO_REPORT_DAILY_LIMIT, used, limit: DEMO_REPORT_DAILY_LIMIT, kind }
}

export function quotaError(check: DemoQuotaCheck): AppError {
  const label = check.kind === "RECOGNITION" ? "识别" : "周报生成"
  return new AppError(
    `演示访客每日最多 ${check.limit} 次${label}（今日已用 ${check.used} 次），明天再来或联系 Owner。`,
    { status: 429, code: "DEMO_QUOTA_EXCEEDED" },
  )
}

/** API 写操作统一入口：鉴权 + CSRF + （可选）Demo 限额 */
export async function requireApiUser(
  db: PrismaClient,
  request: Request,
  options: { demoQuota?: "RECOGNITION" | "REPORT"; now?: Date } = {},
): Promise<AuthenticatedUser> {
  assertSameOrigin(request)
  const user = await requireUser(db, request)
  if (options.demoQuota) {
    const check = await checkDemoQuota(db, user, options.demoQuota, options.now ?? new Date())
    if (!check.allowed) throw quotaError(check)
  }
  return user
}
