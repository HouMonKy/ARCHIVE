import { execFileSync } from "node:child_process"

/**
 * 全局测试准备：为 test.db 应用 schema（与迁移一致，db push 幂等）。
 * 单元/组件测试使用真实 SQLite（prisma/test.db，gitignored），不 mock 业务逻辑。
 */
export default function globalSetup(): void {
  execFileSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: "file:./test.db" } as NodeJS.ProcessEnv,
    stdio: "ignore",
  })
}
