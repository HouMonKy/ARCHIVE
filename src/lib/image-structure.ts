/**
 * 图片结构完整性校验（无外部依赖，不新增 package）：
 * - JPEG：逐 marker 解析段结构（段长度合法、存在尺寸合法的 SOF、存在 SOS），并验证熵数据后有 EOI；
 * - PNG：chunk 链完整（长度不越界、每块 CRC32 正确、IHDR 尺寸合法、以 IEND 收尾）；
 * - WebP：RIFF size 与文件长度一致、chunk 链覆盖整个文件且含合法图像块（VP8/VP8L/ANMF）。
 * 截断、仅合法文件头、伪造长度、内容与格式不符均判定损坏。
 */

function u16be(b: Uint8Array, p: number): number {
  return (b[p]! << 8) | b[p + 1]!
}

function u32be(b: Uint8Array, p: number): number {
  return ((b[p]! << 24) | (b[p + 1]! << 16) | (b[p + 2]! << 8) | b[p + 3]!) >>> 0
}

function u32le(b: Uint8Array, p: number): number {
  return ((b[p + 3]! << 24) | (b[p + 2]! << 16) | (b[p + 1]! << 8) | b[p]!) >>> 0
}

const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function pngCrc32(b: Uint8Array, from: number, to: number): number {
  let c = 0xffffffff
  for (let i = from; i < to; i++) c = PNG_CRC_TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** JPEG：SOI → 段循环（含 SOF 尺寸校验）→ SOS 后熵数据必须以 EOI 结束 */
export function validateJpegStructure(b: Uint8Array): boolean {
  if (b.length < 4) return false
  if (b[0] !== 0xff || b[1] !== 0xd8) return false
  let pos = 2
  let seenSof = false
  let sofWidth = 0
  let sofHeight = 0
  while (pos < b.length) {
    if (b[pos] !== 0xff) return false // 段间必须是 marker
    let m = pos + 1
    while (m < b.length && b[m] === 0xff) m++ // 允许填充 FF
    if (m >= b.length) return false
    const marker = b[m]!
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) return false // SOS 前不允许 stuffing/TEM/RST/重复 SOI
    if (marker === 0xd9) return false // 未遇 SOS 就出现 EOI
    const segStart = m + 1
    if (segStart + 2 > b.length) return false
    const segLen = u16be(b, segStart)
    if (segLen < 2) return false
    const segEnd = segStart + segLen
    if (segEnd > b.length) return false // 伪造/截断长度
    if (marker === 0xda) {
      // SOS：进入熵数据，要求文件尾存在 EOI，且 EOI 之后只允许零填充
      let scan = segEnd
      let eoi = -1
      while (scan + 1 < b.length) {
        if (b[scan] === 0xff && b[scan + 1] === 0xd9) {
          eoi = scan
          break
        }
        scan++
      }
      if (eoi < 0) return false
      for (let t = eoi + 2; t < b.length; t++) if (b[t] !== 0x00) return false
      return seenSof && sofWidth > 0 && sofHeight > 0
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      // SOF0–SOF15：段内 precision(1) height(2) width(2)
      if (segLen < 7) return false
      seenSof = true
      sofHeight = u16be(b, segStart + 3)
      sofWidth = u16be(b, segStart + 5)
      if (sofHeight <= 0 || sofWidth <= 0) return false
    }
    pos = segEnd
  }
  return false // 数据耗尽仍未遇 SOS（截断）
}

/** PNG：签名 → IHDR（尺寸合法）→ chunk 链（CRC 全部正确，至少一个非空 IDAT）→ IEND 收尾 */
export function validatePngStructure(b: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (b.length < 8 + 12 + 12) return false
  for (let i = 0; i < 8; i++) if (b[i] !== signature[i]) return false
  let pos = 8
  let first = true
  let idatBytes = 0 // 累计 IDAT 图像数据字节数（W3C：至少一个 IDAT，且须有实际数据）
  while (pos < b.length) {
    if (pos + 12 > b.length) return false // 连 chunk 头都读不完整（截断）
    const len = u32be(b, pos)
    if (len > 0x7fffffff) return false // 伪造长度
    const dataStart = pos + 8
    const dataEnd = dataStart + len
    if (dataEnd + 4 > b.length) return false // 数据或 CRC 被截断
    for (let i = 0; i < 4; i++) {
      const c = b[pos + 4 + i]!
      if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122))) return false // type 必须是 ASCII 字母
    }
    if (pngCrc32(b, pos + 4, dataEnd) !== u32be(b, dataEnd)) return false // CRC 损坏
    const isIdat = b[pos + 4] === 0x49 && b[pos + 5] === 0x44 && b[pos + 6] === 0x41 && b[pos + 7] === 0x54
    if (isIdat) idatBytes += len
    if (first) {
      if (!(b[pos + 4] === 0x49 && b[pos + 5] === 0x48 && b[pos + 6] === 0x44 && b[pos + 7] === 0x52)) return false // 首块必须 IHDR
      if (len !== 13) return false
      const width = u32be(b, dataStart)
      const height = u32be(b, dataStart + 4)
      if (width <= 0 || height <= 0) return false
      first = false
    } else if (b[pos + 4] === 0x49 && b[pos + 5] === 0x45 && b[pos + 6] === 0x4e && b[pos + 7] === 0x44) {
      // IEND：必须是最后一块，且此前必须存在带实际数据的 IDAT（无图像数据的 PNG 无效）
      return dataEnd + 4 === b.length && idatBytes > 0
    }
    pos = dataEnd + 4
  }
  return false // 数据耗尽未遇 IEND（截断）
}

/** WebP：RIFF size 一致 → chunk 链覆盖整个文件且含合法图像块 */
export function validateWebpStructure(b: Uint8Array): boolean {
  if (b.length < 12) return false
  if (!(b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46)) return false
  const riffSize = u32le(b, 4)
  if (riffSize !== b.length - 8) return false // 伪造长度（截断或虚报）
  if (!(b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)) return false
  let pos = 12
  let seenImage = false
  while (pos < b.length) {
    if (pos + 8 > b.length) return false
    const fourcc = String.fromCharCode(b[pos]!, b[pos + 1]!, b[pos + 2]!, b[pos + 3]!)
    const size = u32le(b, pos + 4)
    const chunkEnd = pos + 8 + size
    if (chunkEnd > b.length) return false // chunk 越界（截断/伪造）
    if (fourcc === "VP8 ") {
      // 有损关键帧：帧标记后是起始码 9D 01 2A
      if (size < 10) return false
      if (!(b[pos + 11] === 0x9d && b[pos + 12] === 0x01 && b[pos + 13] === 0x2a)) return false
      seenImage = true
    } else if (fourcc === "VP8L") {
      if (size < 5) return false
      if (b[pos + 8] !== 0x2f) return false // 无损签名
      seenImage = true
    } else if (fourcc === "ANMF") {
      if (size < 16) return false
      seenImage = true // 动画帧内含图像
    } else if (fourcc === "VP8X") {
      if (size !== 10) return false
    } else if (fourcc !== "ALPH" && fourcc !== "ICCP" && fourcc !== "EXIF" && fourcc !== "XMP ") {
      return false // 未知 chunk
    }
    pos = chunkEnd + (size % 2) // RIFF 块按 2 字节对齐填充
  }
  return seenImage && pos === b.length
}
