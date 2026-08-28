"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const LINKS = [
  { href: "/", label: "收藏总览" },
  { href: "/collection", label: "收藏柜" },
  { href: "/add", label: "入柜" },
  { href: "/advice", label: "收藏建议" },
]

/**
 * 主导航：活动 Tab 用索引琥珀橙（#FFB000 文字与边框 + 深色底 #211A0B），
 * 对比度 ≥4.5:1；非活动 Tab 银灰。
 */
export function Nav() {
  const pathname = usePathname()
  return (
    <nav aria-label="主导航" className="flex gap-1 overflow-x-auto" data-testid="main-nav">
      {LINKS.map((link) => {
        const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href)
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            data-testid={active ? "nav-tab-active" : undefined}
            className={`flex shrink-0 items-baseline rounded-sm border px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "border-[#FFB000] bg-[#211A0B] text-[#FFB000]"
                : "border-transparent text-aluminium hover:bg-white/10 hover:text-white"
            }`}
            style={active ? { color: "#FFB000", borderColor: "#FFB000", background: "#211A0B" } : undefined}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
