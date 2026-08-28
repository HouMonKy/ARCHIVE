import { defineConfig } from "@playwright/test"

/**
 * 产品级 E2E 配置（tests/product/e2e/**）：
 * - 与旧套件（tests/e2e，冻结配置 3100 端口）隔离，本配置 3200 端口；
 * - E2E_AUTO_LOGIN=0：检验真实登录（Owner 密码 / Demo 访问码 / 租户隔离 / 限额）；
 * - 仍用 E2E_MODE=1 提供 /api/e2e/state 状态重置（仅本机测试服务器可用）。
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3200",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "npm run db:reset && npm run build && E2E_MODE=1 E2E_AUTO_LOGIN=0 OWNER_PASSWORD=product-e2e-owner DEMO_ACCESS_CODE=product-e2e-demo PORT=3200 npm run start",
    url: "http://127.0.0.1:3200",
    timeout: 420_000,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
  },
})
