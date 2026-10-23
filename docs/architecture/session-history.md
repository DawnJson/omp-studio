# 会话历史：只读索引与恢复

范围：侧栏/命令面板里的"历史会话"（含终端里建的会话）和"恢复会话"。代码：`src/main/history/`、`src/main/ipc/history-handlers.ts`。
omp 版本：文档依据 omp 18.12.0 随附的 `session.md`、`session-switching-and-recent-listing.md`；本机用真实 `~/.omp` 目录只读核对过文件头形状（标题槽 + 会话头 + 条目）。**没有跑过恢复会话的真实 omp 进程**（恢复由任务运行时 `TaskPool.resume()` 完成，见 task-model.md）。

## 为什么读文件

omp 没有"列出会话"的 RPC（wire 命令表里只有针对当前会话的 `get_messages*`）。omp 自己的文档给出存储格式，我们**只读**它：从不写 `~/.omp`（AGENTS.md "omp 的边界"）。格式不是协议契约，升级后可能变，所以：

- 只解析文件前缀（标题槽、会话头、第一条用户消息），不解析正文；
- 解析不了的文件计数跳过（`SessionScan.skipped`），不报错，其余会话照常列出；
- 恢复本身走 RPC（`switch_session`），不受格式变化影响。

## 目录和格式

```
<agentDir>/sessions/<编码后的 cwd>/<时间戳>_<sessionId>.jsonl
```

- `agentDir`：`PI_CODING_AGENT_DIR`（非空时）；否则 `<home>/<PI_CONFIG_DIR 或 .omp>/agent`（`resolveAgentDir`）。测试和 e2e 用前者指向临时目录。
- **不自己算 `<编码后的 cwd>`**：只枚举每个桶目录里的顶层 `*.jsonl`（桶里同名的目录是 omp 的附属数据，忽略），项目归属一律读会话头里的 `cwd`。
- 文件开头是 256 字节定宽的 `{"type":"title",...,"pad":"   "}` 标题槽（含 `title`），随后一行 `{"type":"session","id","cwd","timestamp",...,"title"?}`；旧版文件没有标题槽。
- 用户消息条目：`{"type":"message","message":{"role":"user","content":[{"type":"text","text":"..."}]}}`，`content` 也可能是字符串。

## 索引（`SessionIndex`）

| 项 | 规则 |
|---|---|
| 读多少 | 前 32 KiB；没有标题、前缀里也没有用户消息（首条消息很长，比如带图片）时放宽到 512 KiB。截断的最后一行丢弃，不当成损坏 |
| 标题 | 标题槽的 `title` > 头里的 `title` > 无。取第一个非空行、去控制字符、折叠空白、最长 200 字符（加 `…`）。显示名回退到第一条用户消息首行，再回退到 `history.untitled` |
| 缓存 | 按 `(路径, mtime, size)`；没变的文件不重读；消失的文件从缓存清除 |
| 并发 | 最多 16 个文件同时读 |
| 排序 | 按 mtime 从新到旧 |
| 跳过 | 头缺 `id`/`cwd`、头之前有垃圾行、空文件、不是 JSON：计入 `skipped`。读取时被占用/无权限（`EBUSY/EPERM/EACCES`）本次计入 skipped 但不缓存，下次重试；文件扫描中被删（`ENOENT`）静默忽略 |
| 空壳 | 既没标题也没有用户消息的会话不出现在 `listSessions` 里（和 omp 自己的会话选择器一致） |
| 路径比较 | `pathKey`：`path.resolve`，Windows 上再转小写（盘符/大小写/斜杠方向不影响匹配） |

## IPC

| 函数 | 行为 |
|---|---|
| `listSessions(projectId \| null)` | 扫描 → `buildSessionSummaries`：`projectId` 由 cwd 对上任务池的项目（对不上为 null）；`taskId` 由会话文件对上任务池的 `listSessionLinks()`。传了项目 id 就只留 cwd 相同的；项目不存在返回空 |
| `resumeSession(sessionId)` | 按头里的 `id` 重新扫描找文件 → 检查 `cwd` 目录仍存在（不在就报错，不替用户迁移会话）→ `ensureProject(cwd)` 自动加入项目 → `TaskPool.resume({sessionFile, cwd, projectId, title})`。已有任务挂着这个文件时返回那个任务 |
| `ensureSessionProject(sessionId)` | 同 `resumeSession` 的查找和 cwd 检查，只做 `ensureProject(cwd)`，不建任务。侧栏里只在历史会话出现的文件夹点 `＋` 时用：先加成项目，再把草稿切到它 |
| `revealProject / revealTaskSession` | `shell.showItemInFolder`，路径由主进程按 id 查表，渲染进程不传路径。`revealTaskSession` 选中的是 `~/.omp/agent/sessions/<编码后的 cwd>/` 下的会话文件，不是任务的工作目录；工作目录走 `openTaskFolder`（`task-handlers.ts`，`shell.openPath(taskCwd)`） |
| `getTaskSessionRef` | 任务的会话 id 和文件路径（复制用）；还没有会话文件返回 null |

后三个是对 `ipc.ts` 的追加（切片 D）。

## 已知限制 / 风险

- 终端正在使用同一个会话时恢复（实测 omp 18.12.6，2026-10-22，真实 omp + 临时 agent 目录，一次性探针）：① **不实时**：studio 这边的 omp 只在启动时把会话文件重放一次，之后终端那边的新内容不会出现（30 秒内文档不变）；终端正在跑的工具调用在这边显示成 `1 tool call elided — no result on this branch` + 一行 `Warning: Previous session ended while 1 tool call remained pending…`。② **打开时一般不提示**：恢复本身没有警告。例外（2026-10-22，从用户真实会话文件只读看到，omp 18.12.6）：会话历史里用过 eval 工具时，omp 恢复时会往会话里追加一条隐藏的 `custom_message`（`customType: "eval-state-context"`，提醒模型 eval 内核没有恢复），这一写就触发了下面的分叉，所以只打开不发消息也会出警告、生成新文件（新文件 = 原文件全部内容 + 这一条）。③ **一发消息就分叉**：只要另一个 omp 进程还以写模式开着这个文件（终端那边空闲也算），这边第一次发送时 omp 在转录里打一行 `Warning: Session … is open for writing in another omp process, so this session now saves to <新文件> instead of mixing its entries into that file.`（文字节点，不是 toast），之后写进新的兄弟文件（头里 `parentSession` = 原会话 id，复制了原有条目），原文件和终端那边完全不受影响。④ **分叉后 omp 不再发 `omp_session_file`**（只在启动时发过旧路径），所以 studio 记的会话文件还是旧的——下次重开这个任务会恢复原文件，分叉出去的那段对话要从会话列表里另找。终端已退出后恢复则没有警告、正常写回原文件。索引无法提前判断文件是否被占用。
- 同一 `id` 出现在多个文件时（例如整理中的备份），`findById` 取最新的。
- 列表依赖 mtime：omp 写会话文件时才更新，所以"最近"排序近似为"最近有写入"。
- 大目录（数千个会话）首次扫描要 stat + 读前缀每个文件；之后走缓存。没有做增量监听（打开命令面板时重新扫一次）。
- 标题槽之外的标题变更条目（`title_change`）不解析，标题以槽里的当前值为准。

## 测试

`test/session-index.test.ts`：路径含空格和中文的临时目录；标题槽/旧格式/字符串内容；截断前缀；损坏、空、非会话文件计数；超长首条消息；缓存失效和删除；Windows 路径大小写；`resolveAgentDir`。`test/sidebar-model.test.ts`：分组排序、重名项目标签、等你确认跳转、状态点形状、模糊匹配、面板分组。
`test/e2e/sidebar.e2e.ts`：侧栏键盘（方向键、F2、Delete、←/→）、归档撤销、命令面板，截图写到 `screenshots/sidebar-*.png`、`palette-*.png`。

## 会话信息、请求记录、置顶、分享、重试（S3，2026-10-21，omp 18.12.5）

界面见 `docs/design/spec.md` §4.31。代码：`src/main/session-info/`（`session-header.ts`、`session-pins.ts`、`session-stats.ts`、`share.ts`）、`src/main/ipc/session-info-handlers.ts`、`src/shared/omp-output/share.ts`、`src/shared/tsp/error-turn.ts`、`src/shared/ui/session-trace.ts`、`src/renderer/src/features/session-info/`。

### 数据来源（都只读，写入只经 omp）

| 要什么 | 来源 | 备注 |
|---|---|---|
| 会话头 | 会话文件前 32 KiB 里的 `type:"session"` 行 | 字段 id、version、timestamp、cwd、title、parentSession、additionalDirectories |
| 置顶 | `<agentDir>/session-pins.json`（会话 id 数组） | 实测：`/pin` 在 1.5 秒内写入，tab 缩进的 JSON 数组，id 是会话头的 id；再发一次 = 取消（`[]`）。文件缺失 = 无置顶；格式不认识 = 无置顶并记 WARN |
| 用量汇总 | `stats.db.session_rollup`（requests、started_at、ended_at、total_tokens、cost_total、unpriced、models、tool_calls）+ `messages` 的 token 分项合计 | 表结构实测自本机 omp 18.12.5 的库 |
| 请求记录 | `stats.db.messages`（最近 500 条，`TRACE_LIMIT`）+ `tool_calls` 按 entry_id 挂上 | duration / ttft 为毫秒 |

`session_file` 在库里是 omp 写库时的路径原文：先精确匹配 `path.resolve` 后的值，Windows 上没命中再不分大小写、不分斜杠方向匹配。`stats.db` **只在 `omp stats` 运行时同步**（omp-usage.md），所以对话框打开时先读现有库、同时让 omp 同步一次（`syncStatsDb`，和用量页共用，同一时间只跑一个）再重读；同步失败只提示。

### IPC（`ipc.ts`，参数全部校验，路径由主进程按任务 id 查表）

`getTaskSessionInfo(taskId, refresh)`、`getTaskSessionTrace(taskId, refresh)`、`getShareSettings(taskId)`（`omp config list --json` 在任务目录下读 share.*）、`shareTask(taskId, gist)`。置顶切换和重试走 S0 的 `runTaskCommand {kind:"pin"|"retry"}`。`listSessions` 的 `SessionSummary.pinned` 来自上面的置顶文件，侧栏历史会话据此排在前面（`sidebar-model.ts`）。

### 置顶（`/pin`）

TSP 实测：`/pin` 的 toast 是 `Session pinned to the top of the resume list.` / `Session unpinned.`（同一个 toast 节点被 `set` 换字）。studio 切换前后各读一次置顶文件，状态没变就把 omp 的原话当警告显示。

### 分享（`omp share <文件> [--gist]`）

**会上传**，所有者 2026-10-21 拍板：先弹确认框（服务器、是否脱敏、gist 选项）。输出格式用**本机 127.0.0.1 的假 share 服务器**实测，没有连任何真实服务器：成功退出码 0、标准输出 `Share URL: <server>/<id>#<key>`（服务器必须返回 `{"id":"<十六进制>"}`，否则 `server returned no usable id`）；失败退出码 1、标准输出空、标准错误是 Bun 堆栈加一行 `error: Share upload to … failed: …`。`parseShareOutput` 认 `Share URL:` / `Gist URL:` 标签，只接受 http(s)，认不出时 `url` 为 null、界面显示 omp 原文。**没实测**：`--gist` 的输出、截断说明行、`share.redactSecrets` 的效果。

### 重试（`/retry`）

实测（`fixtures/tsp/error-turn.jsonl`，无效 key → 401）：错误卡是 `omp.assistant` 里的 `card role=omp.error`（头 + `omp.error.code` 徽章 + `omp.error.message` + `omp.error.action` 的 copy-error / switch-model），**没有重试动作**；发 `/retry` 成功时**不发 toast**，直接重跑这一轮（实测又失败：旧卡被换内容，追加新的助手容器和新错误卡）。所以 TSP 的 `retry` 必须走"安静命令"（出现新 toast 才算失败，如 `Nothing to retry`）——已请 S0Infra 在 `TaskPool.runTaskCommand` 里把 `retry` 加进 `quiet` 条件。重试按钮只挂在 `trailingErrorCardId` 选出的收尾错误卡上。

### TSP 任务的 `sessionUsage`

omp 的 TSP 输入框卡片只给费用。token 分项和请求数由 `TspRunner.#refreshTotals` 在费用变化时从**会话文件**读（`readSessionUsage` + `totalUsage`，范围同 get_session_stats），而不是 `session_rollup`：rollup 只在 `omp stats` 运行时更新，对进行中的会话是旧的。`ModelUsage.requests`、`SessionUsage.requests?` 是新增字段。

### 测试

`test/session-stats.test.ts`（临时 `stats.db` 夹具，表结构抄自 omp）、`session-info-files.test.ts`（置顶、会话头）、`session-share.test.ts`（分享输出、假 omp）、`session-trace.test.ts`、`tsp-error-turn.test.ts`（逐帧回放）、`session-usage.test.ts`、`session-index.test.ts`（pinned）、`sidebar-model.test.ts`（置顶排序）。

### 没做 / 没验证

没有跑 e2e；没有在真实 omp 里验证 TSP `/retry` 经 `runQuietCommand` 的端到端；没有点过界面（无截图）。

## 2026-10-23 补充（omp 18.12.6）

- **会话信息概览的用量改读会话文件**（`readSessionUsage`，和输入框同口径），不再读 stats.db 的 `session_rollup`（进行中的会话是旧的）；概览不再有"同步"。`readSessionUsage` 加了和 `readSessionEntries` 同一个文件大小上限（256MB，超过抛错）。
- **请求记录页"在浏览器中打开"**：实测 omp `/trace`（TSP，`PI_TUI_TSP_RECORD`）：在任务进程里起统计服务（127.0.0.1:3847，已有则复用），**omp 自己用 PowerShell Start-Process 打开浏览器**，状态 toast `Trace: http://127.0.0.1:3847/#/traces?s=<编码后的会话文件>`，对话里不加节点。选它而不是 `omp stats`：后者要 studio 管一个长驻进程，且会再打开一个根页面标签。`TaskCommand { kind: "trace" }`，任务运行中按钮禁用；studio 不再自己开链接（会出两个标签）。录制 `fixtures/tsp/trace-link.jsonl` 是 slash-status 的握手加真实的 `/trace` 帧（路径脱敏）。
- **历史状态口径**对齐 omp `session-listing.ts`：completed / error / aborted / interrupted（length、内容里有 toolCall、最后是工具结果）/ pending（最后是用户消息）/ 认不出 null。侧栏画 completed、error、interrupted（虚线圈暂停号，悬停说明），aborted 和 pending 不画。

