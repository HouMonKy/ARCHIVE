import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "npm run db:reset && npm run build && E2E_MODE=1 PORT=3100 npm run start",
    url: "http://127.0.0.1:3100",
    timeout: 420_000,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
  },
})
