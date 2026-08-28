import { Prisma } from "@prisma/client"

/**
 * 唯一约束冲突判定（P2002）。
 * 并发幂等语义：相同请求并发执行时，竞争失败方不得把唯一键异常变成 500，
 * 而是识别冲突后重读已存在的业务结果并成功返回。
 */
export function isUniqueConstraintViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
}
