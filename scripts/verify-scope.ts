import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"

/**
 * verify:scope —— 交付边界自检（verify 的第一步，任何失败即非 0 退出）：
 * 1. 冻结文件校验：docs/FROZEN.sha256 原样保留，PRD 与任务书哈希一致；
 * 2. 变更白名单：git 未跟踪/暂存文件全部落在任务书允许的路径内（docs/ 冻结三件套为预存只读文件）；
 * 3. 私用边界：.env、private-assets、本地数据库均被 gitignore，且无越界跟踪。
 */

const failures: string[] = []
function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message)
}

function git(args: string[], opts: { allowFail?: boolean } = {}): string {
  try {
    return execFileSync("git", args, { cwd: process.cwd(), encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] })
  } catch (e) {
    if (opts.allowFail) return ""
    throw e
  }
}

const ALLOWED_EXACT = new Set([
  "package.json",
  "package-lock.json",
  ".gitignore",
  ".env.example",
  "README.md",
  "PROGRESS.md",
  "BLOCKED.md",
  "next-env.d.ts",
  "tsconfig.json",
  // 预存冻结文件（任务 0 之前即存在，只读）
  "docs/PRD.md",
  "docs/DEVELOPMENT_GOAL.md",
  "docs/FROZEN.sha256",
])
const ALLOWED_DIRS = ["src/", "prisma/", "public/demo/", "tests/", "scripts/"]
const ALLOWED_GLOBS = [
  /^next\.config\.[^/]+$/,
  /^postcss\.config\.[^/]+$/,
  /^tailwind\.config\.[^/]+$/,
  /^eslint\.config\.[^/]+$/,
  /^vitest\.config\.[^/]+$/,
  /^playwright\.config\.[^/]+$/,
]

function isAllowedPath(p: string): boolean {
  if (ALLOWED_EXACT.has(p)) return true
  if (ALLOWED_DIRS.some((d) => p.startsWith(d))) return true
  if (ALLOWED_GLOBS.some((r) => r.test(p))) return true
  return false
}

function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex")
}

function main(): void {
  // 1. 冻结文件（等价于 shasum -a 256 -c docs/FROZEN.sha256）
  const frozenPath = path.resolve(process.cwd(), "docs/FROZEN.sha256")
  const frozenContent = readFileSync(frozenPath, "utf-8")
  const expectedFrozen = [
    "8196d999d14f2869d4137ef484ef74b513c77510174d985ea660451769bf9ceb  docs/PRD.md",
    "11431655e82a2a529583b33c7e46133d58f8711df30d5ef12ce7a80cc5efee66  docs/DEVELOPMENT_GOAL.md",
  ]
  for (const line of expectedFrozen) {
    check(frozenContent.includes(line), `docs/FROZEN.sha256 必须原样包含：${line}`)
  }
  check(sha256File(path.resolve("docs/PRD.md")) === "8196d999d14f2869d4137ef484ef74b513c77510174d985ea660451769bf9ceb", "docs/PRD.md 的 SHA-256 与冻结值不一致")
  check(
    sha256File(path.resolve("docs/DEVELOPMENT_GOAL.md")) === "11431655e82a2a529583b33c7e46133d58f8711df30d5ef12ce7a80cc5efee66",
    "docs/DEVELOPMENT_GOAL.md 的 SHA-256 与冻结值不一致",
  )

  // 2. 白名单（未跟踪 + 已暂存）
  const status = git(["status", "--porcelain", "-uall"], { allowFail: true })
  const offenders: string[] = []
  for (const line of status.split("\n")) {
    if (!line.trim()) continue
    const filePath = line.slice(3).replace(/^"|"$/g, "")
    if (filePath.endsWith("/")) continue
    if (!isAllowedPath(filePath)) offenders.push(`${line.slice(0, 2).trim()} ${filePath}`)
  }
  check(offenders.length === 0, `发现越界文件 ${offenders.length} 个：\n    ${offenders.slice(0, 20).join("\n    ")}`)

  // 3. 私用与生成物边界
  const gitignore = readFileSync(path.resolve(process.cwd(), ".gitignore"), "utf-8")
  for (const rule of ["private-assets/", ".env", "*.db", "node_modules/", ".next/", ".DS_Store"]) {
    check(gitignore.includes(rule), `.gitignore 必须包含规则 ${rule}`)
  }
  const trackedOutside = git(["ls-files"], { allowFail: true })
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !isAllowedPath(l))
  check(trackedOutside.length === 0, `Git 暂存区存在越界文件：${trackedOutside.join("、")}`)

  if (failures.length > 0) {
    console.error(`[verify:scope] 未通过（${failures.length} 项）：`)
    for (const f of failures) console.error(`  - ${f}`)
    process.exit(1)
  }
  console.log(`[verify:scope] 通过：冻结文件哈希一致；未跟踪/暂存文件全部在白名单内；私用目录与生成物均已忽略`)
}

main()
