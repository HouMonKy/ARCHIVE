import { readFileSync } from "node:fs"
import path from "node:path"

/**
 * Bandai 官网图片清单（scripts/image-manifest.json）读取。
 * 独立于 seed/Prisma：任何脚本在 Prisma Client 未生成时也可安全 import（verify 链第 2 步即 images:check）。
 */

export interface ImageManifestEntry {
  code: string
  canonical_name: string
  official_name_ja: string
  source_page: string
  image_url: string
}

export interface ImageManifest {
  fetched_at: string
  rights_basis: string
  allowed_hosts?: string[]
  products: ImageManifestEntry[]
}

export function readImageManifest(): ImageManifest {
  const file = path.resolve(process.cwd(), "scripts/image-manifest.json")
  return JSON.parse(readFileSync(file, "utf-8")) as ImageManifest
}
