import { redirect } from "next/navigation"
import { getPrismaClientAsync } from "@/lib/prisma"
import { getUserFromCookie } from "@/lib/auth/service"
import { isE2eAutoLogin } from "@/lib/auth/guard"
import { LoginForm } from "./login-form"

export const metadata = { title: "登录 · ARCHIVE" }

export default async function LoginPage() {
  const db = await getPrismaClientAsync()
  if (!isE2eAutoLogin()) {
    const user = await getUserFromCookie(db, null).catch(() => null)
    if (user) redirect("/")
  }
  return (
    <div className="mx-auto max-w-md py-10">
      <h1 className="wb-num text-xl font-bold tracking-tight">登录 ARCHIVE</h1>
      <LoginForm />
    </div>
  )
}
