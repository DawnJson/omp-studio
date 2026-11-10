# 用量：订阅账号额度和每日消耗热力图（用量对话框）

只读。实现：`src/main/usage/usage-service.ts`、`src/main/ipc/usage-handlers.ts`（`getUsageQuota`、`getUsageHeatmap`）；渲染端是点输入框费用（或 `/usage`、命令面板"用量"）弹出的 `features/composer/UsageDialog.tsx` + `usage-views.tsx` + `usage-store.ts`（模块里缓存上次结果，打开先显示再后台刷新；汇总、额度、热力图同一页）。设置页不放用量（和对话框重复，所有者定，2026-10-22）。汇总是 `src/shared/ui/usage-summary.ts` 的纯函数，全部从 `QuotaSnapshot` 和 `UsageHeatmap` 推出，不需要新的 IPC。界面见 spec §4.14 的 UsageDialog。测试：`test/usage-service.test.ts`、`test/usage-summary.test.ts`、`test/e2e/settings-functional.e2e.ts`。

新任务页的"本周用量"卡片（`features/empty/UsageCard.tsx`，spec §4.7）用 `usage-store.ts` 的同一个缓存（没读过时挂载时调一次 `loadHeatmap`，先 `false` 再 `true`），在 `features/empty/usage-overview.ts` 里算（测试 `test/usage-overview.test.ts`）。

## 数据来源（omp 文档和源码，18.12.1 实测）

| 要什么 | 来源 | 结论 |
|---|---|---|
| 订阅账号额度 | `omp usage --json`（`omp://cli-reference.md`、`providers.md`） | 返回 `{ generatedAt, reports: UsageReport[], accountsWithoutUsage, disabledCredentials, capacity }`。`UsageReport` 类型在 omp 源码 `packages/ai/src/usage.ts`：`limits[]`（`label`、`window.{label,resetsAt}`、`amount.{used,limit,usedFraction,remainingFraction,unit}`、`status`）、`resetCredits`、`notes`、`metadata`。omp 自己去各 provider 查并缓存。没有登录账号时 `reports` 为空（实测）。`omp usage --history` 没用。 |
| 每日消耗 | omp 的 `stats.db`（见"stats.db 在哪"） | 表 `message_rollup`：**小时桶**（UTC 对齐的毫秒时间戳 `bucket`）× 模型 × provider × 目录，列 `requests`、`total_tokens`、`cost_total`…。用 node:sqlite 只读打开（无新依赖）。 |
| 本会话用量 | RPC `get_session_stats` | 属于输入框下方的会话消耗，不在这里。 |

`omp stats --json` 只返回默认 24 小时的汇总（CLI 没有 range 参数），不够一年，所以热力图直接查库。

## 重要：`stats.db` 不会自己更新

实测：跑完一轮对话后 `messages` 表还是 0 行，运行 `omp stats --json`（先"Syncing session files…"）之后才有。所以**刷新 = 让 omp 自己跑一次 `omp stats --json`**（读会话文件、加锁、写库都是 omp 的事，studio 不碰），再只读地查。

- 查询在 SQLite worker 线程里跑（`usage/db-worker.ts`，主进程一侧 `db-worker-client.ts`；请求记录、模型实测速度也在这里），打开库、等 WAL 写方都不占主进程。
- 库不存在时 `hasDatabase: false`，界面说明还没有数据。
- `getUsageHeatmap(false)` 直接读现有库（马上有东西看），结果短时缓存（`ipc/usage-handlers.ts` 的 `HEATMAP_TTL_MS`）；`true` 先同步再读，同步完（不论成败）作废缓存；界面先 false 再 true。
- 首次同步要读完全部历史会话，可能要几分钟（`SYNC_TIMEOUT_MS`，超时杀掉，下次接着同步）。

## 本地时区

小时桶按 UTC 对齐，按本地时区的日期合并成"天"；窗口是含今天的一年。

## 额度字段、刷新、表结构（omp 18.12.6）

- **额度字段**：`parseQuota` 读 `planType`（`metadata.planType`，源码里只有 openai-codex 带）、`daybreak`、`resetCredits`（照 omp `usage-display.ts` 归一）、`accountsWithoutUsage`（omp 面板的 "usage unavailable" 行）、各账号 `fetchedAt` 的最大值。**按 omp 源码类型写** [推测]。
- 所有者本机真实输出对过一次（omp 18.12.6，2026-10-26）：google-antigravity、anthropic 的账号在 `metadata.email`，`amount` 是 `percent` 单位带 `usedFraction`；账号插件的 qoder-cn、workbuddy、trae-cn 也在 `reports` 里（见 `client-accounts.md` 3.2"额度"），WorkBuddy、Trae 是 `credits` 单位。界面只显示剩余百分比和重置时间。`resetCredits`、`planType` 以外的 openai-codex 字段没有账号实测。
- **刷新绕过缓存**：omp 把用量报告缓存在 agent.db（`UsageCache`）。对话框的 ↻ 先跑 `omp usage invalidate`（清全部 provider）再 `omp usage --json`；打开对话框只读缓存。invalidate 失败直接报错。
- **表结构自检**：`usage/stats-schema.ts` 列出 studio 读的表和列（对照 18.12.6 真实库核过）；读之前先检查，缺表缺列抛 `StatsSchemaError`，界面显示"统计库结构对不上"。

## stats.db 在哪（实测）

规则：`<home>/<PI_CONFIG_DIR 或 .omp>/stats.db`；命名 profile 则 `<home>/<配置根>/profiles/<名>/stats.db`。`home` 是 omp 进程的用户主目录（Windows `USERPROFILE`、其他 `HOME`）。**`PI_CODING_AGENT_DIR` 不参与**。`OMP_PROFILE` 优先于 `PI_PROFILE`（空串也压过它）；空串和 `default` 都是默认 profile。

> `PI_CONFIG_DIR` 为绝对路径时 omp 如何处理**未实测**：`statsDbPath` 按"绝对路径原样、相对路径挂在 home 下"取。

证据：`USERPROFILE`/`HOME` 指到临时目录、`PI_CODING_AGENT_DIR` 指到另一个临时目录，跑 `omp stats --json`：

| 环境 | 出现的位置（相对临时 home） |
|---|---|
| 只有 `PI_CODING_AGENT_DIR` | `.omp\stats.db` |
| + `PI_CONFIG_DIR=.cfgx` | `.cfgx\stats.db` |
| + `OMP_PROFILE=foo` | `.omp\profiles\foo\stats.db` |
| + `OMP_PROFILE=default` | `.omp\stats.db` |
| + `PI_PROFILE=bar` | `.omp\profiles\bar\stats.db` |
| + `OMP_PROFILE=`（空）与 `PI_PROFILE=bar` | `.omp\stats.db` |

studio 启动 omp 子进程用 `{...process.env, 额外的 API key}`（`runOmpCommand`），所以 `statsDbPath(process.env, os.homedir())` 和子进程看到的一致，同步写的库就是读的库。

**坑**：只设 `PI_CODING_AGENT_DIR` 隔离不了用量数据，会碰真实 `~/.omp/stats.db`。任何涉及 stats 的 omp 命令 / 实验都要把 `USERPROFILE`/`HOME` 指到临时目录（用量 e2e 这样做）；但**不能**给所有 e2e 都这样做：改过 `USERPROFILE` 后 Electron 的 `app.getPath("desktop")` 等会抛错（实测，导出诊断信息因此失败）。

没验证：`--profile` 命令行参数（环境变量已实测）；XDG data root 初始化后的位置（`user-facing-packages.md` 提到会变），`statsDbPath` 不处理。

## 任务在用哪个账号（"使用中"，omp 18.17.0 实测）

omp 每当会话换订阅账号（第一次请求、额度用完轮到同 provider 另一个号、恢复会话）就往会话文件追加 `{"type":"credential_pin","provider","hash"}`，hash = sha256(`provider\0accountId\0email\0orgId\0projectId`)（omp `session/credential-pin.ts`，缺的项是空串）。`omp usage --json` 每个报告的 `metadata` 带同样几项，算出来一致（所有者本机三个号核过）。所以：

- `parseQuota` 给每个账号算 `identityHash`（没有 accountId 也没有 email 时 null）；
- 主进程读任务会话文件时 `CredentialPinTracker` 取每个 provider 最后一条，放 `TaskState.credentialPins`；
- 用量对话框里 hash 对上的账号挂 `usage.quota.inUse` 徽标。按文件顺序取最后一条，omp 自己沿当前分支取，回到旧分支时可能不同 [推测：很少见]。

omp 怎么给新会话挑账号（omp 18.18.6 `packages/ai/src/auth/rank.ts`，所有者本机三个 anthropic 号核过）：依次比 被封 / 套餐不符 / 额度用完 / 在保留线内 / 5 小时窗口用了 ≥85% / `auth.accountPolicies` 的 priority / 有没有用量报告，之后比**每周窗口的"需要的消耗速度"** = 剩余比例 ÷ 距重置小时数，大的先用（再比每周已用、5 小时窗口同样两项）。所以不是"最早重置的先用"：剩 35%、64 小时后重置（0.54%/h）排在剩 100%、158 小时后重置（0.63%/h）后面。已开着的会话留在原来的号上（anthropic 一小时没请求才重新排），子代理跟父会话的号。
