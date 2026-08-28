import type { Metadata } from "next"
import Link from "next/link"
import { headers } from "next/headers"
import { Oxanium, Space_Grotesk, IBM_Plex_Mono } from "next/font/google"
import "./globals.css"
import { Nav } from "@/components/nav"
import { Badge } from "@/components/ui"
import { getPrismaClientAsync } from "@/lib/prisma"
import { getUserFromCookie, OWNER_USER_ID } from "@/lib/auth/service"
import { isE2eAutoLogin } from "@/lib/auth/guard"
import { LogoutButton } from "@/components/logout-button"
import { SettingsButton } from "@/components/settings-button"

const oxanium = Oxanium({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-oxanium",
  display: "swap",
})

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
})

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
})

export const metadata: Metadata = {
  title: "ARCHIVE · 我的模型收藏",
  description: "个人 Bandai 高达 + LEGO 收藏管理：拍照识别建档、收藏柜管理、随收藏变化更新的收藏建议。",
}

async function currentUserName(): Promise<{ name: string | null; role: "OWNER" | "DEMO" | null }> {
  const db = await getPrismaClientAsync()
  if (isE2eAutoLogin()) {
    const owner = await db.user.findUnique({ where: { id: OWNER_USER_ID } })
    return { name: owner?.displayName ?? null, role: "OWNER" }
  }
  const h = await headers()
  const user = await getUserFromCookie(db, h.get("cookie"))
  return user ? { name: user.displayName, role: user.role } : { name: null, role: null }
}

/** 品牌字标：字母 A 带“档案槽口”切角（克制宽体全大写） */
function ArchiveWordmark() {
  return (
    <span className="inline-flex items-center gap-2.5" aria-hidden>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L22 21H17.6L12 9.2L6.4 21H2L12 2Z" fill="#F3F6F7" />
        <rect x="8.2" y="15" width="7.6" height="2.6" fill="#FFB000" />
      </svg>
      <span className="archive-wordmark text-lg leading-none">ARCHIVE</span>
    </span>
  )
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await currentUserName()
  return (
    <html lang="zh-CN" className={`${oxanium.variable} ${spaceGrotesk.variable} ${ibmPlexMono.variable}`}>
      <body className="min-h-screen antialiased">
        <header className="border-b border-[#1d232a] bg-[#0b0e11] text-paper">
          <div className="mx-auto flex max-w-[1520px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="flex items-baseline gap-2" aria-label="ARCHIVE 首页">
              <ArchiveWordmark />
              <span className="wb-mono hidden sm:inline" style={{ color: "#6b757e" }}>
                PERSONAL MODEL COLLECTION
              </span>
            </Link>
            <div className="order-3 w-full sm:order-none sm:w-auto">
              <Nav />
            </div>
            <div className="order-2 ml-auto flex flex-wrap items-center justify-end gap-2">
              {session.name ? (
                <>
                  <Badge tone="amber">{session.role === "DEMO" ? "Visitor" : "Owner"} · {session.name}</Badge>
                  {session.role === "OWNER" && <SettingsButton />}
                  <LogoutButton />
                </>
              ) : (
                <Link href="/login" className="mb-btn mb-btn-secondary" data-testid="nav-login">
                  登录
                </Link>
              )}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1520px] px-4 py-6">{children}</main>
        <footer className="mt-10 border-t border-[#1d232a] bg-[#0b0e11]">
          <div className="mx-auto max-w-[1520px] px-4 py-6 text-xs leading-6" style={{ color: "#8a939b" }}>
            <p className="wb-mono" style={{ color: "#8a939b" }}>
              ARCHIVE · PERSONAL MODEL COLLECTION
            </p>
          </div>
        </footer>
      </body>
    </html>
  )
}
