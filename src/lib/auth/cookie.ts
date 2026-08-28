import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

/**
 * 签名会话 Cookie（任务书：签名 HttpOnly/SameSite 会话）。
 * Cookie 值形如 `<sessionId>.<hmacHex>`：sessionId 为 32 字节随机 hex，
 * 签名密钥来自 SESSION_SECRET（未设置时用数据库持久化的随机密钥，见 auth/service）。
 */

export const SESSION_COOKIE = "mb_session"
export const SESSION_TTL_MS = 30 * 24 * 3600_000 // 30 天

export function signSessionId(sessionId: string, secret: string): string {
  return createHmac("sha256", secret).update(sessionId).digest("hex")
}

export function newSessionId(): string {
  return randomBytes(32).toString("hex")
}

/** 校验并拆出 sessionId；格式或签名不符返回 null */
export function verifySessionCookie(value: string | undefined | null, secret: string): string | null {
  if (!value) return null
  const dot = value.lastIndexOf(".")
  if (dot <= 0) return null
  const sessionId = value.slice(0, dot)
  const signature = value.slice(dot + 1)
  if (!/^[0-9a-f]{64}$/.test(sessionId) && !/^[0-9a-f]{64}$/.test(signature)) return null
  const expected = signSessionId(sessionId, secret)
  const a = Buffer.from(signature, "hex")
  const b = Buffer.from(expected, "hex")
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return sessionId
}

export function buildSessionCookieValue(sessionId: string, secret: string): string {
  return `${sessionId}.${signSessionId(sessionId, secret)}`
}

export interface CookieAttrs {
  httpOnly: true
  sameSite: "lax"
  path: "/"
  maxAge: number
  secure: boolean
}

export function sessionCookieAttrs(secure: boolean): CookieAttrs {
  return { httpOnly: true, sameSite: "lax", path: "/", maxAge: Math.floor(SESSION_TTL_MS / 1000), secure }
}

export function serializeCookie(name: string, value: string, attrs: CookieAttrs): string {
  const parts = [`${name}=${value}`, `Path=${attrs.path}`, `Max-Age=${attrs.maxAge}`, "HttpOnly", "SameSite=Lax"]
  if (attrs.secure) parts.push("Secure")
  return parts.join("; ")
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`
}
