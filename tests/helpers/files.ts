import { readFileSync } from "node:fs"
import path from "node:path"

/** 读取演示样例文件字节（与 /add 页面“载入演示样例”上传的内容一致） */
export function readSampleFile(fileName: string): { name: string; mimeType: string; bytes: Uint8Array } {
  const file = path.resolve(process.cwd(), "public/demo/samples", fileName)
  const bytes = new Uint8Array(readFileSync(file))
  return { name: fileName, mimeType: "image/svg+xml", bytes }
}

/**
 * 结构完整的 JPEG（SOI + APP0/JFIF + SOF0 1×1 + SOS + 熵 + EOI）。
 * 返工后上传校验做真实结构校验：测试中作为“合法但不在演示样例内”的目录外图片输入。
 */
export function fakeJpegBytes(size = 1024): Uint8Array {
  const base: number[] = [0xff, 0xd8]
  base.push(0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00)
  base.push(0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00)
  base.push(0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00)
  const entropy = new Uint8Array(Math.max(0, size - base.length - 4))
  for (let i = 0; i < entropy.length; i++) entropy[i] = i % 251 // 非 0xFF 的熵样式字节
  const bytes = new Uint8Array([...base, ...entropy, 0xff, 0xd9])
  return bytes
}

/** 伪 JPEG：合法文件头 + 全零内容（用于 CORRUPT_FILE 回归） */
export function fakeJpegHeaderOnlyBytes(size = 1024): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set([0xff, 0xd8, 0xff], 0)
  return bytes
}

export function fakePngBytesCorrupted(size = 1024): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set([0x00, 0x01, 0x02, 0x03], 0)
  return bytes
}

export function oversizeBytes(): Uint8Array {
  return new Uint8Array(10 * 1024 * 1024 + 1)
}
