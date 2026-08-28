import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { readImageManifest } from "../src/lib/image-manifest"

/**
 * 校验图片私用边界（verify 的组成部分，任何一项失败即退出非 0）：
 * 1. 清单完整：12/12 条目有来源页面、原图 URL、抓取日期与 rights_basis=personal-use；
 * 2. 本地缓存：private-assets/product-images/ 下每个商品恰有一张 >1KB 的图片文件；
 * 3. Git 边界：缓存目录被 gitignore、无任何官网图被跟踪、public/ 与 src/ 无二进制图片。
 *    唯一例外：合成 E2E 照片样例（本地脚本生成，非任何官方摄影；SHA-256 固定校验，
 *    防止被替换为真实照片）。
 */

const CACHE_DIR = path.resolve(process.cwd(), "private-assets/product-images")
const BINARY_IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"])
// 合成 E2E 照片样例（scripts 生成：双色块 SVG → JPEG；用于拍照→封面→一键确认链路测试）
const SYNTHETIC_IMAGE_ALLOWLIST: Record<string, string> = {
  "public/demo/samples/photo-sample.jpg": "0eb834b0861c66eaaf41ebee2f951776cbf3d028b83d511ca2a1262841741b4e",
}

const failures: string[] = []
function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message)
}

function git(args: string[], allowFail = false): string {
  try {
    return execFileSync("git", args, { cwd: process.cwd(), encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] })
  } catch (e) {
    if (allowFail) return ""
    throw e
  }
}

function listFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFilesRecursive(p))
    else out.push(p)
  }
  return out
}

function main(): void {
  const manifest = readImageManifest()
  const expectedCodes = ["P01","P02","P03","P04","P05","P06","P07","P08","P09","P10","P11","P12"]

  // 1. 清单完整性
  check(manifest.products.length === 12, `清单应有 12 条，实际 ${manifest.products.length}`)
  check(
    manifest.products.map((p) => p.code).join(",") === expectedCodes.join(","),
    "清单商品编码必须为 P01–P12 且有序",
  )
  for (const p of manifest.products) {
    check(Boolean(p.source_page?.startsWith("https://bandai-hobby.net/")), `${p.code} 缺少 Bandai 官方来源页面`)
    check(Boolean(p.image_url), `${p.code} 缺少原图 URL`)
    check(Boolean(p.canonical_name && p.official_name_ja), `${p.code} 缺少商品名`)
  }
  check(manifest.rights_basis === "personal-use", "清单 rights_basis 必须为 personal-use")
  check(Boolean(manifest.fetched_at), "清单缺少抓取日期 fetched_at")

  // 2. 本地缓存
  // .display.webp 是收藏柜展示衍生图（仅裁外围白边，非官方原图）——唯一性校验只针对官方原图
  const cached = existsSync(CACHE_DIR) ? readdirSync(CACHE_DIR).filter((f) => !f.startsWith(".") && !f.endsWith(".display.webp")) : []
  for (const code of expectedCodes) {
    const files = cached.filter((f) => f.startsWith(`${code}.`))
    check(files.length === 1, `${code} 在缓存目录应有且仅有一张图片（实际 ${files.length} 张）`)
    const file = files[0]
    if (file) {
      const size = statSync(path.join(CACHE_DIR, file)).size
      check(size > 1024, `${code} 缓存图片异常过小（${size} 字节）`)
    }
  }

  // 3. Git 边界
  const gitignore = readFileSync(path.resolve(process.cwd(), ".gitignore"), "utf-8")
  check(/(^|\n)private-assets\/(\n|$)/.test(gitignore), ".gitignore 必须忽略 private-assets/")

  for (const f of cached) {
    const rel = `private-assets/product-images/${f}`
    let ignored = false
    try {
      execFileSync("git", ["check-ignore", "-q", rel], { cwd: process.cwd(), stdio: "ignore" })
      ignored = true
    } catch {
      ignored = false
    }
    check(ignored, `缓存文件 ${rel} 必须被 gitignore`)
  }

  const tracked = git(["ls-files", "private-assets"], true).trim()
  check(tracked === "", `private-assets 下不得有被 Git 跟踪的文件（发现 ${tracked}）`)

  for (const dir of ["public", "src", "scripts"]) {
    for (const file of listFilesRecursive(path.resolve(process.cwd(), dir))) {
      const rel = path.relative(process.cwd(), file)
      if (BINARY_IMAGE_EXT.has(path.extname(file).toLowerCase())) {
        const pinnedSha = SYNTHETIC_IMAGE_ALLOWLIST[rel]
        if (pinnedSha) {
          // 例外必须是原样合成样例（SHA-256 固定）——被换成任何真实照片即失败
          const sha = createHash("sha256").update(readFileSync(file)).digest("hex")
          check(sha === pinnedSha, `合成样例 ${rel} 的 SHA-256 与固定值不一致（疑似被替换）`)
          continue
        }
        check(false, `发现二进制图片越界文件：${rel}`)
      }
    }
  }

  if (failures.length > 0) {
    console.error(`[images:check] 未通过（${failures.length} 项）：`)
    for (const f of failures) console.error(`  - ${f}`)
    console.error("提示：若缓存缺失，请先运行 npm run images:fetch（仅访问清单内 Bandai 官方 URL）")
    process.exit(1)
  }

  console.log(`[images:check] 通过：${manifest.products.length}/12 官网图有来源记录，仅存于本机缓存 ${CACHE_DIR}，无越界二进制`)
}

main()
