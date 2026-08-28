import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { readImageManifest } from "../src/lib/image-manifest"

/**
 * 一次性获取 Bandai 官网商品图到本机私有缓存（gitignored private-assets/product-images/）。
 * - 只访问 scripts/image-manifest.json 清单中 allow_hosts 范围内的官方 URL；
 * - 已存在的文件默认跳过（幂等），--force 强制重取；
 * - 写入 provenance.json 记录来源页面、原图 URL、抓取日期与私人使用依据；
 * - 二进制绝不进入 Git、public/、构建包或共享目录。
 */

const CACHE_DIR = path.resolve(process.cwd(), "private-assets/product-images")
const PROVENANCE_FILE = path.join(CACHE_DIR, "provenance.json")
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

function assertAllowedHost(url: string, allowed: string[]): void {
  const host = new URL(url).hostname
  if (!allowed.includes(host)) {
    throw new Error(`拒绝访问非清单白名单主机：${host}（仅允许 ${allowed.join(", ")}）`)
  }
}

function extFromContentType(ct: string, url: string): string {
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg"
  if (ct.includes("png")) return "png"
  if (ct.includes("webp")) return "webp"
  const m = /\.([a-z0-9]+)$/i.exec(new URL(url).pathname)
  return m ? m[1]!.toLowerCase() : "jpg"
}

async function download(url: string): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://bandai-hobby.net/", Accept: "image/*,*/*;q=0.8" },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  const contentType = res.headers.get("content-type") ?? "application/octet-stream"
  const bytes = Buffer.from(await res.arrayBuffer())
  return { bytes, contentType }
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force")
  const manifest = readImageManifest()
  mkdirSync(CACHE_DIR, { recursive: true })

  const provenance: Record<string, unknown> = existsSync(PROVENANCE_FILE)
    ? (JSON.parse(readFileSync(PROVENANCE_FILE, "utf-8")) as Record<string, unknown>)
    : {}
  let fetched = 0
  let skipped = 0

  for (const p of manifest.products) {
    assertAllowedHost(p.source_page, manifest.allowed_hosts ?? [])
    assertAllowedHost(p.image_url, manifest.allowed_hosts ?? [])

    const existing = (provenance[p.code] ?? null) as { file?: string } | null
    const existingFile = existing?.file ? path.join(CACHE_DIR, existing.file) : null
    if (!force && existingFile && existsSync(existingFile)) {
      skipped += 1
      continue
    }

    const { bytes, contentType } = await download(p.image_url)
    if (!contentType.startsWith("image/")) {
      throw new Error(`${p.code} 响应不是图片：${contentType}`)
    }
    if (bytes.byteLength < 1024) {
      throw new Error(`${p.code} 图片异常过小（${bytes.byteLength} 字节），已拒绝写入`)
    }
    const file = `${p.code}.${extFromContentType(contentType, p.image_url)}`
    writeFileSync(path.join(CACHE_DIR, file), bytes)
    provenance[p.code] = {
      code: p.code,
      canonical_name: p.canonical_name,
      official_name_ja: p.official_name_ja,
      source_page: p.source_page,
      image_url: p.image_url,
      fetched_at: manifest.fetched_at,
      rights_basis: manifest.rights_basis,
      file,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }
    fetched += 1
    console.log(`[images:fetch] ${p.code} ${p.canonical_name} ← ${p.image_url}（${bytes.byteLength} 字节）`)
  }

  writeFileSync(PROVENANCE_FILE, JSON.stringify(provenance, null, 2))
  console.log(`[images:fetch] 完成：新取 ${fetched} 张，跳过已缓存 ${skipped} 张；缓存目录 ${CACHE_DIR}（已 gitignore，仅本机私用）`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
