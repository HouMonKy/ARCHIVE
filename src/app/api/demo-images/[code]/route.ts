import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { isHostedRuntime } from "@/lib/db-mode"
import { trimWhiteBorder } from "@/lib/white-trim"

export const dynamic = "force-dynamic"

const CACHE_DIR = path.resolve(process.cwd(), "private-assets/product-images")
const FALLBACK = path.resolve(process.cwd(), "public/demo/fallback.svg")

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
}

/** 精确候选扩展名（按此顺序逐一尝试精确文件名匹配） */
const EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"]

/**
 * 展示衍生图（收藏柜白边裁剪）：{code}.display.webp。
 * 幂等懒生成：已存在即复用；首次访问时由官方原图只裁外围连续近白边生成；
 * 无明显边框/裁剪失败 → null（收藏柜退回官方原图）。官方原图/SHA 永不修改。
 */
async function readOrGenerateDisplay(code: string, originalPath: string): Promise<Buffer | null> {
  const displayPath = path.join(CACHE_DIR, `${code}.display.webp`)
  if (!displayPath.startsWith(CACHE_DIR + path.sep)) return null
  if (existsSync(displayPath)) {
    try {
      return readFileSync(displayPath)
    } catch {
      return null
    }
  }
  try {
    const source = readFileSync(originalPath)
    const trimmed = await trimWhiteBorder(source)
    if (!trimmed) return null
    writeFileSync(displayPath, trimmed.bytes)
    return Buffer.from(trimmed.bytes)
  } catch {
    return null
  }
}

/**
 * 只读伺服本机私用缓存中的官方商品图（Bandai 官网图 / LEGO 官方产品摄影）。
 * 图片二进制仅存于 gitignored 的 private-assets/（rights_basis=personal-use）；
 * HOSTED（托管）模式不缓存官方图，直接返回占位图——界面始终可用，来源链接另行展示。
 *
 * code 白名单：^[A-Za-z0-9_-]{1,64}$（含下划线——合法 Bandai 商品 ID 形如
 * bandai-item-01_4230 / bandai-01_6681；斜杠、反斜杠、点号、%编码均不在白名单内，
 * 路径穿越在白名单层即被拒绝）。
 *
 * display=1 查询参数：返回收藏柜展示衍生图（仅裁外围白边；不可用时回退原图）。
 * 详情页始终使用官方原图（不带参数）。
 */
export async function GET(request: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params
  // 编码白名单：仅允许 [A-Za-z0-9_-]（P01..P12 / bandai-item-01_4230 / bandai-01_xxxx / lego-42143）
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(code)) {
    return new Response("Not Found", { status: 404 })
  }
  const wantDisplay = new URL(request.url).searchParams.get("display") === "1"
  if (!isHostedRuntime() && existsSync(CACHE_DIR)) {
    // 精确文件名匹配（code + 固定扩展名）：不做前缀/通配匹配，
    // 防止 bandai-item-01_4 命中 bandai-item-01_4230.jpg 一类的前缀误配
    for (const ext of EXTENSIONS) {
      const filePath = path.resolve(CACHE_DIR, `${code}${ext}`)
      if (!filePath.startsWith(CACHE_DIR + path.sep)) {
        return new Response("Not Found", { status: 404 })
      }
      if (!existsSync(filePath)) continue
      if (wantDisplay) {
        // 收藏柜展示衍生图：仅裁外围白边；不可用时回退官方原图
        const display = await readOrGenerateDisplay(code, filePath)
        if (display) {
          return new Response(new Uint8Array(display), {
            headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=3600", "X-Image-Provenance": "local-display-trimmed" },
          })
        }
      }
      const contentType = CONTENT_TYPES[ext]
      if (!contentType) continue
      const bytes = readFileSync(filePath)
      return new Response(new Uint8Array(bytes), {
        headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=3600", "X-Image-Provenance": "local-private-cache" },
      })
    }
  }
  const fallback = existsSync(FALLBACK) ? readFileSync(FALLBACK) : Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")
  return new Response(new Uint8Array(fallback), {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, max-age=300", "X-Image-Provenance": "fallback" },
  })
}
