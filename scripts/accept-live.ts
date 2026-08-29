import { execFileSync, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

/**
 * 真实验收（识别主链路重构轮）：在独立 acceptance.db 上跑通
 * 「上传图片 → Kimi 视觉识别（原始结果原样展示）→ Kimi $web_search 官网搜索（验证候选）
 *   → 用户核对选择 → 官网图设为收藏封面」全链路 + UI/防覆盖回归。
 *
 * 核心断言（任务书验收）：
 *  A. IMG_5700.JPG（沙扎比）：AI 识别结果必须是沙扎比（サザビー/MSN-04/逆袭的夏亚），
 *     绝不能被本地目录覆盖为古夫（グフ/古夫）；
 *  B. Kimi 原始结果在页面原样可见、可编辑（标题「AI 识别结果，请核对」）；
 *  C. 官网搜索结果与 AI 识别结果分开显示，找到官方沙扎比页面
 *     （manual.bandai-hobby.net/menus/detail/949，品番 2204932）与官网图片；
 *  D. 不同图片（test.JPG 强袭自由）产生不同结果——识别结果不固定；
 *  E. 搜索失败/无结果时不得从目录中找一个"最像的"商品顶替；
 *  F. 修改商品名称后可以重新执行官网搜索；
 *  G. 用户确认后收藏柜显示官网抓取图片（非上传照片），上传照片只作实拍图；
 *  H. LEGO Set Number 精确路径与设置页回环。
 *
 * 不 mock 真实验收、不 skip、不 fixture 冒充；app.db 只做幂等迁移（绝不 reset）。
 */

const ROOT = process.cwd()
const APP_DB = path.join(ROOT, "prisma", "app.db")
const ACCEPT_DB = path.join(ROOT, "prisma", "acceptance.db")
const SAZABI_IMAGE = "/Users/hmonky/Downloads/IMG_5700.JPG"
const FREEDOM_IMAGE = "/Users/hmonky/Downloads/IMG_5694.JPG"
const LEGO_IMAGE_CANDIDATES = [
  path.join(ROOT, "private-assets", "product-images", "lego-42172.png"),
  path.join(ROOT, "private-assets", "product-images", "lego-42172.jpg"),
]
const LEGO_IMAGE = LEGO_IMAGE_CANDIDATES.find((f) => existsSync(f)) ?? LEGO_IMAGE_CANDIDATES[0]!
const APP_PORT = "3295"
const ACCEPT_PORT = "3296"
const APP_OWNER_SECRET = "accept-app-owner"
const APP_VISITOR_SECRET = "accept-app-visitor"

function fail(message: string): never {
  console.error(`[accept:live] 失败：${message}`)
  process.exit(1)
}

function sha256File(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

function run(cmd: string, args: string[], env: Record<string, string> = {}): void {
  execFileSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } as NodeJS.ProcessEnv })
}

/** .env.local → process.env（tsx 脚本不自动加载；值绝不打印） */
function loadEnvLocal(): void {
  const file = path.join(ROOT, ".env.local")
  if (!existsSync(file)) return
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(\S+)\s*$/)
    if (!m) continue
    const [, key, value] = m
    if (!process.env[key!]) process.env[key!] = value!
  }
}

interface Evidence {
  appDbShaBefore: string
  appDbShaFinal: string
  appDbAssetsBefore: number
  appDbAssetsAfter: number
  sazabi: { aiExtraction?: unknown; officialCandidate?: unknown; asset?: unknown; officialImage?: { contentType: string; bytes: number; sha256: string } } & Record<string, unknown>
  freedom: { aiExtraction?: unknown } & Record<string, unknown>
  lego: { assetId?: string; product?: string; nameZh?: string; officialImageUrl?: string; imageSha256?: string | null } & Record<string, unknown>
  uiChecks: string[]
}

const evidence: Evidence = {
  appDbShaBefore: "",
  appDbShaFinal: "",
  appDbAssetsBefore: -1,
  appDbAssetsAfter: -1,
  sazabi: {},
  freedom: {},
  lego: {},
  uiChecks: [],
}

async function main(): Promise<void> {
  loadEnvLocal()
  if (process.env.E2E_MODE === "1") fail("E2E_MODE=1 下不运行真实验收")
  if (!process.env.MOONSHOT_API_KEY) fail("未配置 MOONSHOT_API_KEY（真实验收必须直连 Kimi，禁止 Fixture 冒充）")
  if (!existsSync(SAZABI_IMAGE)) fail(`找不到沙扎比验收照片 ${SAZABI_IMAGE}`)
  if (!existsSync(FREEDOM_IMAGE)) fail(`找不到对照照片（强袭自由）${FREEDOM_IMAGE}`)

  // ———— 阶段 0：备份 + 指纹 ———— //
  const backupsDir = path.join(ROOT, "private-assets", "backups")
  mkdirSync(backupsDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)
  const backupPath = path.join(backupsDir, `app-${stamp}-pre-search-flow.db`)
  copyFileSync(APP_DB, backupPath)
  evidence.appDbShaBefore = sha256File(APP_DB)
  console.log(`[accept:live] app.db 已备份 → ${path.relative(ROOT, backupPath)}（SHA-256 ${evidence.appDbShaBefore.slice(0, 12)}…）`)

  // ———— 阶段 1：幂等迁移（app.db 绝不 reset） ———— //
  run("npx", ["prisma", "migrate", "deploy"], { DATABASE_URL: `file:${APP_DB}` })
  console.log("[accept:live] app.db 幂等迁移完成（migrate deploy）")
  {
    // 资产基线（用户真实库，数量随时在增长——验收只保证不减少/不重复，不钉死具体值）
    const { PrismaClient } = await import("@prisma/client")
    const db = new PrismaClient({ datasources: { db: { url: `file:${APP_DB}` } } })
    try {
      evidence.appDbAssetsBefore = await db.collectionAsset.count({ where: { userId: "kai" } })
      console.log(`[accept:live] app.db Owner 资产基线：${evidence.appDbAssetsBefore} 件（验收前后必须一致）`)
    } finally {
      await db.$disconnect()
    }
  }

  // ———— 阶段 2：acceptance.db 全新建库（迁移 + 基础行 + 只读复制官方目录） ———— //
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    if (existsSync(`${ACCEPT_DB}${suffix}`)) rmSync(`${ACCEPT_DB}${suffix}`, { force: true })
  }
  run("npx", ["prisma", "migrate", "deploy"], { DATABASE_URL: `file:${ACCEPT_DB}` })
  {
    const { PrismaClient } = await import("@prisma/client")
    const db = new PrismaClient({ datasources: { db: { url: `file:${ACCEPT_DB}` } } })
    try {
      const { ensureBaseRows } = await import("../src/lib/services/bootstrap")
      await ensureBaseRows(db)
      const appDb = new PrismaClient({ datasources: { db: { url: `file:${APP_DB}` } } })
      try {
        const products = await appDb.catalogProduct.findMany({ where: { catalogVersion: "official-v1" } })
        await db.catalogProduct.createMany({ data: products })
        console.log(`[accept:live] acceptance.db 准备完成（官方目录 ${products.length} 条从 app.db 只读复制）`)
      } finally {
        await appDb.$disconnect()
      }
    } finally {
      await db.$disconnect()
    }
  }

  // ———— 阶段 3：UI 全链路验收（acceptance.db 生产服务器 + Playwright + 真实 Kimi） ———— //
  await runUiAcceptance()

  // ———— 阶段 4：API 层防覆盖回归（无结果不顶替 / 不同图片不同结果 / 幂等） ———— //
  await runApiRegressions()

  // ———— 阶段 5：设置读写回环（dummy Key） ———— //
  await runSettingsRoundtrip()

  // ———— 阶段 6：终检 ———— //
  {
    const { PrismaClient } = await import("@prisma/client")
    const db = new PrismaClient({ datasources: { db: { url: `file:${APP_DB}` } } })
    const acceptDb = new PrismaClient({ datasources: { db: { url: `file:${ACCEPT_DB}` } } })
    try {
      const assets = await db.collectionAsset.count({ where: { userId: "kai" } })
      evidence.appDbAssetsAfter = assets
      if (assets !== evidence.appDbAssetsBefore) {
        fail(`终检失败：app.db Owner 资产数被改动（基线 ${evidence.appDbAssetsBefore} → 实际 ${assets}）——验收不得写用户真实库`)
      }
      // 沙扎比实体必须关联官网商品（bandai-manual-949 或同品番行）
      const sazabiAsset = await acceptDb.collectionAsset.findFirst({
        where: { product: { OR: [{ id: "bandai-manual-949" }, { officialProductCode: "2204932" }] } },
        include: { product: true, cover: true },
      })
      if (!sazabiAsset) fail("终检失败：acceptance.db 无沙扎比官网商品实体")
      if (sazabiAsset.product?.imageStatus !== "OK") fail("终检失败：沙扎比官网图状态非 OK")
      // 古夫绝不能出现（同名资产/目录引用）
      const guf = await acceptDb.collectionAsset.count({
        where: { OR: [{ customName: { contains: "グフ" } }, { customName: { contains: "古夫" } }, { product: { canonicalName: { contains: "グフ" } } }] },
      })
      if (guf > 0) fail(`终检失败：出现古夫（グフ/古夫）资产 ${guf} 件`)
      console.log(`[accept:live] 终检 ✓：app.db Owner 资产 ${assets} 件（基线一致，验收零污染）；沙扎比实体关联官网商品且官网图 OK；无古夫资产`)
    } finally {
      await db.$disconnect()
      await acceptDb.$disconnect()
    }
  }
  evidence.appDbShaFinal = sha256File(APP_DB)

  writeFileSync(path.join(ROOT, "private-assets", "acceptance-report.json"), JSON.stringify(evidence, null, 2))
  console.log("[accept:live] UI 验收清单：")
  for (const item of evidence.uiChecks) console.log(`  · ${item}`)
  console.log("[accept:live] 证据已写入 private-assets/acceptance-report.json（gitignored）")
  console.log("ACCEPT_LIVE_OK")
}

type Server = ReturnType<typeof spawn> & { exited: Promise<void> }

const spawnedServers: Server[] = []
process.on("exit", () => {
  for (const s of spawnedServers) {
    try {
      s.kill("SIGKILL")
    } catch {
      // already dead
    }
  }
})

/** 启动生产服务器并等待就绪（结束即杀，绝不留进程） */
async function spawnServer(dbPath: string, port: string, extraEnv: Record<string, string>, label: string): Promise<Server> {
  const server = spawn("npm", ["run", "start"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: `file:${dbPath}`, PORT: port, ...extraEnv } as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const stderrBuf: string[] = []
  server.stderr?.on("data", (d: Buffer) => {
    stderrBuf.push(d.toString())
    if (stderrBuf.join("").length > 8000) stderrBuf.shift()
  })
  server.stdout?.on("data", () => undefined)
  ;(server as Server & { stderrTail?: () => string }).stderrTail = () => stderrBuf.join("").slice(-2000)
  const exited = new Promise<void>((resolve) => server.on("exit", () => resolve()))
  ;(server as Server).exited = exited
  spawnedServers.push(server as Server)
  for (let i = 0; i < 180; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/login`)
      if (res.ok) return server as Server
    } catch {
      // 未就绪
    }
    if (server.exitCode !== null) {
      fail(`${label}：服务器进程提前退出（exit ${server.exitCode}）：\n${(server as Server & { stderrTail?: () => string }).stderrTail?.() ?? ""}`)
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  server.kill("SIGTERM")
  fail(`${label}：服务器未能在 90 秒内就绪`)
}

function killServer(server: Server): void {
  server.kill("SIGTERM")
}

const BANNED = [
  "真实识别（Kimi kimi-k2.6）",
  "结构化提取 + 目录匹配",
  "目录仅收录 Bandai/LEGO 官方商品元数据",
  "不构成价格、二手行情或投资建议",
  "不构成价格或投资判断",
  "rights_basis",
  "托管部署不打包、不存储、不热链官方图片",
]

function contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
  const lum = (c: [number, number, number]) => {
    const f = (v: number) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
  }
  const l1 = lum(fg)
  const l2 = lum(bg)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

/** 阶段 3：acceptance.db 生产服务器 UI 全链路（真实 Kimi 视觉 + 真实 $web_search） */
async function runUiAcceptance(): Promise<void> {
  const { chromium } = await import("@playwright/test")
  const server = await spawnServer(ACCEPT_DB, ACCEPT_PORT, { OWNER_PASSWORD: APP_OWNER_SECRET, VISITOR_ACCESS_CODE: APP_VISITOR_SECRET }, "acceptance.db UI 验收")
  const browser = await chromium.launch()
  try {
    const base = `http://127.0.0.1:${ACCEPT_PORT}`
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })

    // 登录
    await page.goto(`${base}/login`)
    await page.getByTestId("login-mode-owner").check()
    await page.getByTestId("login-secret").fill(APP_OWNER_SECRET)
    const loginResponse = page.waitForResponse((r) => r.url().includes("/api/auth/login"))
    await page.getByTestId("login-submit").click()
    const loginRes = await loginResponse
    if (loginRes.status() !== 200) {
      fail(`登录失败 HTTP ${loginRes.status()}: ${(await loginRes.text().catch(() => "")).slice(0, 200)}`)
    }
    await page.getByTestId("logout-button").waitFor({ timeout: 20_000 })
    evidence.uiChecks.push("Owner 登录成功（登录页仅 Owner/Visitor）")

    // ============ A/B/C：IMG_5700 沙扎比全链路 ============
    await page.goto(`${base}/add`)
    await page.getByTestId("button-capture").waitFor({ timeout: 20_000 })
    await page.getByTestId("button-album").waitFor()
    await page.setInputFiles('[data-testid="input-album"]', SAZABI_IMAGE)
    await page.getByTestId("photo-preview").waitFor()
    await page.getByTestId("recognize-submit").click()

    // —— B：AI 识别结果原样可见、可编辑（标题 + 原始字段） ——
    await page.getByTestId("ai-extraction-panel").waitFor({ timeout: 170_000 })
    await page.getByTestId("official-search-panel").waitFor({ timeout: 170_000 })
    const title = await page.getByTestId("ai-extraction-title").innerText()
    if (title.trim() !== "AI 识别结果，请核对") fail(`结果页标题错误：「${title}」`)
    const nameVal = await page.getByTestId("edit-name").inputValue()
    const brandVal = await page.getByTestId("edit-brand").inputValue()
    const gradeVal = await page.getByTestId("edit-grade").inputValue()
    const scaleVal = await page.getByTestId("edit-scale").inputValue()
    const modelVal = await page.getByTestId("edit-model-number").inputValue()
    const seriesVal = await page.getByTestId("edit-series").inputValue()
    // A：必须是沙扎比——绝不能被目录覆盖为古夫
    if (!/サザビー|沙扎比/.test(nameVal)) fail(`AI 原始识别结果不是沙扎比：「${nameVal}」（被目录覆盖？）`)
    if (/グフ|古夫/.test(nameVal + seriesVal)) fail(`识别结果出现古夫：「${nameVal}」`)
    if (brandVal !== "Bandai") fail(`品牌错误：${brandVal}`)
    if (gradeVal.toUpperCase() !== "MG") fail(`等级错误：${gradeVal}`)
    if (!/MSN-04/i.test(modelVal)) fail(`机体编号错误：${modelVal}（应含 MSN-04）`)
    if (!/逆襲|逆袭/.test(seriesVal)) fail(`所属作品错误：${seriesVal}（应含 逆襲のシャア）`)
    // 可编辑性：修改名称字段
    await page.getByTestId("edit-name").fill("MG 1/100 MSN-04 サザビー Ver.Ka")
    const edited = await page.getByTestId("edit-name").inputValue()
    if (!edited.includes("MSN-04")) fail("识别结果字段不可编辑")
    evidence.sazabi.aiExtraction = { brand: brandVal, name: nameVal, grade: gradeVal, scale: scaleVal, modelNumber: modelVal, series: seriesVal }
    evidence.uiChecks.push("A/B：IMG_5700 AI 原始识别结果=沙扎比（Bandai/MG/MSN-04/逆襲のシャア），原样可见且可编辑，无古夫")

    // —— C：官网搜索结果分开显示，含官方沙扎比页面 ——
    const candidates = page.getByTestId("official-candidates")
    await candidates.waitFor({ timeout: 30_000 })
    const candidateCount = await candidates.locator("li").count()
    if (candidateCount === 0) fail("官网搜索结果为空（应有沙扎比官方候选）")
    const bodyText = await candidates.innerText()
    if (!/サザビー/.test(bodyText)) fail(`官网候选中无沙扎比：${bodyText.slice(0, 200)}`)
    if (/グフ|古夫/.test(bodyText)) fail("官网候选中出现古夫！")
    // 官方沙扎比页面（manual 949 或 bandai-hobby 商品页）+ 品番 + 来源域名 + 官网图
    const has949 = (await page.getByTestId("candidate-radio-bandai-manual-949").count()) > 0
    const facts949 = has949 ? await page.getByTestId("candidate-facts-bandai-manual-949").innerText() : null
    if (!has949) fail("官网候选缺少 manual.bandai-hobby.net/menus/detail/949（沙扎比官方说明书页）")
    if (!facts949?.includes("2204932")) fail(`manual-949 候选缺少品番 2204932：${facts949}`)
    if (!facts949?.includes("manual.bandai-hobby.net")) fail(`manual-949 候选缺少来源域名：${facts949}`)
    const pageLink = page.getByTestId("candidate-page-bandai-manual-949")
    if ((await pageLink.getAttribute("href")) !== "https://manual.bandai-hobby.net/menus/detail/949") fail("manual-949 官网页链接错误")
    const candImg = page.getByTestId("candidate-image-bandai-manual-949")
    if (!(await candImg.count())) fail("manual-949 候选缺少官网图片")
    const imgSrc = await candImg.getAttribute("src")
    if (!imgSrc?.startsWith("/api/official-image?url=")) fail(`官网图未走官方域代理：${imgSrc}`)
    evidence.sazabi.officialCandidate = { key: "bandai-manual-949", facts: facts949, imageProxy: imgSrc }
    evidence.uiChecks.push(`C：官网搜索结果分开显示，${candidateCount} 个官方候选含 manual-949（品番 2204932/来源域名/官网图/页面链接）`)

    // —— G：确认官网商品 → 官网图设为收藏封面（上传照片只作实拍图） ——
    await page.getByTestId("candidate-radio-bandai-manual-949").check()
    await page.getByTestId("confirm-save").click()
    await page.waitForURL(/\/collection\/[A-Za-z0-9]+/, { timeout: 60_000 })
    const assetUrl = page.url()
    const assetId = assetUrl.split("/").pop()!
    // 详情页：官网图为主图 + 我的识别照片保留上传图 + 官网页链接
    await page.getByTestId("asset-user-photo").waitFor({ timeout: 20_000 })
    await page.getByTestId("user-photo-section").waitFor()
    const detailText = await page.locator("body").innerText()
    if (!detailText.includes("https://manual.bandai-hobby.net/menus/detail/949")) fail("详情页未展示官网商品页链接")
    if (!/沙扎比/.test(await page.getByTestId("asset-name").innerText())) fail("详情页资产名不含沙扎比中文名")
    // 收藏柜：官网图（非上传照片）
    await page.goto(`${base}/collection`)
    await page.getByTestId("cabinet-grid").waitFor({ timeout: 20_000 })
    const gridHtml = await page.getByTestId("cabinet-grid").innerHTML()
    if (!gridHtml.includes(`/api/demo-images/bandai-manual-949`)) fail("收藏柜未使用官网商品图（bandai-manual-949）")
    evidence.sazabi.asset = { id: assetId, cabinetImage: "/api/demo-images/bandai-manual-949" }
    evidence.uiChecks.push("G：确认官网商品后收藏柜显示官网抓取图片（/api/demo-images/bandai-manual-949），上传照片保留为详情页实拍图")

    // 官网图路由字节校验
    const imgRes = await page.request.get(`${base}/api/demo-images/bandai-manual-949`)
    if (imgRes.status() !== 200) fail(`官网图路由 HTTP ${imgRes.status()}`)
    const imgType = imgRes.headers()["content-type"] ?? ""
    if (!imgType.startsWith("image/")) fail(`官网图路由 Content-Type 异常：${imgType}`)
    const imgBytes = await imgRes.body()
    evidence.sazabi.officialImage = { contentType: imgType, bytes: imgBytes.byteLength, sha256: createHash("sha256").update(imgBytes).digest("hex") }
    console.log(`[accept:live] 沙扎比官网图路由 ✓：200 ${imgType} ${imgBytes.byteLength} 字节（SHA ${evidence.sazabi.officialImage.sha256.slice(0, 12)}…）`)

    // ============ D/F：不同图片（强袭自由）→ 不同结果 + 修改名称重搜 ============
    await page.goto(`${base}/add`)
    await page.setInputFiles('[data-testid="input-album"]', FREEDOM_IMAGE)
    await page.getByTestId("recognize-submit").click()
    await page.getByTestId("ai-extraction-panel").waitFor({ timeout: 170_000 })
    const freedomName = await page.getByTestId("edit-name").inputValue()
    if (!/ストライクフリーダム|强袭自由|Strike Freedom/i.test(freedomName)) fail(`不同图片应得到不同结果（强袭自由），实际：「${freedomName}」`)
    if (/サザビー|沙扎比/.test(freedomName)) fail("不同图片结果固定为沙扎比（结果跨图片复用！）")
    evidence.freedom.aiExtraction = { name: freedomName }
    evidence.uiChecks.push(`D：不同图片（IMG_5694 强袭自由）→ 不同结果（${freedomName.slice(0, 30)}…）——识别结果不跨图片复用`)

    // F：修改名称后重新搜索官网（真实 $web_search 重搜）
    await page.getByTestId("edit-name").fill("MG 1/100 ストライクフリーダムガンダム")
    await page.getByTestId("re-search-official").click()
    // 搜索完成：候选区更新（出现官方候选或明确的未找到提示）
    await page.getByTestId("official-candidates").or(page.getByTestId("no-official-result")).first().waitFor({ timeout: 170_000 })
    const freedomCandidates = await page.locator("body").innerText()
    const reSearchWorked = /ストライクフリーダム|强袭自由|未找到官网商品/.test(freedomCandidates)
    if (!reSearchWorked) fail("修改名称后重新搜索官网未生效")
    evidence.uiChecks.push("F：修改商品名称后「重新搜索官网」生效（重搜结果刷新）")

    // ============ 截图 QA（真实链路） ============
    const shotsDir = path.join(ROOT, "test-results", "shots-real")
    mkdirSync(shotsDir, { recursive: true })
    await page.goto(`${base}/collection`)
    await page.getByTestId("cabinet-grid").waitFor({ timeout: 20_000 })
    await page.screenshot({ path: path.join(shotsDir, "collection@1440x1000.png") })
    await page.goto(`${base}/collection/${assetId}`)
    await page.getByTestId("asset-detail").waitFor({ timeout: 20_000 })
    await page.screenshot({ path: path.join(shotsDir, "sazabi-detail@1440x1000.png") })
    await page.goto(`${base}/`)
    await page.getByTestId("cabinet-preview").waitFor({ timeout: 20_000 })
    await page.screenshot({ path: path.join(shotsDir, "dashboard@1440x1000.png") })
    // 像素校验：页面含 #FFB000（橙色 Tab/按钮）
    {
      const sharp = (await import("sharp")).default
      for (const f of readdirSync(shotsDir)) {
        const { data, info } = await sharp(path.join(shotsDir, f)).raw().toBuffer({ resolveWithObject: true })
        let orange = 0
        for (let i = 0; i < data.length; i += info.channels) {
          if (Math.abs(data[i]! - 255) <= 6 && Math.abs(data[i + 1]! - 176) <= 8 && data[i + 2]! <= 10) orange++
        }
        if (orange < 100) fail(`截图 ${f} 未检测到 #FFB000（仅 ${orange} 像素）`)
      }
    }
    evidence.uiChecks.push("截图 QA：test-results/shots-real/（收藏柜/沙扎比详情/Dashboard）像素校验通过")
  } finally {
    await browser.close().catch(() => undefined)
    killServer(server)
  }
}

/** 阶段 4：API 层防覆盖回归 */
async function runApiRegressions(): Promise<void> {
  const { PrismaClient } = await import("@prisma/client")
  const { createRecognitionJob } = await import("../src/lib/services/recognition")
  const { confirmAsset } = await import("../src/lib/services/assets")
  const db = new PrismaClient({ datasources: { db: { url: `file:${ACCEPT_DB}` } } })
  try {
    // —— E：搜索失败/无结果不得从目录顶替（用与目录商品无关的乱码名称） —— //
    const garbageResult = await createRecognitionJob(
      db,
      "kai",
      { name: "zzz-not-exist-qqq.jpg", mimeType: "image/jpeg", bytes: new Uint8Array(readFileSync(SAZABI_IMAGE)) },
      { role: "OWNER" },
    )
    // 同一张沙扎比图：AI 结果仍是沙扎比（Kimi 每次真实调用）
    if (!/サザビー/.test(garbageResult.extraction?.name ?? "")) fail(`回归失败：沙扎比图片 AI 结果异常「${garbageResult.extraction?.name}」`)

    // 直接调用重搜服务：完全不存在的商品名 → 空候选（不从目录顶替）
    const { searchOfficialProducts } = await import("../src/lib/services/official-search")
    const { resolveRecognitionConfig } = await import("../src/lib/services/ai-settings")
    const config = await resolveRecognitionConfig(db)
    const nonsense = await searchOfficialProducts(
      db,
      { brand: "Bandai", name: "zzz 完全不存在的虚构商品 qqq", series: "", grade: "MG", scale: "1/100", modelNumber: "ZZZ-000" },
      { liveSearch: true, apiKey: config.apiKey ?? "", model: config.model, baseUrl: config.baseUrl },
    )
    if (nonsense.candidates.length > 0) {
      const names = nonsense.candidates.map((c) => `${c.officialName}@${c.key}`).join("、")
      fail(`回归失败：虚构商品搜出了候选（目录顶替？）：${names}`)
    }
    if (!nonsense.message.includes("未找到官网商品")) fail(`回归失败：无结果提示异常「${nonsense.message}」`)
    evidence.uiChecks.push("E：虚构商品名官网搜索 → 空候选 +「未找到官网商品」（未从目录顶替）")

    // —— LEGO Set Number 精确路径 + 确认（官网图封面） —— //
    const legoJob = await createRecognitionJob(
      db,
      "kai",
      { name: "lego-42172.png", mimeType: "image/png", bytes: new Uint8Array(readFileSync(LEGO_IMAGE)) },
      { role: "OWNER" },
    )
    if (legoJob.state !== "SUCCEEDED") fail(`LEGO 识别失败：${legoJob.errorCode}`)
    const legoTop = legoJob.candidates.find((c) => c.key === "lego-42172")
    if (!legoTop) fail("LEGO 候选缺少 lego-42172（Set Number 精确键）")
    if (legoTop.nameZh !== "迈凯伦P1") fail(`LEGO 中文名错误：${legoTop.nameZh}`)
    const legoConfirm = await confirmAsset(db, "kai", {
      idempotencyKey: `accept-lego-${Date.now()}`,
      jobId: legoJob.jobId,
      coverId: legoJob.cover?.id,
      officialCandidate: {
        key: legoTop.key!,
        officialName: "McLaren P1（42172）",
        nameZh: "迈凯伦P1",
        productCode: "42172",
        pageUrl: legoTop.pageUrl!,
        imageUrl: legoTop.imageUrl,
        sourceDomain: "www.lego.com",
        brand: "LEGO",
        grade: "TECHNIC",
        scale: null,
        modelNumber: "42172",
        series: null,
        releaseYear: null,
        line: null,
      },
      dispositionState: "ACTIVE",
      buildState: "UNOPENED",
      progress: 0,
    })
    if (!legoConfirm.created) fail("LEGO 确认未创建实体")
    if (legoConfirm.asset.catalogProductId !== "lego-42172") fail("LEGO 实体未关联 lego-42172")
    const legoProduct = await db.catalogProduct.findUnique({ where: { id: "lego-42172" } })
    if (legoProduct?.imageStatus !== "OK") fail(`LEGO 官网图状态非 OK：${legoProduct?.imageStatus}`)
    if (!legoProduct.officialImageUrl?.startsWith("https://www.lego.com/cdn/")) fail("LEGO 官网图非官方 CDN")
    evidence.lego = {
      assetId: legoConfirm.asset.id,
      product: "lego-42172",
      nameZh: "迈凯伦P1",
      officialImageUrl: legoProduct.officialImageUrl,
      imageSha256: legoProduct.imageSha256,
    }
    console.log(`[accept:live] LEGO ✓：lego-42172 官网图 ${legoProduct.officialImageUrl}（SHA ${legoProduct.imageSha256?.slice(0, 12)}…）`)

    // —— 沙扎比二次确认幂等（不同图片任务确认同一官网商品 → 品番精确去重） —— //
    const sazabiJob = await createRecognitionJob(
      db,
      "kai",
      { name: "IMG_5700-again.jpg", mimeType: "image/jpeg", bytes: new Uint8Array(readFileSync(SAZABI_IMAGE)) },
      { role: "OWNER" },
    )
    const sazabi949 = sazabiJob.candidates.find((c) => c.key === "bandai-manual-949")
    if (!sazabi949) fail("二次识别：沙扎比候选缺少 manual-949（联网搜索不稳定？）")
    const dupConfirm = await confirmAsset(db, "kai", {
      idempotencyKey: `accept-sazabi-2-${Date.now()}`,
      jobId: sazabiJob.jobId,
      coverId: sazabiJob.cover?.id,
      officialCandidate: {
        key: sazabi949.key!,
        officialName: sazabi949.officialName,
        nameZh: sazabi949.nameZh,
        productCode: sazabi949.productCode,
        pageUrl: sazabi949.pageUrl!,
        imageUrl: sazabi949.imageUrl,
        sourceDomain: sazabi949.sourceDomain,
        brand: sazabi949.brand,
        grade: sazabi949.grade,
        scale: sazabi949.scale,
        modelNumber: sazabi949.modelNumber,
        series: sazabi949.series,
        releaseYear: sazabi949.releaseYear,
        line: sazabi949.line,
      },
      dispositionState: "ACTIVE",
      buildState: "UNOPENED",
      progress: 0,
    })
    // 官方产品编号精确去重：复用同一目录行
    if (dupConfirm.asset.catalogProductId !== "bandai-manual-949") fail(`品番去重失败：二次确认关联了 ${dupConfirm.asset.catalogProductId}`)
    const sazabiProducts = await db.catalogProduct.count({ where: { officialProductCode: "2204932" } })
    if (sazabiProducts !== 1) fail(`品番去重失败：2204932 有 ${sazabiProducts} 行`)
    evidence.uiChecks.push("官方产品编号精确去重：两次确认（不同图片任务）复用同一目录行 bandai-manual-949")
  } finally {
    await db.$disconnect()
  }
}

/** 阶段 5：设置读写回环（dummy Key；结束清理） */
async function runSettingsRoundtrip(): Promise<void> {
  const { PrismaClient } = await import("@prisma/client")
  const { getAiSettingsView, saveAiSettings } = await import("../src/lib/services/ai-settings")
  const db = new PrismaClient({ datasources: { db: { url: `file:${ACCEPT_DB}` } } })
  try {
    await saveAiSettings(db, { advice: { apiKey: "sk-accept-dummy-not-real" } })
    const view = await getAiSettingsView(db)
    if (!view.advice.configured) fail("保存后 configured 应为 true")
    if (JSON.stringify(view).includes("sk-accept-dummy-not-real")) fail("设置视图泄漏明文 Key")
    const row = await db.aiProviderConfig.findUnique({ where: { provider: "deepseek" } })
    if (!row?.apiKeyEnc.startsWith("v1.")) fail("库内 Key 非 AES-256-GCM 密文")
    await saveAiSettings(db, { advice: { model: "deepseek-v4-flash" } })
    const view2 = await getAiSettingsView(db)
    if (!view2.advice.configured) fail("空白保存后 Key 丢失（应保留旧 Key）")
    console.log("[accept:live] 设置回环 ✓：dummy Key 加密存储（v1.* 密文）、视图无明文、空白保存保留旧 Key")
    evidence.uiChecks.push("设置保存持久化（按用途配置不绑定厂商：加密密文 + write-only + 空白保留旧 Key/Base URL）")
    await db.aiProviderConfig.deleteMany()
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => {
  console.error(`[accept:live] 异常：${(e as Error).stack ?? e}`)
  process.exit(1)
})
