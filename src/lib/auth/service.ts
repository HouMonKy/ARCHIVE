import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"
import type { PrismaClient, User } from "@prisma/client"
import { AppError } from "../errors"
import { startOfDay } from "../clock"
import { isUniqueConstraintViolation } from "../db-errors"
import { DEMO_USER } from "../demo-dataset"
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  buildSessionCookieValue,
  newSessionId,
  verifySessionCookie,
} from "./cookie"

const scrypt = promisify(scryptCb) as (pw: string, salt: string, keylen: number) => Promise<Buffer>

/**
 * 身份与租户服务（任务 1）：
 * - Owner（本人）：密码来自 OWNER_PASSWORD 环境变量，scrypt 验证，不落库；
 * - Visitor（访客沙箱）：访问码来自 VISITOR_ACCESS_CODE，独立租户 + 每日限额；
 * - 会话：签名 Cookie 指向数据库 Session 行，可撤销、可过期。
 */

export const OWNER_USER_ID = DEMO_USER.id // 保留 V1 的 Kai 作为 Owner
export const DEMO_TENANT_USER_ID = "demo-guest"
export const VISITOR_DISPLAY_NAME = "访客"

export const DEMO_RECOGNITION_DAILY_LIMIT = 3
export const DEMO_REPORT_DAILY_LIMIT = 1

export interface AuthenticatedUser {
  id: string
  displayName: string
  role: "OWNER" | "DEMO"
}

export function toAuthenticatedUser(u: User): AuthenticatedUser {
  const role = u.role === "DEMO" ? "DEMO" : "OWNER"
  return {
    id: u.id,
    displayName: role === "DEMO" ? VISITOR_DISPLAY_NAME : u.displayName,
    role,
  }
}

/** 数据库持久化的会话签名密钥（SESSION_SECRET 未设置时的回退，重启不失效） */
async function getSessionSecret(db: PrismaClient): Promise<string> {
  const fromEnv = process.env.SESSION_SECRET
  if (fromEnv && fromEnv.length >= 16) return fromEnv
  const existing = await db.appSecret.findUnique({ where: { key: "session-secret" } })
  if (existing?.value) return existing.value
  // 并发初始化安全：两个请求/进程同时生成密钥时，唯一键竞争的败者重读胜者，
  // 绝不允许后写覆盖先写（否则先签发的会话 Cookie 会集体失效）
  const candidate = randomBytes(32).toString("hex")
  try {
    await db.appSecret.create({ data: { key: "session-secret", value: candidate } })
    return candidate
  } catch (e) {
    if (isUniqueConstraintViolation(e)) {
      const winner = await db.appSecret.findUniqueOrThrow({ where: { key: "session-secret" } })
      return winner.value
    }
    throw e
  }
}

async function verifySecret(input: string, expected: string): Promise<boolean> {
  const salt = "model-base-fixed-salt"
  const [a, b] = await Promise.all([scrypt(input, salt, 32), scrypt(expected, salt, 32)])
  return timingSafeEqual(a, b)
}

function requiredPassword(env: NodeJS.ProcessEnv, key: "OWNER_PASSWORD" | "VISITOR_ACCESS_CODE"): string {
  const value = env[key]
  if (value?.trim()) return value
  throw new AppError(`${key} 未配置：请在 .env.local 或运行环境中显式设置访问凭据`, {
    status: 500,
    code: "AUTH_NOT_CONFIGURED",
  })
}

export interface LoginResult {
  user: AuthenticatedUser
  setCookie: string
}

export async function login(
  db: PrismaClient,
  input: { mode: "owner" | "demo"; secret: string },
  options: { hosted: boolean; secure: boolean },
): Promise<LoginResult> {
  const { mode, secret } = input
  if (!secret || secret.length > 200) {
    throw new AppError("请输入访问凭据", { status: 400, code: "BAD_CREDENTIALS" })
  }
  const env = process.env
  let user: User | null = null

  if (mode === "owner") {
    const expected = requiredPassword(env, "OWNER_PASSWORD")
    if (await verifySecret(secret, expected)) {
      user = await db.user.findUnique({ where: { id: OWNER_USER_ID } })
    }
  } else {
    const expected = requiredPassword(env, "VISITOR_ACCESS_CODE")
    if (await verifySecret(secret, expected)) {
      user = await db.user.findUnique({ where: { id: DEMO_TENANT_USER_ID } })
    }
  }

  if (!user) {
    throw new AppError("凭据不正确", { status: 401, code: "INVALID_CREDENTIALS" })
  }

  const sessionId = newSessionId()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db.session.create({
    data: { id: sessionId, userId: user.id, expiresAt },
  })
  const cookieSecret = await getSessionSecret(db)
  const { serializeCookie, sessionCookieAttrs } = await import("./cookie")
  const setCookie = serializeCookie(SESSION_COOKIE, buildSessionCookieValue(sessionId, cookieSecret), sessionCookieAttrs(options.secure))
  return { user: toAuthenticatedUser(user), setCookie }
}

export async function logout(db: PrismaClient, sessionId: string): Promise<void> {
  await db.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } }).catch(() => undefined)
}

/** 从 Cookie 解析当前用户；无会话/失效返回 null */
export async function getUserFromCookie(
  db: PrismaClient,
  cookieHeader: string | null | undefined,
): Promise<AuthenticatedUser | null> {
  const cookies = parseCookies(cookieHeader)
  const raw = cookies[SESSION_COOKIE]
  if (!raw) return null
  const secret = await getSessionSecret(db)
  const sessionId = verifySessionCookie(raw, secret)
  if (!sessionId) return null
  const session = await db.session.findUnique({ where: { id: sessionId }, include: { user: true } })
  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) return null
  return toAuthenticatedUser(session.user)
}

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(";")) {
    const eq = part.indexOf("=")
    if (eq <= 0) continue
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
  }
  return out
}

export function readSessionIdFromCookie(cookieHeader: string | null | undefined): string | null {
  const raw = parseCookies(cookieHeader)[SESSION_COOKIE]
  if (!raw) return null
  const dot = raw.lastIndexOf(".")
  if (dot <= 0) return null
  return raw.slice(0, dot)
}

// —— Demo 租户每日限额（Asia/Shanghai 日界） ——

export async function demoRecognitionUsedToday(db: PrismaClient, userId: string, now: Date): Promise<number> {
  return db.recognitionJob.count({
    where: { userId, createdAt: { gte: startOfDay(now) } },
  })
}

export async function demoReportUsedToday(db: PrismaClient, userId: string, now: Date): Promise<number> {
  return db.agentRun.count({
    where: { userId, runType: "REPORT_GENERATION", createdAt: { gte: startOfDay(now) } },
  })
}

export function fingerprintUserAgent(ua: string | null | undefined): string {
  return createHash("sha256").update(ua ?? "").digest("hex").slice(0, 12)
}
