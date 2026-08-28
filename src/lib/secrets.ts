import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

/**
 * 服务端密钥加密（/settings）：
 * - AES-256-GCM；主密钥 32 字节随机，存放 private-assets/secrets/master.key
 *   （gitignored 私有目录，权限 0600）；
 * - 密文格式 v1.<iv-hex>.<tag-hex>.<cipher-hex>；
 * - 明文密钥只存在于内存与请求体，绝不落日志/响应/数据库明文字段。
 */

function secretsDir(): string {
  return process.env.SECRETS_DIR
    ? path.resolve(process.env.SECRETS_DIR)
    : path.resolve(process.cwd(), "private-assets", "secrets")
}

function masterKeyPath(): string {
  return path.join(secretsDir(), "master.key")
}

let cachedMasterKey: Buffer | null = null

/** 读取（或首次生成）主密钥；文件权限强制 0600 */
export function getMasterKey(): Buffer {
  if (cachedMasterKey) return cachedMasterKey
  const dir = secretsDir()
  const file = masterKeyPath()
  mkdirSync(dir, { recursive: true })
  if (!existsSync(file)) {
    const key = randomBytes(32)
    writeFileSync(file, key, { mode: 0o600 })
    chmodSync(file, 0o600)
    cachedMasterKey = key
    return key
  }
  const key = readFileSync(file)
  if (key.byteLength !== 32) {
    throw new Error("主密钥长度不合法（应为 32 字节）")
  }
  chmodSync(file, 0o600)
  cachedMasterKey = key
  return key
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", getMasterKey(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1.${iv.toString("hex")}.${tag.toString("hex")}.${enc.toString("hex")}`
}

export function decryptSecret(payload: string): string | null {
  try {
    const [version, ivHex, tagHex, dataHex] = payload.split(".")
    if (version !== "v1" || !ivHex || !tagHex || !dataHex) return null
    const decipher = createDecipheriv("aes-256-gcm", getMasterKey(), Buffer.from(ivHex, "hex"))
    decipher.setAuthTag(Buffer.from(tagHex, "hex"))
    const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()])
    return dec.toString("utf8")
  } catch {
    return null
  }
}

/** 测试钩子：重置进程内缓存（密钥文件被测试替换后重读） */
export function resetMasterKeyCache(): void {
  cachedMasterKey = null
}
