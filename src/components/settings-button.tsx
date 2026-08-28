import Link from "next/link"

/** 设置入口（仅 Owner；Visitor 不渲染本组件） */
export function SettingsButton() {
  return (
    <Link href="/settings" className="mb-btn mb-btn-secondary" data-testid="settings-button">
      设置
    </Link>
  )
}
