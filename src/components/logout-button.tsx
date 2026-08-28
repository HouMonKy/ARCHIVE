"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

export function LogoutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  return (
    <button
      type="button"
      className="mb-btn mb-btn-secondary"
      data-testid="logout-button"
      disabled={pending}
      onClick={async () => {
        setPending(true)
        try {
          await fetch("/api/auth/logout", { method: "POST" })
          router.push("/login")
          router.refresh()
        } finally {
          setPending(false)
        }
      }}
    >
      {pending ? "退出中…" : "退出"}
    </button>
  )
}
