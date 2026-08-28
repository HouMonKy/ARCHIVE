import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

/**
 * 产品级单元/契约测试配置（tests/product/unit/**）。
 * 与主配置（tests/unit）分离：主配置文件受边界保护不可修改。
 * 同样使用真实 SQLite（test.db，共享 global-setup 的 db push），不 mock 业务逻辑。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: [fileURLToPath(new URL("./setup-bridge.ts", import.meta.url))],
    globalSetup: [fileURLToPath(new URL("./global-setup-bridge.ts", import.meta.url))],
    env: {
      DATABASE_URL: "file:./test.db",
    },
    include: ["tests/product/unit/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["tests/product/e2e/**", "node_modules/**"],
    restoreMocks: true,
    fileParallelism: false,
  },
})
