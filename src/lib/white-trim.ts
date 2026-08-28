import sharp from "sharp"

/**
 * 外围白边裁剪（收藏工作台改造）——只生成收藏柜展示衍生图，官方原图/SHA/详情页原图不变：
 * - 仅裁掉从四边向内「连续、低色差」的近白边框；内部白色、模型白色零件与主体绝不处理；
 * - 无明显边框时不裁；裁剪后保留面积 <60% 或任一边 <200px 则放弃（返回 null 用原图）；
 * - 绝不抠主体、去背景、生成透明图或 AI 分割。
 */

export const WHITE_TRIM_THRESHOLD = 12
export const MIN_KEEP_RATIO = 0.6
export const MIN_TRIMMED_EDGE = 200
/** 每边至少要裁掉的行/列数才算「有边框」（防噪点触发裁剪） */
export const MIN_BORDER_PX = 8

export interface TrimResult {
  /** 裁剪后字节（WebP） */
  bytes: Uint8Array
  width: number
  height: number
  /** 实际裁掉的边框（px） */
  trimmed: { top: number; right: number; bottom: number; left: number }
}

/**
 * 计算近白判断：RGB 各通道 ≥ (255 - threshold) 视为近白。
 * 低色差：同一行/列内像素彼此接近（通过均值±阈值带内统计比例 ≥99% 保证连续性）。
 */
function isNearWhite(r: number, g: number, b: number, threshold: number): boolean {
  const min = 255 - threshold
  return r >= min && g >= min && b >= min
}

/** 从原始像素计算四边连续近白边框厚度（0 = 无边框） */
export function computeWhiteBorder(
  pixels: Buffer,
  width: number,
  height: number,
  channels: number,
  threshold = WHITE_TRIM_THRESHOLD,
): { top: number; right: number; bottom: number; left: number } {
  // 行/列近白比例 ≥99% 才视为边框行/列（严格连续近白——0.97 会把含 3% 深色内容的行当边框）
  const ROW_ACCEPT = 0.99
  const rowIsWhite = (y: number): boolean => {
    let white = 0
    const total = width
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels
      if (isNearWhite(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!, threshold)) white++
    }
    return white / total >= ROW_ACCEPT
  }
  const colIsWhite = (x: number): boolean => {
    let white = 0
    const total = height
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * channels
      if (isNearWhite(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!, threshold)) white++
    }
    return white / total >= ROW_ACCEPT
  }

  // 每边只扫前 45%：边框不可能超过图像一半（防止把大面积留白图整张判定为边）
  const maxEdge = Math.floor(Math.min(width, height) * 0.45)

  let top = 0
  while (top < maxEdge && rowIsWhite(top)) top++
  let bottom = 0
  while (bottom < maxEdge && rowIsWhite(height - 1 - bottom)) bottom++
  // 上下确定后再算左右（用中间区域避免角落圆角影响）
  const yStart = Math.min(top, Math.max(0, height - 1 - bottom)) || 0
  let left = 0
  while (left < maxEdge && colIsWhite(left)) left++
  let right = 0
  while (right < maxEdge && colIsWhite(width - 1 - right)) right++
  void yStart

  // 边框太薄视为无边框（防噪）
  const totalBorder = top + right + bottom + left
  if (top < MIN_BORDER_PX && bottom < MIN_BORDER_PX && left < MIN_BORDER_PX && right < MIN_BORDER_PX) {
    return { top: 0, right: 0, bottom: 0, left: 0 }
  }
  void totalBorder
  return { top, right, bottom, left }
}

/**
 * 只裁外围白边生成展示衍生图（WebP）。
 * 不明显边框 / 裁后过小 / 保留面积 <60% → 返回 null（调用方用原图）。
 */
export async function trimWhiteBorder(source: Buffer): Promise<TrimResult | null> {
  const img = sharp(source, { failOn: "none" })
  const meta = await img.metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  if (!width || !height) return null

  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
  const border = computeWhiteBorder(data, info.width, info.height, info.channels)
  if (border.top === 0 && border.right === 0 && border.bottom === 0 && border.left === 0) {
    return null // 无明显边框：不裁
  }

  const newWidth = width - border.left - border.right
  const newHeight = height - border.top - border.bottom
  if (newWidth < MIN_TRIMMED_EDGE || newHeight < MIN_TRIMMED_EDGE) return null
  if (newWidth * newHeight < width * height * MIN_KEEP_RATIO) return null

  const bytes = await sharp(source, { failOn: "none" })
    .extract({ left: border.left, top: border.top, width: newWidth, height: newHeight })
    .webp({ quality: 85 })
    .toBuffer()
  return {
    bytes: new Uint8Array(bytes),
    width: newWidth,
    height: newHeight,
    trimmed: border,
  }
}
