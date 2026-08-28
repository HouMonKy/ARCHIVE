/**
 * 部署模式解析（任务书：服务层同时支持 LOCAL(SQLite) 与 HOSTED(Turso/libSQL)，
 * 禁止 Vercel 使用临时 SQLite）。
 *
 * - DATABASE_MODE 未设置：本地默认 LOCAL；
 * - HOSTED 必须提供 LIBSQL_URL（libsql://… 或 file:…）与 LIBSQL_AUTH_TOKEN（远程必填），
 *   否则启动即失败（宁可拒启也不悄悄落到临时 SQLite）；
 * - 在 Vercel（VERCEL=1）上运行 LOCAL 模式同样直接失败：Vercel 文件系统只读，
 *   SQLite 只会写到临时层、请求间丢失，属于被明确禁止的形态。
 */

export type DatabaseMode = "LOCAL" | "HOSTED"

export interface DatabaseModeConfig {
  mode: DatabaseMode
  /** HOSTED 模式的 libSQL 连接 URL（远程 turso 或本地文件） */
  libsqlUrl: string | null
  /** HOSTED 模式的认证 token（远程必填） */
  libsqlAuthToken: string | null
}

export class DatabaseModeError extends Error {
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = "DatabaseModeError"
    this.code = code
  }
}

export function resolveDatabaseMode(env: NodeJS.ProcessEnv = process.env): DatabaseModeConfig {
  const mode = (env.DATABASE_MODE ?? "LOCAL").toUpperCase()

  if (mode === "HOSTED") {
    const url = env.LIBSQL_URL
    if (!url) {
      throw new DatabaseModeError(
        "DATABASE_MODE=HOSTED 需要 LIBSQL_URL（Turso libsql://… 地址）；拒绝退回临时 SQLite。",
        "HOSTED_MISSING_URL",
      )
    }
    const isRemote = !url.startsWith("file:")
    const token = env.LIBSQL_AUTH_TOKEN ?? null
    if (isRemote && !token) {
      throw new DatabaseModeError(
        "远程 libSQL（Turso）需要 LIBSQL_AUTH_TOKEN；拒绝无凭据连接。",
        "HOSTED_MISSING_TOKEN",
      )
    }
    return { mode: "HOSTED", libsqlUrl: url, libsqlAuthToken: token }
  }

  if (mode !== "LOCAL") {
    throw new DatabaseModeError(`未知 DATABASE_MODE=${mode}（仅支持 LOCAL / HOSTED）`, "UNKNOWN_MODE")
  }

  if (env.VERCEL === "1") {
    throw new DatabaseModeError(
      "Vercel 上禁止使用本地 SQLite（文件系统只读，数据会在请求间丢失）：请设置 DATABASE_MODE=HOSTED 与 LIBSQL_URL/LIBSQL_AUTH_TOKEN（Turso 免费层）。",
      "VERCEL_LOCAL_SQLITE_FORBIDDEN",
    )
  }

  return { mode: "LOCAL", libsqlUrl: null, libsqlAuthToken: null }
}

/** 当前是否为托管形态（用于图片策略：托管版不得缓存官方商品图）。非抛错检查。 */
export function isHostedRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.DATABASE_MODE ?? "").toUpperCase() === "HOSTED" || env.VERCEL === "1"
}
