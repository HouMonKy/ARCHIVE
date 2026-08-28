import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// vitest 未开 globals：手动挂载 RTL 清理，避免用例间 DOM 泄漏
afterEach(cleanup)
