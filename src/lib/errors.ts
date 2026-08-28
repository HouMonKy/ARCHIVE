export class AppError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, options: { status?: number; code?: string } = {}) {
    super(message)
    this.name = "AppError"
    this.status = options.status ?? 400
    this.code = options.code ?? "BAD_REQUEST"
  }
}

export function toErrorResponse(e: unknown): { status: number; body: { error: string; code: string } } {
  if (e instanceof AppError) {
    return { status: e.status, body: { error: e.message, code: e.code } }
  }
  console.error("[unhandled]", e)
  return { status: 500, body: { error: "服务器内部错误，请稍后重试", code: "INTERNAL" } }
}
