# ARCHIVE

ARCHIVE 是一个面向 LEGO、Bandai 高达及其他模型收藏玩家的 AI 个人收藏工作台。它以收藏柜为入口，把商品识别、官网资料、购买记录、制作状态、藏品照片、收藏地图与主动建议放在同一个长期数据库中。

这个项目不是只有静态演示数据的页面：在本地配置 API 后，可以直接拍照或上传图片进行真实识别，核对官方商品结果，抓取官网展示图并入柜；之后再依据自己的收藏结构生成收藏建议。

## 产品解决什么问题

传统收藏工具通常只能记录“买了什么”。ARCHIVE 进一步维护三层信息：

- **事实层**：商品官方名称、品牌、系列、等级、比例、型号、官网页与官网展示图。
- **资产层**：购入时间、购入价格、开盒/制作状态、进度、识别原图与用户追加的藏品照片。
- **Agent 层**：依据现有收藏生成收藏地图，收集 LEGO / Bandai 新品信息，并输出有来源、可反馈的收藏建议。

主要页面：

- **收藏总览**：数量、品牌占比、收藏金额、完成度，以及 LEGO / Bandai 各自按购买时间排序的最新 5 件藏品。
- **收藏柜**：LEGO 在前、Bandai 在后；桌面端采用 4–5 列大图柜格，图片完整显示。
- **入柜**：拍照或选择图片，经 AI 提取商品事实，再由用户核对、修改、选择官网结果后入库；也支持完全手动录入。
- **藏品详情**：维护资产状态与购入信息；“藏品照片”同时保留识别原图并允许追加个人照片。
- **收藏建议**：展示基于个人藏品形成的收藏地图，以及来自 LEGO / Bandai 官方新品源的信息与 AI 建议。
- **设置**：Owner 可配置识别模型、建议模型、API 地址与 Key；Key 只写入、不回显。

## 技术栈

- Next.js 16（App Router）+ React 19 + TypeScript
- Prisma 6 + SQLite（本地默认）/ libSQL（可选托管模式）
- Kimi K2.6：图片理解与商品信息提取
- DeepSeek V4 Flash：收藏建议生成
- Sharp：上传图片校验、方向修正与图片处理
- Vitest + Playwright：单元、契约与端到端测试

## Owner 与 Visitor

| 模式 | 用途 | 数据 | 权限 |
| --- | --- | --- | --- |
| Owner | 本人长期使用 | 私有真实收藏 | 完整功能，含设置 |
| Visitor | 面试体验 | 独立沙箱和 10 件脱敏样例 | 可浏览、入柜和生成建议；不能访问 Owner 设置或数据 |

首次初始化会自动给 Visitor 创建 10 件样例，取自当前收藏的脱敏快照：

- LEGO：Daily Bugle、Project Hail Mary、Dune Atreides Royal Ornithopter、Bugatti Centodieci Hyper Sports Car、The Squawk Radio Station。
- Bandai：MGEX Strike Freedom、MG Sazabi Ver.Ka、PG Unleashed RX-78-2、RG Hi-ν、MG Gundam Virtue。

样例只包含官方商品元数据、收藏状态、购买时间和价格。以下内容不会复制给 Visitor，也不会提交到 Git：

- Owner 的识别原图和个人藏品照片
- 备注、偏好、识别任务与会话
- API 配置、加密主密钥和用量历史
- Owner 的完整收藏数据库

Visitor 每日最多进行 3 次图片识别和 1 次收藏建议生成，以避免面试体验意外消耗过多 API 额度。Visitor 的新增、修改与反馈也和 Owner 数据隔离。

## 本地快速开始

### 1. 环境要求

- Node.js `20.9.0` 或更高版本
- npm 10 或更高版本
- macOS、Linux 或 Windows

如需运行浏览器端测试，还要安装 Playwright Chromium：

```bash
npx playwright install chromium
```

### 2. 克隆与安装

```bash
git clone <repository-url> ARCHIVE
cd ARCHIVE
npm ci
```

### 3. 创建本地配置

macOS / Linux：

```bash
cp .env.example .env.local
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env.local
```

不配置 API 也能启动、浏览 Visitor 样例并手动入柜；真实图片识别和 AI 收藏建议需要完成下方“配置 AI”步骤。

### 4. 初始化数据库和 Visitor 样例

```bash
npm run db:init
```

该命令会：

1. 生成 Prisma Client；
2. 对本地 `prisma/app.db` 执行已有迁移；
3. 幂等创建 Owner、Visitor 和收藏路线基础数据；
4. 幂等创建 Visitor 的 5 件 LEGO + 5 件 Bandai 样例。

`db:init` 是非破坏命令，重复执行不会删除或覆盖已有藏品。

### 5. 下载 Visitor 官网展示图（推荐）

```bash
npm run visitor:images
```

商品图片会从 LEGO / Bandai 官方域名下载、校验后保存在 `private-assets/product-images/`。该目录已被 Git 忽略，只用于当前电脑，不会随仓库分发。

如果官网临时限流或网络不可用，命令会列出失败商品；应用仍可使用安全占位图，联网后重试即可。只想补回缺失的 10 件样例时可单独执行：

```bash
npm run visitor:seed
```

### 6. 启动

```bash
npm run dev
```

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)。

本地默认登录凭据：

- Owner：`archive-owner`
- Visitor：`interview`

这些默认值只为本机首次体验准备。长期使用前，请在 `.env.local` 设置自己的 `OWNER_PASSWORD` 和 `VISITOR_ACCESS_CODE`，然后重启服务。

## 配置 AI

推荐直接编辑 `.env.local`：

```dotenv
# 图片识别：Kimi K2.6
MOONSHOT_API_KEY="<your-moonshot-key>"
KIMI_MODEL="kimi-k2.6"
KIMI_BASE_URL="https://api.moonshot.cn/v1"

# 收藏建议：DeepSeek V4 Flash
DEEPSEEK_API_KEY="<your-deepseek-key>"
DEEPSEEK_MODEL="deepseek-v4-flash"
DEEPSEEK_BASE_URL="https://api.deepseek.com"
```

保存后重启 `npm run dev`。环境变量对 Owner 和 Visitor 的 AI 调用都生效，但双方收藏数据仍完全隔离。

Owner 也可在右上角“设置”中填写模型名、OpenAI 兼容 API 地址和 Key。界面保存的配置优先于环境变量；API Key 使用 AES-256-GCM 加密后写入本地数据库，主密钥保存在 Git 忽略的 `private-assets/secrets/master.key`，读取接口永不回显 Key。Visitor 无权访问设置页，防止访客覆盖 Owner 的配置。

> 上传识别时，处理后的图片会发送给所配置的视觉模型服务；生成收藏建议时，结构化收藏摘要会发送给建议模型。请只配置你信任的服务，并遵守相应服务条款。

## 从拍照到入柜

1. 进入“入柜”，选择“拍照识别”或“从相册选择”。手机浏览器支持时，“拍照识别”会请求后置摄像头。
2. Kimi 提取品牌、完整商品名、系列/主题、等级、比例和型号；识别结果先显示给用户，不会未经确认自动入库。
3. 系统优先按编号和名称搜索官方商品页；搜索结果会显示官网名称、来源与展示图。
4. 核对候选；结果不正确时可修改字段并重新搜索，也可直接手动录入。
5. 确认购入时间、价格和制作状态后入柜。官网展示图会作为商品图，原始识别照片会保留在该藏品的“藏品照片”中。

LEGO 商品资料优先使用 `lego.com/en-us`；Bandai 商品资料只接受 Bandai Hobby、说明书站、P-Bandai 及已列入白名单的官方 CDN。第三方商城或图床不会冒充官网来源。

## 收藏建议如何工作

收藏建议不是对固定文案做润色。生成过程会组合：

1. 当前用户自己的品牌、主题、等级和作品分布；
2. 基于实际藏品动态形成的“收藏地图”；
3. LEGO New Sets and Products 与 Bandai Hobby 新品来源；
4. 已拥有商品、购买时间、制作状态与用户反馈；
5. DeepSeek 对结构化事实和来源信息生成的建议。

新品动态直接展示近期官方模型信息，不使用虚假的匹配分。建议会保留来源链接与日期，方便用户自行判断。

## 数据与文件位置

| 路径 | 内容 | 是否提交 Git |
| --- | --- | --- |
| `prisma/app.db` | 本机 Owner / Visitor 数据与设置密文 | 否 |
| `private-assets/product-images/` | 官网商品图缓存 | 否 |
| `private-assets/user-covers/` | 识别图 | 否 |
| `private-assets/asset-photos/` | 用户追加的藏品照片 | 否 |
| `private-assets/secrets/` | API 配置加密主密钥 | 否 |
| `.env.local` | API Key 与本地凭据 | 否 |
| `.env.example` | 无密钥的配置模板 | 是 |
| `src/lib/visitor-dataset.ts` | 10 件脱敏 Visitor 样例的公开商品事实 | 是 |

仓库不包含 Owner 数据库、真实照片、官网图片二进制或任何 API Key。官网图片 URL 和商品页 URL 属于可审计的商品来源元数据。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动本地开发服务器 |
| `npm run build` | 创建生产构建 |
| `npm run start` | 启动已构建的本地生产服务器 |
| `npm run db:init` | 非破坏迁移并补齐基础数据、Visitor 样例 |
| `npm run visitor:seed` | 幂等补齐 Visitor 的 10 件样例 |
| `npm run visitor:images` | 下载并校验 10 件样例的官网展示图 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint 检查 |
| `npm test -- --run` | 基础单元测试 |
| `npm run test:product` | 产品级单元与契约测试 |
| `npm run test:product:e2e` | 产品级 Playwright 端到端测试 |
| `npm run secret:scan` | 扫描所有 Git 可见文件和本地数据库中的密钥泄漏 |

`npm run db:reset` 只重建 E2E 使用的 `prisma/demo.db`，不用于日常 `app.db`。不要用它替代 `db:init`。

## 提交前验证

至少运行：

```bash
npm run lint
npm run typecheck
npm test -- --run
npm run test:product
npm run build
npm run secret:scan
```

完整产品验收可运行：

```bash
npm run verify:product
```

密钥扫描会同时检查已跟踪文件和未跟踪但未被 `.gitignore` 排除的文件；`.env.example` 是唯一允许提交的环境变量文件。

## 常见问题

### 入柜页没有 AI 拍照入口

生产模式没有有效识别 Key 时，页面只保留手动录入，避免把 Fixture 伪装成真实识别。检查 `MOONSHOT_API_KEY`，重启开发服务器后再打开入柜页。

### Visitor 有藏品但没有商品图

先运行 `npm run visitor:images`。官网偶尔会返回限流、跳转或临时失败，重试即可；下载器只把通过域名、响应类型、魔数、体积和尺寸校验的图片标记为成功。

### API 返回 401 或模型不存在

检查 Key、Base URL 和模型名是否属于同一个服务。ARCHIVE 使用 OpenAI 兼容接口，但不同供应商可用模型名并不相同。

### 相机按钮在手机上没有打开相机

确认浏览器已授予相机权限。`localhost` 通常可作为安全上下文；从另一台手机访问电脑局域网地址时，浏览器往往要求 HTTPS。仍可使用“从相册选择”完成相同识别流程。

### 3000 端口被占用

```bash
PORT=3001 npm run dev
```

然后访问 `http://127.0.0.1:3001`。

## 托管说明

本项目的完整体验优先面向本地运行。托管时需设置 `DATABASE_MODE=HOSTED`、`LIBSQL_URL`、`LIBSQL_AUTH_TOKEN`、强密码和固定 `SESSION_SECRET`；临时文件系统不会持久化官网图片或用户照片，因此还需要接入私有对象存储后才能获得与本地相同的图片体验。不要把 `.env.local`、数据库或 `private-assets/` 打包上传。

## 隐私与图片边界

ARCHIVE 是个人收藏工具。仓库只保存官方商品页面和图片 URL，不分发 LEGO / Bandai 图片文件；本地下载的官网图片仅保存在使用者自己的 Git 忽略目录中。使用者应自行遵守相关网站条款和图片权利要求。
