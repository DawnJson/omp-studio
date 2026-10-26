# 用量：订阅账号额度和每日消耗热力图（用量对话框）

只读。实现：`src/main/usage/usage-service.ts`、`src/main/ipc/usage-handlers.ts`（`getUsageQuota`、`getUsageHeatmap`）、渲染端只有一个入口：点输入框工具行的费用（或 `/usage`、命令面板"用量"）弹出的居中对话框 `features/composer/UsageDialog.tsx` + `usage-views.tsx` + `usage-store.ts`（模块里缓存上次结果，打开先显示再后台刷新；汇总条、额度、热力图在同一页，没有页签）。设置页原来的"用量"一节 2026-10-22 删掉（和对话框重复，仓库所有者定）。汇总（过去一年 / 最近 30 天 / 最忙的一天 / 活跃天数 / 最长连续 / 最紧的额度 / 未使用账号）是纯函数，在 `src/shared/ui/usage-summary.ts`，不需要新的 IPC：全部从 `QuotaSnapshot` 和 `UsageHeatmap` 推出来。界面描述见 `docs/design/spec.md` §4.14 的 UsageDialog。测试：`test/usage-service.test.ts`、`test/usage-summary.test.ts`、`test/e2e/settings-functional.e2e.ts`。实测 omp 18.12.1，2026-10-18。

## 数据来源（查过 omp 文档和源码）

| 要什么 | 来源 | 结论 |
|---|---|---|
| 订阅账号额度 | `omp usage --json`（`omp://cli-reference.md`、`providers.md`） | 返回 `{ generatedAt, reports: UsageReport[], accountsWithoutUsage, disabledCredentials, capacity }`。`UsageReport` 的类型在 omp 源码 `packages/ai/src/usage.ts`：`limits[]`（`label`、`window.{label,resetsAt}`、`amount.{used,limit,usedFraction,remainingFraction,unit}`、`status`）、`resetCredits`、`notes`、`metadata`。omp 自己去各 provider 查，带 5 分钟缓存。没有登录账号时 `reports` 为空（实测）。另有 `omp usage --history --days N --json`（每小时快照），目前没用。 |
| 每日消耗 | omp 的 `stats.db`（位置规则见下方"stats.db 在哪"） | 表 `message_rollup`：**小时桶**（UTC 对齐的毫秒时间戳 `bucket`）× 模型 × provider × 目录，列 `requests`、`total_tokens`、`cost_total`…。node:sqlite（Electron 44 自带的 Node，无新依赖）只读打开可用。 |
| 本会话用量 | RPC `get_session_stats` | 属于输入框下方的会话消耗，不在这里。 |

`omp stats --json` 只返回默认 24 小时的汇总（CLI 没有 range 参数），不够 365 天，所以热力图直接查库。

## 重要：`stats.db` 不会自己更新

实测：跑完一轮对话后 `stats.db` 的 `messages` 表还是 0 行；运行 `omp stats --json` 之后才变成 1 行（它先"Syncing session files…"，把会话 JSONL 读进库）。所以**刷新 = 让 omp 自己跑一次 `omp stats --json`**（读会话文件、跨进程加锁、写库都是 omp 的事，omp-studio 不碰），再用 node:sqlite 只读地查。`getUsageHeatmap(false)` 直接读现有库（马上有东西看），`true` 先同步再读；界面先 false 再 true。首次同步要读完全部历史会话，历史很多时可能要几分钟（超时 15 分钟，超时杀掉，下次接着同步）。库不存在（从没同步过）时 `hasDatabase: false`，界面说明还没有数据。

## 本地时区

小时桶按 UTC 对齐，按本地时区的日期合并成"天"；窗口是含今天的 365 天，每天的请求数、token、花费。界面：53 周 × 7 天的格子，5 档深浅（占该指标最大值的比例），可切 Token / 花费 / 请求数，悬停显示当天的值。

## 没做 / 没验证

- 额度条（有账号的情况）：2026-10-26 用仓库所有者本机的真实输出（omp 18.12.6）对过一次：google-antigravity、anthropic 的报告账号在 `metadata.email`，`amount` 是 `percent` 单位带 `usedFraction`；内置账号插件的 qoder-cn、workbuddy、trae-cn 也在 `reports` 里（经扩展的 `usage` 接进来，见 `client-accounts.md` 3.2"额度"），WorkBuddy、Trae 是 `credits` 单位的已用 / 总量。界面只显示剩余百分比和重置时间，不显示积分数。`resetCredits`、`planType` 以外的 openai-codex 字段仍没有账号实测。
- `--profile` 命令行参数没单独验证；环境变量 `OMP_PROFILE`/`PI_PROFILE` 已实测（见下）。XDG data root 初始化后的位置（`user-facing-packages.md` 提到会变）没验证，`statsDbPath` 不处理。
- **踩过的坑**：`PI_CODING_AGENT_DIR` 不会重定向 `stats.db`。早期只设它跑 `omp stats --json` 碰过真实 `~\.omp\stats.db`（同步 0 条）；只设它的隔离启动打开用量页也会读到真实数据。现在 `statsDbPath` 按下面的规则解析（含 profile）。要隔离用量数据，得把 `USERPROFILE`/`HOME` 指到临时目录（用量 e2e 就这样做）；但**不能**给所有 e2e 都这样做：Electron 的 `app.getPath("desktop")` 等已知文件夹在改过的 `USERPROFILE` 下会抛错（实测 2026-10-19，导出诊断信息因此失败）。以后任何涉及 stats 的 omp 命令/实验都要把 home 指到临时目录。

## stats.db 在哪（实测）

规则：`<home>/<PI_CONFIG_DIR 或 .omp>/stats.db`；命名 profile 则 `<home>/<配置根>/profiles/<名>/stats.db`。`home` 是 omp 进程的用户主目录（Windows 的 `USERPROFILE`、其他系统的 `HOME`）。`PI_CODING_AGENT_DIR` 不参与。`OMP_PROFILE` 优先于 `PI_PROFILE`（即使 `OMP_PROFILE` 为空串也压过它）；空串和 `default` 都是默认 profile。

> `PI_CONFIG_DIR` 为绝对路径时 omp 如何处理**未实测**：studio 按"绝对路径原样使用、相对路径挂在 home 下"取（`statsDbPath`），实测证据里只有相对值（`.cfgx`）。

证据：Tern 的 omp 跑 `omp stats --json`，`USERPROFILE`/`HOME` 指到临时目录、`PI_CODING_AGENT_DIR` 指到另一个临时目录，然后在临时目录里找 `stats.db`：

| 环境 | 出现的位置（相对临时 home） |
|---|---|
| 只有 `PI_CODING_AGENT_DIR` | `.omp\stats.db` |
| + `PI_CONFIG_DIR=.cfgx` | `.cfgx\stats.db` |
| + `OMP_PROFILE=foo` | `.omp\profiles\foo\stats.db` |
| + `OMP_PROFILE=default` | `.omp\stats.db` |
| + `PI_PROFILE=bar` | `.omp\profiles\bar\stats.db` |
| + `OMP_PROFILE=`（空）与 `PI_PROFILE=bar` | `.omp\stats.db` |

omp-studio 启动 omp 子进程用的是 `{...process.env, 额外的 API key}`（`runOmpCommand`），所以 `statsDbPath(process.env, os.homedir())` 和子进程看到的 home/配置根/profile 一致，同步写的库和读的库是同一个。

## 2026-10-23 补充（omp 18.12.6）

- **额度字段**：`parseQuota` 补了 `planType`（`metadata.planType`，源码里只有 openai-codex 带）、`daybreak`（`metadata.daybreak`）、`resetCredits`（照 omp `usage-display.ts` 的 `nM` 归一：攒的次数、可用次数、最近到期、不可用原因）、`accountsWithoutUsage`（omp 面板的 "usage unavailable" 行）、各账号 `fetchedAt` 的最大值（"N 分钟前取得"）。**按 omp 源码类型写，没有订阅账号实测** [推测]。
- **刷新绕过缓存**：omp 把用量报告缓存在 agent.db（约 5 分钟，`UsageCache`）。对话框的 ↻ 先跑 `omp usage invalidate` 再 `omp usage --json`（`usage-cli.ts` 的 invalidate 分支，清全部 provider）；打开对话框只读缓存。invalidate 失败直接报错。
- **表结构自检**：`usage/stats-schema.ts` 列出 studio 读的表和列（对照 18.12.6 真实库核过）；`readHeatmap`、请求记录读之前先检查，缺表缺列抛 `StatsSchemaError`（文字以 `omp stats.db schema mismatch` 开头，界面显示"统计库结构对不上"）。

