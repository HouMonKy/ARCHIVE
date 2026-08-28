/** 通用文件/时间小工具（无任何外部依赖，可在 Prisma Client 生成前安全 import） */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
