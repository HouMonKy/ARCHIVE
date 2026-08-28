/** 金额展示：分 → “¥1,234.56”；空值显示占位符 */
export function formatCnyFromMinor(minor: number | null | undefined): string {
  if (minor == null) return "—"
  const yuan = minor / 100
  return `¥${yuan.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** 元字符串 → 分（整数字符串输入合法；非法返回 null） */
export function parseYuanToMinor(input: string | null | undefined): number | null {
  if (input == null) return null
  const trimmed = input.trim()
  if (trimmed === "") return null
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

/** 自定义商品名规范化：去首尾空白、压缩连续空白、小写（用于同 SKU 去重口径） */
export function normalizeCustomName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase()
}

export const BUILD_STATE_LABELS: Record<string, string> = {
  UNOPENED: "未开盒",
  OPENED: "已开盒",
  BUILDING: "制作中",
  COMPLETED: "已完成",
  NOT_APPLICABLE: "不适用",
}

export const DISPOSITION_LABELS: Record<string, string> = {
  ACTIVE: "在藏",
  SOLD: "已售出",
  GIFTED: "已赠出",
  RETURNED: "已退货",
}

export const INSIGHT_TYPE_LABELS: Record<string, string> = {
  NEW_PRODUCT_RECOMMENDATION: "新品动态",
  STALLED_BUILDING: "制作推进",
  STRUCTURE_COMPLETION: "结构补全",
}

export const FEEDBACK_LABELS: Record<string, string> = {
  USEFUL: "有用",
  NOT_INTERESTED: "不感兴趣",
  ACTED: "已采取行动",
}

export function buildStateLabel(key: string): string {
  return BUILD_STATE_LABELS[key] ?? key
}

export function dispositionLabel(key: string): string {
  return DISPOSITION_LABELS[key] ?? key
}

export function insightTypeLabel(key: string): string {
  return INSIGHT_TYPE_LABELS[key] ?? key
}
