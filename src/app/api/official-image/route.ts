import { officialImageHostCheck, sniffImageBytes } from "@/lib/services/official-image"

export const dynamic = "force-dynamic"

const FETCH_TIMEOUT_MS = 20_000
const MAX_BYTES = 8 * 1024 * 1024
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 ModelBaseOfficialImage/1.0"

/**
 * 官网商品图只读代理（官网搜索结果的展示用）：
 * - 仅接受官方域名白名单（Bandai Hobby 官网/官方 CDN、LEGO CDN）——非官方图片 404；
 * - 校验 HTTP 200 + image/* + 魔数后才回传（HTML/403 页面不会当成图片）；
 * - 仅展示用途：真正的封面缓存（落盘 + SHA-256 + imageStatus）在确认入库时完成。
 */
export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url")
  if (!url) return new Response("Not Found", { status: 404 })
  const host = officialImageHostCheck(url)
  if (!host.ok) return new Response("Not Found", { status: 404 })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "image/*" }, signal: controller.signal })
    if (res.status !== 200) return new Response("Not Found", { status: 404 })
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase()
    if (!contentType.startsWith("image/")) return new Response("Not Found", { status: 404 })
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > MAX_BYTES) return new Response("Not Found", { status: 404 })
    if (sniffImageBytes(buf) === "unknown") return new Response("Not Found", { status: 404 })
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=1800", "X-Image-Provenance": "official-proxy" },
    })
  } catch {
    return new Response("Not Found", { status: 404 })
  } finally {
    clearTimeout(timer)
  }
}
