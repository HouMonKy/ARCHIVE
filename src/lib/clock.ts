import { DEMO_EPOCH_ISO } from "./demo-dataset"

/**
 * 应用时钟（返工轮任务 1）：产品默认使用真实时间（统计/确认/建议刷新均以
 * Asia/Shanghai 日界计算，见 DEMO_TZ_OFFSET_MS）；仅 E2E_MODE=1（演示/E2E
 * 服务器）使用固定演示时钟，保证旧演示断言可复现。
 * 仅 E2E 演练（/api/e2e/state setTime）可临时覆盖；
 * 覆盖值挂在 globalThis 上，避免 Next 各路由 bundle 拆分模块实例导致状态不共享。
 */
const globalForClock = globalThis as unknown as { __mbDemoNowOverride?: Date | null }

/** 是否运行在固定演示时钟下（E2E_MODE=1） */
export function isFixedDemoClock(): boolean {
  return process.env.E2E_MODE === "1"
}

export function demoNow(): Date {
  if (globalForClock.__mbDemoNowOverride) return globalForClock.__mbDemoNowOverride
  if (isFixedDemoClock()) return new Date(DEMO_EPOCH_ISO)
  return new Date()
}

export function setDemoNowOverride(value: Date | null): void {
  globalForClock.__mbDemoNowOverride = value
}

/** 统一时区偏移（Asia/Shanghai，固定 +08:00，不依赖运行机器时区） */
export const DEMO_TZ_OFFSET_MS = 8 * 3600_000

/** 计算天数差：end - start，按 +08:00 日历日计算 */
export function diffDays(start: Date, end: Date): number {
  const a = Math.floor((start.getTime() + DEMO_TZ_OFFSET_MS) / 86_400_000)
  const b = Math.floor((end.getTime() + DEMO_TZ_OFFSET_MS) / 86_400_000)
  return b - a
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime())
  d.setDate(d.getDate() + days)
  return d
}

/** +08:00 时区当日 00:00 */
export function startOfDay(date: Date): Date {
  const dayIndex = Math.floor((date.getTime() + DEMO_TZ_OFFSET_MS) / 86_400_000)
  return new Date(dayIndex * 86_400_000 - DEMO_TZ_OFFSET_MS)
}

export function formatDateZh(date: Date | null | undefined): string {
  if (!date) return "—"
  const shifted = new Date(date.getTime() + DEMO_TZ_OFFSET_MS)
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0")
  const d = String(shifted.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}
