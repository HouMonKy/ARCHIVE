import sharp from "sharp"
import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import path from "node:path"

/**
 * 生成合成 E2E 照片样例（public/demo/samples/photo-sample.jpg）。
 * 素材为脚本内 SVG（双色块 + 文字），非任何官方摄影/用户照片；
 * 输出确定性 JPEG（SHA-256 固定，被 scripts/images-check.ts 白名单钉住校验）。
 * 用途：产品 E2E 的「拍照 → 封面 → 一键确认」链路（Fixture 按内容 SHA 匹配 → P03 0.95）。
 */

const TARGET = path.resolve(process.cwd(), "public", "demo", "samples", "photo-sample.jpg")
const PINNED_SHA256 = "0eb834b0861c66eaaf41ebee2f951776cbf3d028b83d511ca2a1262841741b4e"

const svg = Buffer.from(`<svg width='900' height='675' xmlns='http://www.w3.org/2000/svg'>
    <rect width='900' height='675' fill='#c9ced1'/>
    <rect x='60' y='60' width='780' height='480' fill='#15191c'/>
    <rect x='100' y='100' width='340' height='400' fill='#315efb'/>
    <rect x='470' y='100' width='330' height='400' fill='#f3f5f4'/>
    <text x='60' y='600' font-family='monospace' font-size='48' fill='#15191c'>PHOTO SAMPLE 001</text>
  </svg>`)

async function main(): Promise<void> {
  const out = await sharp(svg).jpeg({ quality: 88 }).toBuffer()
  const sha = createHash("sha256").update(out).digest("hex")
  if (sha !== PINNED_SHA256) {
    // 确定性保障：依赖升级导致字节变化时明确失败（同步更新 images-check 白名单与 Fixture 注册）
    console.error(`[gen-e2e-samples] 生成的 JPEG SHA-256 与固定值不一致：${sha}`)
    process.exit(1)
  }
  writeFileSync(TARGET, out)
  console.log(`[gen-e2e-samples] 已生成 ${TARGET}（${out.length} 字节，SHA-256 ${sha.slice(0, 12)}…）`)
}

void main()
