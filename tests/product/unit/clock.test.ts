import { describe, expect, it, afterEach } from "vitest"
import { demoNow, isFixedDemoClock } from "@/lib/clock"
import { DEMO_EPOCH_ISO } from "@/lib/demo-dataset"

/**
 * 应用时钟（返工轮任务 1/5）：
 * - 产品模式（无 E2E_MODE）：真实时间（确认/统计/建议刷新用真实 Asia/Shanghai 当前时间）；
 * - E2E_MODE=1（演示/E2E 服务器）：固定演示时钟（旧演示断言可复现）。
 * 本文件运行在产品测试配置（未设 E2E_MODE）——正好覆盖真实时钟分支。
 */

describe("应用时钟：真实时间（产品模式）与固定时钟（E2E_MODE）", () => {
  const originalE2e = process.env.E2E_MODE

  afterEach(() => {
    if (originalE2e === undefined) delete process.env.E2E_MODE
    else process.env.E2E_MODE = originalE2e
  })

  it("产品模式：demoNow 返回真实当前时间（与 Date.now 同秒级）", () => {
    delete process.env.E2E_MODE
    expect(isFixedDemoClock()).toBe(false)
    const before = Date.now()
    const now = demoNow().getTime()
    const after = Date.now()
    expect(now).toBeGreaterThanOrEqual(before)
    expect(now).toBeLessThanOrEqual(after)
  })

  it("E2E_MODE=1：固定演示时钟（PRD §19 纪元）", () => {
    process.env.E2E_MODE = "1"
    expect(isFixedDemoClock()).toBe(true)
    expect(demoNow().getTime()).toBe(new Date(DEMO_EPOCH_ISO).getTime())
  })
})
