# 用量：订阅账号额度和每日消耗热力图（设置 → 用量）

只读。实现：`src/main/usage/usage-service.ts`、`src/main/ipc/usage-handlers.ts`（`getUsageQuota`、`getUsageHeatmap`）、渲染端 `features/settings/UsageSection.tsx` + `usage-store.ts`（模块里缓存上次结果，进入先显示再后台刷新）。测试：`test/usage-service.test.ts`、`test/e2e/settings-functional.e2e.ts`。实测 omp 18.12.1，2026-10-18。

## 数据来源（查过 omp 文档和源码）

| 要什么 | 来源 | 结论 |
|---|---|---|
| 订阅账号额度 | `omp usage --json`（`omp://cli-reference.md`、`providers.md`） | 返回 `{ generatedAt, reports: UsageReport[], accountsWithoutUsage, disabledCredentials, capacity }`。`UsageReport` 的类型在 omp 源码 `packages/ai/src/usage.ts`：`limits[]`（`label`、`window.{label,resetsAt}`、`amount.{used,limit,usedFraction,remainingFraction,unit}`、`status`）、`resetCredits`、`notes`、`metadata`。omp 自己去各 provider 查，带 5 分钟缓存。没有登录账号时 `reports` 为空（实测）。另有 `omp usage --history --days N --json`（每小时快照），目前没用。 |
| 每日消耗 | omp 的 `stats.db`（默认 `<home>\.omp\stats.db`，`omp://user-facing-packages.md`） | 表 `message_rollup`：**小时桶**（UTC 对齐的毫秒时间戳 `bucket`）× 模型 × provider × 目录，列 `requests`、`total_tokens`、`cost_total`…。node:sqlite（Electron 44 自带的 Node，无新依赖）只读打开可用。 |
| 本会话用量 | RPC `get_session_stats` | 属于输入框下方的会话消耗，不在这里。 |

`omp stats --json` 只返回默认 24 小时的汇总（CLI 没有 range 参数），不够 365 天，所以热力图直接查库。

## 重要：`stats.db` 不会自己更新

实测：跑完一轮对话后 `stats.db` 的 `messages` 表还是 0 行；运行 `omp stats --json` 之后才变成 1 行（它先"Syncing session files…"，把会话 JSONL 读进库）。所以**刷新 = 让 omp 自己跑一次 `omp stats --json`**（读会话文件、跨进程加锁、写库都是 omp 的事，omp-studio 不碰），再用 node:sqlite 只读地查。`getUsageHeatmap(false)` 直接读现有库（马上有东西看），`true` 先同步再读；界面先 false 再 true。首次同步要读完全部历史会话，历史很多时可能要几分钟（超时 15 分钟，超时杀掉，下次接着同步）。库不存在（从没同步过）时 `hasDatabase: false`，界面说明还没有数据。

## 本地时区

小时桶按 UTC 对齐，按本地时区的日期合并成"天"；窗口是含今天的 365 天，每天的请求数、token、花费。界面：53 周 × 7 天的格子，5 档深浅（占该指标最大值的比例），可切 Token / 花费 / 请求数，悬停显示当天的值。

## 没做 / 没验证

- 额度条（有账号的情况）**没有用真实订阅账号验证**：开发环境没有订阅账号，`omp usage --json` 在临时 agent 目录里只会返回空列表。`parseQuota` 按 omp 源码里的 `UsageReport` 类型写，有单元测试（构造的报告），真实输出的字段（比如账号邮箱放在 `metadata.email` 还是 `scope.accountId`）是推测，等有账号时对一次。
- 非默认 profile（`omp --profile`、`OMP_PROFILE`）的 `stats.db` 位置不同（`~/.omp/profiles/<名>/…`，推测），目前只支持默认 profile。
- **踩过的坑**：`PI_CODING_AGENT_DIR` 不会重定向 `stats.db`——它在 `<home>\.omp\` 下，不在 agent 目录里。实测时我第一次用只设了 `PI_CODING_AGENT_DIR` 的环境跑 `omp stats --json`，读到并（同步 0 条新记录）碰了真实的 `~\.omp\stats.db`。之后的实验和 e2e 都把 `USERPROFILE`/`HOME` 一起指到临时目录。以后在 omp 的任何命令里涉及 stats 都要这样做。
