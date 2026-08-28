import { DEMO_USER } from "./demo-dataset"

/**
 * V1 固定单演示用户 Kai；本轮起 Kai 即 Owner（本人）。
 * 会话解析统一走 src/lib/auth（guard.requireUser / requirePageUser），
 * 本常量仅供脚本与测试按旧口径引用 Owner。
 */
export const CURRENT_USER_ID = DEMO_USER.id
