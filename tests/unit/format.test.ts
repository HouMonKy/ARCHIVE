import { describe, expect, it } from "vitest"
import { formatCnyFromMinor, parseYuanToMinor, normalizeCustomName, buildStateLabel, insightTypeLabel } from "@/lib/format"
import { demoNow, setDemoNowOverride, diffDays, addDays, startOfDay, formatDateZh } from "@/lib/clock"

describe("金额与文本格式化", () => {
  it("分 → 元 展示", () => {
    expect(formatCnyFromMinor(372000)).toBe("¥3,720.00")
    expect(formatCnyFromMinor(45000)).toBe("¥450.00")
    expect(formatCnyFromMinor(0)).toBe("¥0.00")
    expect(formatCnyFromMinor(null)).toBe("—")
  })

  it("元输入 → 分（缺失返回 null，非法返回 null）", () => {
    expect(parseYuanToMinor("450")).toBe(45000)
    expect(parseYuanToMinor("1299.99")).toBe(129999)
    expect(parseYuanToMinor("")).toBeNull()
    expect(parseYuanToMinor(null)).toBeNull()
    expect(parseYuanToMinor("-5")).toBeNull()
    expect(parseYuanToMinor("abc")).toBeNull()
  })

  it("自定义商品名规范化（大小写与连续空白）", () => {
    expect(normalizeCustomName("  Technic   Supercar Demo ")).toBe("technic supercar demo")
    expect(normalizeCustomName("TECHNIC Supercar Demo")).toBe("technic supercar demo")
  })

  it("状态与洞察类型中文标签", () => {
    expect(buildStateLabel("BUILDING")).toBe("制作中")
    expect(insightTypeLabel("NEW_PRODUCT_RECOMMENDATION")).toBe("新品动态")
  })
})

describe("演示时钟", () => {
  it("固定在 2026-08-25（Asia/Shanghai）", () => {
    const now = demoNow()
    expect(now.toISOString()).toBe("2026-08-24T16:00:00.000Z")
    expect(formatDateZh(now)).toBe("2026-08-25")
  })

  it("diffDays 按日历日计算", () => {
    expect(diffDays(new Date("2026-08-01T00:00:00+08:00"), new Date("2026-08-25T00:00:00+08:00"))).toBe(24)
    expect(diffDays(new Date("2026-08-25T00:00:00+08:00"), new Date("2026-08-25T23:00:00+08:00"))).toBe(0)
  })

  it("addDays / startOfDay / 覆盖机制", () => {
    const now = demoNow()
    expect(formatDateZh(addDays(now, 7))).toBe("2026-09-01")
    expect(formatDateZh(startOfDay(new Date("2026-08-25T15:30:00+08:00")))).toBe("2026-08-25")
    // startOfDay 不依赖机器时区：UTC 深夜也应归到 +08:00 的正确日期
    expect(formatDateZh(startOfDay(new Date("2026-08-24T20:00:00Z")))).toBe("2026-08-25")
    setDemoNowOverride(new Date("2026-09-01T00:00:00+08:00"))
    expect(formatDateZh(demoNow())).toBe("2026-09-01")
    setDemoNowOverride(null)
    expect(formatDateZh(demoNow())).toBe("2026-08-25")
  })
})
