import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // 演示图片由 /api/demo-images 只读伺服本地缓存，不经过图片优化管线
  images: { unoptimized: true },
  // 周报来源链接保持 PRD 约定的 /demo/sources/{eventId} 形式，实际伺服同名 .html 静态页
  async rewrites() {
    return [{ source: "/demo/sources/:id(E\\d+)", destination: "/demo/sources/:id.html" }]
  },
}

export default nextConfig
