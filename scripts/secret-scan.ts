import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

/**
 * 密钥泄漏扫描（verify:product 组成部分）：
 * 1. 从 .env.local / .env 读取真实密钥值（绝不打印）；
 * 2. 在全部可交付文件（git 可见 + 白名单路径）中搜索这些值与常见密钥模式；
 * 3. 任何命中即退出非 0。
 */

const failures: string[] = []

function readEnvSecrets(): string[] {
  const secrets: string[] = []
  for (const envFile of [".env.local", ".env"]) {
    const p = path.resolve(process.cwd(), envFile)
    if (!existsSync(p)) continue
    for (const line of readFileSync(p, "utf-8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      const [, key, rawValue] = m
      const value = rawValue?.replace(/^(["'])(.*)\1$/, "$2") ?? ""
      if (!value || value.length < 8) continue
      if (/^(true|false|1|0|file:|http|libsql)/i.test(value)) continue
      if (/KEY|TOKEN|SECRET|PASSWORD/i.test(key!)) secrets.push(value!)
    }
  }
  return secrets
}

function listFiles(dir: string, root: string): string[] {
  const out: string[] = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git" || entry.name === ".DS_Store") continue
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(p, root))
    else out.push(path.relative(root, p))
  }
  return out
}

function listGitVisibleFiles(root: string): string[] {
  try {
    return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
      cwd: root,
      encoding: "utf-8",
    })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    const scanDirs = ["src", "prisma", "scripts", "tests", "public", "docs"]
    const rootFiles = ["package.json", "package-lock.json", ".env.example", "README.md", "PROGRESS.md", "BLOCKED.md"]
    return [...rootFiles.filter((file) => existsSync(path.join(root, file))), ...scanDirs.flatMap((dir) => listFiles(path.join(root, dir), root))]
  }
}

function main(): void {
  const root = process.cwd()
  const secrets = readEnvSecrets()
  console.log(`[secret-scan] 发现本地密钥 ${secrets.length} 个（值不输出）`)

  // 扫描所有 Git 可见文件（已跟踪 + 未跟踪但未被 .gitignore 排除）。
  const files = listGitVisibleFiles(root)

  // 常见密钥模式（Moonshot sk-、DeepSeek sk-、libSQL token、长 hex）
  const patterns: { re: RegExp; label: string }[] = [
    { re: /\bsk-[A-Za-z0-9]{20,}\b/g, label: "API 密钥形态（sk-…）" },
    { re: /\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\b/g, label: "JWT 形态" },
    { re: /\b(?:libsql|turso)_[A-Za-z0-9_\-]{20,}\b/gi, label: "Turso/libSQL token 形态" },
  ]

  let scanned = 0
  for (const rel of files) {
    const abs = path.join(root, rel)
    if (!statSync(abs).isFile()) continue
    const ext = path.extname(rel).toLowerCase()
    if ([".db", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".pdf", ".ico", ".woff", ".woff2"].includes(ext)) continue
    let content: string
    try {
      content = readFileSync(abs, "utf-8")
    } catch {
      continue
    }
    scanned++
    for (const secret of secrets) {
      if (content.includes(secret)) {
        failures.push(`真实密钥值出现在 ${rel}`)
      }
    }
    for (const { re, label } of patterns) {
      const matches = content.match(re)
      if (matches && matches.length > 0) {
        // 白名单：测试中的假密钥样例（非真实值）
        const fake = matches.every((m) => /^(sk-test|sk-fake|test-key)/i.test(m) || m.length < 24)
        if (!fake) failures.push(`${label} 出现在 ${rel}（${matches[0]!.slice(0, 6)}…）`)
      }
    }
  }
  console.log(`[secret-scan] 扫描 ${scanned} 个文件`)

  // 确认 .env* 不在 git 跟踪内
  try {
    const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf-8" })
    for (const line of tracked.split("\n")) {
      const trackedFile = line.trim()
      if (/^\.env(?:$|\.)/.test(trackedFile) && trackedFile !== ".env.example") {
        failures.push(`.env 文件被 Git 跟踪：${trackedFile}`)
      }
    }
  } catch {
    // 无 git 环境时跳过（verify:scope 会兜底）
  }

  // 数据库密钥加密校验：AiProviderConfig 行必须是 v1.* 密文（绝不存明文），
  // 且任何 *.db 中不得出现明文密钥形态
  const dbDir = path.join(root, "prisma")
  if (existsSync(dbDir)) {
    for (const f of readdirSync(dbDir)) {
      if (!f.endsWith(".db")) continue
      const buf = readFileSync(path.join(dbDir, f))
      const text = buf.toString("latin1")
      const plaintextKeys = text.match(/\bsk-[A-Za-z0-9]{20,}\b/g)
      if (plaintextKeys && plaintextKeys.length > 0) {
        failures.push(`prisma/${f} 中发现明文密钥形态（${plaintextKeys.length} 处）——Key 必须以 AES-256-GCM 密文存储`)
      }
    }
  }

  if (failures.length > 0) {
    console.error(`[secret-scan] 未通过（${failures.length} 项）：`)
    for (const f of failures) console.error(`  - ${f}`)
    process.exit(1)
  }
  console.log("[secret-scan] 通过：无真实密钥/密钥形态泄漏；.env 未被跟踪；数据库无明文密钥形态")
}

main()
