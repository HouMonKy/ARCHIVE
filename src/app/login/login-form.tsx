"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

type Mode = "owner" | "demo"

export function LoginForm() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>("owner")
  const [secret, setSecret] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, secret }),
      })
      const body = (await res.json()) as { error?: string }
      if (!res.ok) {
        setError(body.error ?? "登录失败")
        return
      }
      router.push("/")
      router.refresh()
    } catch {
      setError("网络错误，请重试")
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="mb-card mt-6 p-5" data-testid="login-form">
      <fieldset>
        <legend className="mb-label">身份</legend>
        <div className="flex gap-2">
          <label className="flex flex-1 cursor-pointer items-center gap-2 rounded border border-aluminium px-3 py-2 text-sm has-checked:border-blueprint has-checked:bg-workbench">
            <input
              type="radio"
              name="login-mode"
              value="owner"
              checked={mode === "owner"}
              onChange={() => setMode("owner")}
              data-testid="login-mode-owner"
            />
            Owner
          </label>
          <label className="flex flex-1 cursor-pointer items-center gap-2 rounded border border-aluminium px-3 py-2 text-sm has-checked:border-blueprint has-checked:bg-workbench">
            <input
              type="radio"
              name="login-mode"
              value="demo"
              checked={mode === "demo"}
              onChange={() => setMode("demo")}
              data-testid="login-mode-demo"
            />
            Visitor
          </label>
        </div>
      </fieldset>

      <label className="mb-label mt-4" htmlFor="login-secret">
        {mode === "owner" ? "Owner 访问密码" : "Visitor 访问码"}
      </label>
      <input
        id="login-secret"
        className="mb-input"
        type="password"
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        autoComplete={mode === "owner" ? "current-password" : "one-time-code"}
        data-testid="login-secret"
        required
      />

      {error && (
        <p role="alert" className="mt-3 text-sm text-[color:var(--signal)]" data-testid="login-error">
          {error}
        </p>
      )}

      <button type="submit" className="mb-btn mb-btn-primary mt-5 w-full" disabled={pending} data-testid="login-submit">
        {pending ? "登录中…" : "进入工作台"}
      </button>
    </form>
  )
}
