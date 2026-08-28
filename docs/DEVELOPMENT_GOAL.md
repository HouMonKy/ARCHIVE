你是执行者，这份任务书是唯一任务来源；中途没人可问，拿不准的写入 `BLOCKED.md`（待裁决清单），跳过后继续不受影响的部分，交付时一并提交。
断线或更换会话后先读 `PROGRESS.md` 接着做；每完成一项立即更新，禁止重做。
这活是从零做出 Model Base 可复现的 V1 Demo，让“AI 建档→收藏 Dashboard→主动周报→用户反馈”形成真实可操作闭环。
要求冲突时按“数据正确可追溯 > 核心闭环完整 > 可用性 > 视觉精致 > 功能数量”让步。
“只允许/不许”是硬边界；“建议”可换更优方案，但要在 `PROGRESS.md` 写明理由。

## 我替领导拍的板

- 交付形态 → 中文响应式 Web Demo（猜的）｜若实际要生产 Beta，账号、云存储和合规工作会缺失。
- 首发范围 → 只承诺高达模型，其他品类只手动录入（猜的）｜全品类会让目录与识别无法可靠验收。
- 用户 → 固定演示用户 Kai，不做真实登录（猜的）｜不适合开放给外部用户。
- 技术栈 → Next.js App Router + TypeScript strict + Tailwind + Prisma/SQLite + Vitest/RTL + Playwright（猜的）｜换栈会改变验收命令。
- AI → Provider 接口 + 明示“演示识别”的 Fixture；有密钥也不得把外部调用设为测试前提（猜的）｜Demo 能复现，但不代表真实准确率。
- 数据/图片 → 固定 12/8/4 数据与 Kai 偏好；按领导确认，Bandai 官网图仅本人本机私用，不商用、公开或传播｜用途扩大时必须换占位图或获许可。
- 估值 → 只展示累计购入成本，不做实时市场价、涨跌、稀有度（猜的）｜少一个营销点，避免误导。

## 界限

只允许新增或修改：`package.json`、`package-lock.json`、`.gitignore`、`.env.example`、`README.md`、`PROGRESS.md`、`BLOCKED.md`、`src/**`、`prisma/**`、`public/demo/**`、`tests/**`、`scripts/**`、`next-env.d.ts`、`next.config.*`、`tsconfig.json`、`postcss.config.*`、`tailwind.config.*`、`eslint.config.*`、`vitest.config.*`、`playwright.config.*`。`node_modules/**`、`.next/**`、`coverage/**`、`playwright-report/**`、`test-results/**`、`private-assets/product-images/**` 和本地数据库只可作为已 gitignore 的生成物。其余路径只读。
`docs/PRD.md` 是冻结规格，SHA-256 必须始终为 `8196d999d14f2869d4137ef484ef74b513c77510174d985ea660451769bf9ceb`；`docs/DEVELOPMENT_GOAL.md` 与 `docs/FROZEN.sha256` 也不许改，最终以 `shasum -a 256 -c docs/FROZEN.sha256` 判定。不得改 `.git/**`、删数据、改权限、部署、创建远端资源，或把官网图放进 Git、构建包和共享目录；需要时记入 `BLOCKED.md`。

## 现状与任务 0

2026-08-25 实测：`main` 为 0 提交 Greenfield；代码、依赖、测试和脚本均为 0；Node `v22.23.2`、npm `10.9.8`；预存未跟踪 `.DS_Store` 只读、不算交付。先运行并贴出：`git status --short --branch`、`git rev-list --count --all`、`find . -path './.git' -prune -o -type f -print | sort`、`test ! -e package.json`、`node --version`、`npm --version`、`shasum -a 256 docs/PRD.md`。事实不符就把证据写在 `BLOCKED.md` 最上面，只做不受影响部分；相符后把目标、顺序、最大风险用不超过 10 行写入 `PROGRESS.md`。

## 任务 1：建立可复现底座

按选定栈建数据模型、迁移、seed 和 Provider 边界。物理实体与意向分表；同 SKU 可多件；状态、Fixture 和聚合遵循 PRD 第 7、19 节。实现幂等的 `db:reset`；另以显式清单从 Bandai 官方页面一次性获取 12 张图，记录来源/日期/私人使用依据，提供 `images:fetch` 与 `images:check`，二进制仅进已忽略的本机缓存。缺 AI 密钥时显示 Fixture 标识。验收：`npm run db:reset` 连跑两次、`npm run images:check`、`npm run typecheck`、`npm run build` 均退出 0。

## 任务 2：打通收藏建档与 Dashboard

按依赖顺序完成 `/add`、`/collection`、`/collection/:id`、`/`：上传校验→最多 3 候选/低置信手填→用户确认→重复提示→保存→统计更新。未确认时数据库写入必须为 0；识别失败不得阻塞手动新增。Dashboard 展示并可下钻实体数、SKU 数、状态、品牌/等级、完成率、累计成本和缺价数；360px 与 1280px 无横向溢出。验收：`npm test -- --run` 退出 0，至少 20 个非跳过的单元/组件测试覆盖统计口径、状态约束、低置信、重复和幂等确认。

## 任务 3：实现主动周报闭环

完成 `/reports/latest` 与可重复运行的报告生成命令。少于 3 件确认收藏时只展示解锁说明；其余情况按 PRD 第 19 节固定公式和预期排序生成 0–3 条洞察，LLM/模板只组织文案。每条引用真实商品/实体、来源和日期；同一任务幂等；“不感兴趣”抑制 30 天；无可靠新品时输出“本周无建议”，不许编造。验收：`npm run report:generate` 连跑两次只产生一期，`npm test -- --run` 全绿。

## 任务 4：封口、反向验证与交付

补齐加载、空、错、超时、损坏/超限文件和键盘操作；README 写清 Fixture、图片私用边界与已知限制，开发/运行只绑定 `127.0.0.1`。提供 `verify:scope` 校验冻结文件与白名单；`verify` 依次执行 scope、images:check、lint、typecheck、测试、build、E2E。Playwright ≥5 个非跳过用例；D-01～D-10 自动化覆盖 10/10。反向验证：临时改错 Dashboard E2E 期望，运行 `npm run verify` 并贴非零退出且定位该用例的输出；还原后贴全绿；最终 `git diff --check` 退出 0。

## 规矩

不许 `skip/todo`、删测试、放宽断言、mock 被测业务逻辑、硬编码统计、改验收脚本、`|| true`、吞异常或让 Fixture 冒充线上 AI；均算失败。测试总数只许增加。仅 `images:fetch` 可联网访问清单中的 Bandai 官方 URL；测试不得联网或要密钥。除任务依赖外不新增服务、权限、CI、部署、爬虫或批量镜像；同一验收连败 3 次就换项，结果变差则回滚并记录。

## 完成条件

1. 可执行 `npm ci`、`npm run db:reset`、`npm run images:check`、`npm run verify` 且全为 0；12/12 官网图有来源记录并仅在本机缓存，≥20 个单元/组件测试、≥5 个 E2E、D-01～D-10 全通过。
2. PRD 与任务书通过 `shasum -a 256 -c docs/FROZEN.sha256`，该清单保持原样；越界文件 0、跳过测试 0、运行时必需的外部服务/密钥 0、未标识的假 AI 0。

每条完成条件都要在对话里贴实际命令输出，包含反向验证红→绿证据；只说“完成”不算。`BLOCKED.md` 随交付提交，空也写“无”。以上全部满足，或已跑满 3 轮完整验收即停止；满轮仍失败时如实交付卡点、证据和剩余工作。
