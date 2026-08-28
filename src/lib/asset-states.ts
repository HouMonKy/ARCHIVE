/** 浏览器与服务端共享的藏品状态常量；保持无 Node.js 专属依赖。 */
export const BUILD_STATES = ["UNOPENED", "OPENED", "BUILDING", "COMPLETED", "NOT_APPLICABLE"] as const
export type BuildState = (typeof BUILD_STATES)[number]

export const DISPOSITION_STATES = ["ACTIVE", "SOLD", "GIFTED", "RETURNED"] as const
export type DispositionState = (typeof DISPOSITION_STATES)[number]
