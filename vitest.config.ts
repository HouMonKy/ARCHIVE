import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    env: {
      DATABASE_URL: "file:./test.db",
      // 旧演示断言（固定时钟下的停滞天数/成本口径）以 E2E 口径运行；
      // 产品真实时钟行为由 tests/product（未设 E2E_MODE）覆盖。
      E2E_MODE: "1",
    },
    include: ["tests/unit/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    restoreMocks: true,
    // 共享同一个 test.db：串行执行避免文件间竞态
    fileParallelism: false,
  },
})
