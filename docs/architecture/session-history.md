# 会话历史：只读索引与恢复

范围：侧栏/命令面板里的"历史会话"（含终端里建的会话）和"恢复会话"。代码：`src/main/history/`、`src/main/ipc/history-handlers.ts`。
omp 版本：文档依据 omp 18.12.0 随附的 `session.md`、`session-switching-and-recent-listing.md`；本机用真实 `~/.omp` 目录只读核对过文件头形状（标题槽 + 会话头 + 条目）。**没有跑过恢复会话的真实 omp 进程**（恢复由任务运行时 `TaskPool.resume()` 完成，见 task-model.md）。

## 为什么读文件

omp 没有"列出会话"的 RPC（wire 命令表里只有针对当前会话的 `get_messages*`）。omp 自己的文档给出存储格式，我们**只读**它：从不写 `~/.omp`（[omp-boundaries.md](omp-boundaries.md)）。格式不是协议契约，升级后可能变，所以：

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
| `listSessions(projectId \| null)` | 扫描 → `buildSessionSummaries`：`projectId` 由 cwd 对上任务池的项目（对不上为 null）；`taskId` / `archived` 由会话文件对上任务池的 `listSessionLinks()`（挂在未归档任务上的填 `taskId`，它就是任务行；挂在已归档任务上的 `archived: true`，侧栏只在“已归档”里列，点开 `resume` 把它恢复成同一个任务）；`parentId` 由会话头的 `parentSession` 在全部索引里对上（omp 整会话分叉写父会话 id、从某条消息分叉写父会话文件路径，两种都认；找不到为 null），侧栏据此把分叉缩进在原会话下面（`SidebarItem.parent` 记着缩进在哪一行下面），原会话那一行可以收起它下面的分叉（2026-11-09 起，issue #9；状态只在渲染层内存里，规则见 spec §4.5“收起分叉”）。传了项目 id 就只留 cwd 相同的；项目不存在返回空 |
| `archiveSession(sessionId)` | 2026-11-08 起（issue #9）：历史会话归档。没挂在任务上的（终端里开的）建一条 `archived:true` 的任务记录（会话目录还不是项目时先加成项目），不起 omp、不动会话文件；挂在任务上的按任务归档 |
| `resumeSession(sessionId)` | 按头里的 `id` 重新扫描找文件 → 检查 `cwd` 目录仍存在（不在就报错，不替用户迁移会话）→ `ensureProject(cwd)` 自动加入项目 → `TaskPool.resume({sessionFile, cwd, projectId, title})`。已有任务挂着这个文件时返回那个任务 |
| `ensureSessionProject(sessionId)` | 同 `resumeSession` 的查找和 cwd 检查，只做 `ensureProject(cwd)`，不建任务。侧栏里只在历史会话出现的文件夹点 `＋` 时用：先加成项目，再把草稿切到它 |
| `revealProject / revealTaskSession` | `shell.showItemInFolder`，路径由主进程按 id 查表，渲染进程不传路径。`revealTaskSession` 选中的是 `~/.omp/agent/sessions/<编码后的 cwd>/` 下的会话文件，不是任务的工作目录；工作目录走 `openTaskFolder`（`task-handlers.ts`，`shell.openPath(taskCwd)`） |
| `getTaskSessionRef` | 任务的会话 id 和文件路径（复制用）；还没有会话文件返回 null |

后三个是对 `ipc.ts` 的追加（切片 D）。

## 已知限制 / 风险

- 终端正在使用同一个会话时恢复（实测 omp 18.12.6，2026-10-22，真实 omp + 临时 agent 目录，一次性探针）：① **不实时**：studio 这边的 omp 只在启动时把会话文件重放一次，之后终端那边的新内容不会出现（30 秒内文档不变）；终端正在跑的工具调用在这边显示成 `1 tool call elided — no result on this branch` + 一行 `Warning: Previous session ended while 1 tool call remained pending…`。② **打开时一般不提示**：恢复本身没有警告。例外（2026-10-22，从用户真实会话文件只读看到，omp 18.12.6）：会话历史里用过 eval 工具时，omp 恢复时会往会话里追加一条隐藏的 `custom_message`（`customType: "eval-state-context"`，提醒模型 eval 内核没有恢复），这一写就触发了下面的分叉，所以只打开不发消息也会出警告、生成新文件（新文件 = 原文件全部内容 + 这一条）。③ **一发消息就分叉**：只要另一个 omp 进程还以写模式开着这个文件（终端那边空闲也算），这边第一次发送时 omp 在转录里打一行 `Warning: Session … is open for writing in another omp process, so this session now saves to <新文件> instead of mixing its entries into that file.`（文字节点，不是 toast），之后写进新的兄弟文件（头里 `parentSession` = 原会话 id，复制了原有条目），原文件和终端那边完全不受影响。④ **分叉后 omp 不再发 `omp_session_file`**（只在启动时发过旧路径），所以 studio 记的会话文件还是旧的——下次重开这个任务会恢复原文件，分叉出去的那段对话要从会话列表里另找（18.12.6）。**omp 18.18.2 起变了**（2026-11-09 实测，issue #9）：反过来，studio 的任务开着、空闲时另一个 `omp -p --resume=<原文件>` 发消息，那边照旧分叉到新文件（头里 `parentSession` = 原会话 id，条目原样复制再接新的一轮，原文件不动，侧栏把它缩进在任务下面）；studio 这边点"重开会话"（`--resume` 原文件）时 omp 自己跟到分叉上：对话里出现那边的一轮和一条警告"Session … went on in …; resuming …"，任务记的会话文件换成新文件，之后的消息写进新文件；原文件留在历史里成了没有任务的父会话。studio 的进程已经关了（空闲关闭）时，那边直接写回原文件、不分叉，重新打开任务就看到那一轮。终端已退出后恢复则没有警告、正常写回原文件。索引无法提前判断文件是否被占用。
- **重新读会话文件的时机**：只在起 omp 进程时——重开会话（顶栏 `topbar-restart` / `Ctrl Shift R` / 命令面板，`TspRunner.restart`：关进程再起）和打开一个已停止的任务（有 `sessionFile` 时），都用 `omp --resume=<会话文件>`（`buildTspArgs`），omp 从文件重放整段对话，skill、MCP、插件和配置也一起重新读。所以终端或别的进程往同一个会话文件写了新内容后，想在 studio 看到就重开会话（按钮提示 `task.restartTip` 写明这一点，2026-11-08，issue #9）；studio 不监听文件变化、不提示（仓库所有者定，不做）。
- 同一 `id` 出现在多个文件时（例如整理中的备份），`findById` 取最新的。
- 列表依赖 mtime：omp 写会话文件时才更新，所以"最近"排序近似为"最近有写入"。
- 大目录（数千个会话）首次扫描要 stat + 读前缀每个文件；之后走缓存。没有做增量监听，重扫的时机：侧栏换 refreshKey（任务列表变化）、进出搜索、窗口重新获得焦点（终端 omp 在这期间可能新建或删掉了会话，2026-11-06 起，issue #8）、每次打开命令面板。
- 标题槽之外的标题变更条目（`title_change`）不解析，标题以槽里的当前值为准。

## 测试

`test/session-index.test.ts`：路径含空格和中文的临时目录；标题槽/旧格式/字符串内容；截断前缀；损坏、空、非会话文件计数；超长首条消息；缓存失效和删除；Windows 路径大小写；`resolveAgentDir`。`test/sidebar-model.test.ts`：分组排序、重名项目标签、等你确认跳转、状态点形状、模糊匹配、面板分组。
`test/e2e/sidebar.e2e.ts`：侧栏键盘（方向键、F2、Delete、←/→）、归档撤销、命令面板。

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

TSP 实测：`/pin` 的 toast 是 `Session pinned to the top of the resume list.` / `Session unpinned.`（同一个 toast 节点被 `set` 换字）。studio 切换前后各读一次置顶文件，状态没变就把 omp 的原话当警告显示；变了就重取 `listSessions`，侧栏跟着重排。

侧栏（2026-11-10 起）：入口除了会话信息对话框、`/pin`、命令面板，还有任务菜单（侧栏右键 / ⋯、顶栏 ⋯）的"置顶 / 取消置顶"，菜单上的状态取 `listSessions` 里挂在这个任务上的那一条的 `pinned`（`use-history-sessions.ts` 的 `isTaskPinned` / `useTaskPinned`）。`sidebar-model.ts` 给每一行算 `pinned`（历史会话看自己，任务看挂在它上面的会话）：置顶的行在文件夹里和时间线里排最前，有置顶行的文件夹排在默认文件夹之后、其余文件夹之前；行上画图钉。没挂在任务上的历史会话没有置顶入口：`/pin` 要在 omp 进程里跑，先点开恢复成任务再置顶。

### 分享（`omp share <文件> [--gist]`）

**会上传**，所有者 2026-10-21 拍板：先弹确认框（服务器、是否脱敏、gist 选项）。输出格式用**本机 127.0.0.1 的假 share 服务器**实测，没有连任何真实服务器：成功退出码 0、标准输出 `Share URL: <server>/<id>#<key>`（服务器必须返回 `{"id":"<十六进制>"}`，否则 `server returned no usable id`）；失败退出码 1、标准输出空、标准错误是 Bun 堆栈加一行 `error: Share upload to … failed: …`。`parseShareOutput` 认 `Share URL:` / `Gist URL:` 标签，只接受 http(s)，认不出时 `url` 为 null、界面显示 omp 原文。**没实测**：`--gist` 的输出、截断说明行、`share.redactSecrets` 的效果。

### 重试（`/retry`）

实测（`fixtures/tsp/error-turn.jsonl`，无效 key → 401）：错误卡是 `omp.assistant` 里的 `card role=omp.error`（头 + `omp.error.code` 徽章 + `omp.error.message` + `omp.error.action` 的 copy-error / switch-model），**没有重试动作**；发 `/retry` 成功时**不发 toast**，直接重跑这一轮（实测又失败：旧卡被换内容，追加新的助手容器和新错误卡）。所以 TSP 的 `retry` 必须走"安静命令"（出现新 toast 才算失败，如 `Nothing to retry`）——已请 S0Infra 在 `TaskPool.runTaskCommand` 里把 `retry` 加进 `quiet` 条件。重试按钮只挂在 `trailingErrorCardId` 选出的收尾错误卡上。

### TSP 任务的 `sessionUsage`

omp 的 TSP 输入框卡片只给费用。token 分项和请求数由 `TspRunner.#refreshTotals` 在费用变化时从**会话文件**读（`totalUsage`，范围同 get_session_stats），而不是 `session_rollup`：rollup 只在 `omp stats` 运行时更新，对进行中的会话是旧的。`ModelUsage.requests`、`SessionUsage.requests?` 是新增字段。

**范围的规则**（`src/main/history/session-usage.ts`，2026-11-09 照 omp 18.18.5 源码对齐）：get_session_stats = 内存里对话的 assistant 消息 + 当前分支窗口内的 `model_usage` 记录（`packages/coding-agent/src/session/session-stats.ts:72-94` `forEachActiveModelUsage`，在 `:177`、`:248` 调用）。

- `model_usage`：不进对话的模型调用（后台作业 `job-*`、`task-completion-*`、标题、缓存预热 `cache-warm`，结构见 `session-entries.ts:119-135`），`usage` 和 assistant 消息同形。带 `cacheRefresh` 的也算（omp 不按它过滤）；studio 每条记一个请求（omp `stats.db` 也是一条一行，`packages/stats/src/parser.ts:612-615`）。
- **按分支**，不是整个文件：只算从叶子沿 parentId 走到根这条链上的。迟到的用量挂在发起时的位置、带 `activeLeafId`（`session-manager.ts:3631-3655` `appendModelUsage`），不在当前分支上，不算；omp 整个文件的合计（`getUsageStatistics`，`session-manager.ts:425-432`、`:634`）才算它。
- **叶子**照 omp 回放（`session-entries.ts:373-397` `resolveSessionLeafId`）：最后一条带 `activeLeafId` 就取它（`null` 为没有叶子；指向的记录不在时取最后一条不带 `activeLeafId` 的），否则取最后一条本身。之前 studio 直接取最后一条，最后一条是迟到的用量时当前分支会被截短。
- **窗口**：最近一次压缩之后有 `/clear` 留下的 `reset_boundary` 就从它之后起；否则从最近一次压缩的 `firstKeptEntryId` 起（找不到就从压缩之后起），再往前带上紧挨着的非消息记录（停在 `message` / `custom_message` / `branch_summary` / `compaction` / `reset_boundary` 上，`session-stats.ts:61-69`）。assistant 消息用同一个窗口（omp 重建对话也从 `reset_boundary` 之后起，`session-context.ts:518-537`）。`whole`（含压缩前的合计）仍只在压缩过时给。
- **没跟**：get_session_stats 还加上 `task` 工具结果里子代理的用量（studio 的费用段把子代理单独写在括号里）；恢复会话时 omp 重建对话（`session-context.ts:752-819`）会去掉没有结果的工具调用（去掉后内容为空的 assistant 消息整条丢掉）、丢掉以 error / aborted 结束的 assistant 消息，这些消息的用量恢复后的 get_session_stats 不算，studio 算（进行中的会话里 omp 也还算着）。

实测（omp 18.18.5，会话文件复制到临时目录，`PI_CODING_AGENT_DIR=<临时目录> ANTHROPIC_API_KEY=<假的> omp --mode rpc --resume <副本>` 只发 `get_session_stats`，原文件只读）：三个带 `model_usage` 的会话 token 分项和费用逐项相等——两个子代理会话各有一条在分支上、一条带 `activeLeafId` 不在分支上（修之前分别少 262,417 / 89,521 token，$0.0558 / $0.0250，正是分支上那条；不在分支上的那条 omp 不算），一个压缩过两次的会话两条都在最近一次压缩的窗口之前（修前修后都不算）。一个 `/clear` 过的会话：修之前比 omp 多 13,045,560 token（$6.59，几乎都是 `reset_boundary` 之前的），修之后只差最后一条内容全是没有结果的工具调用的 assistant 消息（141,511 token、$0.0416，上面"没跟"的第二条）。

**增量读**（2026-10-26 起，`src/main/tsp/session-file-reader.ts`）：每个任务一个 `SessionFileReader`，只读上次读到的位置之后追加的字节，按 `\n` 切行、每行 `JSON.parse` 一次，同时喂给用量累加器（`SessionUsageAccumulator`，token 合计）和每轮脚注累加器（`SessionExtrasAccumulator`）。写到一半的最后一行留到下次；文件变短、或上次位置之前的最后 64 字节变了（被重写）就清空累加器从头读；会话文件换了（分叉、新会话、`/move`）换一个读取器。之前每次费用变化和每轮结束都整份 `readFile` + `split` + `JSON.parse`：真实会话文件常见 30–150 MB，55 MB 的一份一次约 200 ms 主线程阻塞、上百 MB 临时内存。实测（Node 24，本机会话文件的副本）：55 MB 首次 229 ms（分 1 MiB 块读，事件循环最长被占 5 ms）、之后没有新内容 4.8 ms、追加一行 8 ms；38 MB 首次 160 ms、追加一行 12 ms。IPC 查询（2026-10-27 起）也走增量读：按模型的用量 / 会话信息概览（`readSessionUsage`）和会话树、回溯、标签、分叉（`readSessionEntries`）各有一个 `SessionReaderCache`，按文件留最近 4 个读取器，同一个文件再查只读新追加的完整行（之前会话树每次 `readFile` + 整份 `JSON.parse`，同步占住主线程）。会话树的累加器只留用户消息、压缩点、分支摘要、标签条目的内容，其余条目只留 type / id / parentId。没有 `\n` 结尾的最后一行这两处也留到下次（omp 每个条目都带换行写入）。

**用量一个文件一个读取器**（2026-10-28 起，`src/main/tsp/session-files.ts`）：之前任务自己的读取器和 `readSessionUsage` 的缓存各读各的，任务的当前会话文件整份读两遍、`JSON.parse` 两遍（55 MB 的文件首次各约 229 ms，见上）。现在两处共用一个 `SessionReaderCache`：每个文件一个读取器，一遍读取同时喂用量和脚注两个累加器。任务用 `holdSessionFile` 占住当前会话文件的读取器（会话文件换了换着占，任务 dispose 时释放，dispose 之后进来的读取不再占），占住的不算进"最近 4 个"，不会被别的文件挤掉后从头再读；没被占住的（历史会话、已归档任务）仍按文件留最近 4 个。会话树（`readSessionEntries`）仍是 `session-tree-file.ts` 里自己的、不被占住的 4 个读取器：树的累加器留着用户消息的整条内容（含图片的 base64），放进任务一直占着的读取器里，内存会随碰过的会话一直涨；代价是打开会话树时这个文件再读一遍。不做"不解析就跳过某些行"：用量要每一条带 id 的记录（沿 parentId 走分支），没有可以跳过的行。

### 测试

`test/session-stats.test.ts`（临时 `stats.db` 夹具，表结构抄自 omp）、`session-info-files.test.ts`（置顶、会话头）、`session-share.test.ts`（分享输出、假 omp）、`session-trace.test.ts`、`tsp-error-turn.test.ts`（逐帧回放）、`session-usage.test.ts`、`session-files.test.ts`（任务和用量共用一个读取器：每行只解析一次、结果同整份文本；任务占住的读取器不被挤掉）、`session-index.test.ts`（pinned）、`sidebar-model.test.ts`（置顶排序）。

### 没做 / 没验证

没有跑 e2e；没有在真实 omp 里验证 TSP `/retry` 经 `runQuietCommand` 的端到端；没有点过界面。

## 2026-10-23 补充（omp 18.12.6）

- **会话信息概览的用量改读会话文件**（`readSessionUsage`，和输入框同口径），不再读 stats.db 的 `session_rollup`（进行中的会话是旧的）；概览不再有"同步"。`readSessionUsage` 加了和 `readSessionEntries` 同一个文件大小上限（256MB，超过抛错）。
- **请求记录页"在浏览器中打开"**：实测 omp `/trace`（TSP，`PI_TUI_TSP_RECORD`）：在任务进程里起统计服务（127.0.0.1:3847，已有则复用），**omp 自己用 PowerShell Start-Process 打开浏览器**，状态 toast `Trace: http://127.0.0.1:3847/#/traces?s=<编码后的会话文件>`，对话里不加节点。选它而不是 `omp stats`：后者要 studio 管一个长驻进程，且会再打开一个根页面标签。`TaskCommand { kind: "trace" }`，任务运行中按钮禁用；studio 不再自己开链接（会出两个标签）。录制 `fixtures/tsp/trace-link.jsonl` 是 slash-status 的握手加真实的 `/trace` 帧（路径脱敏）。
- **历史状态口径**对齐 omp `session-listing.ts`：completed / error / aborted / interrupted（length、内容里有 toolCall、最后是工具结果）/ pending（最后是用户消息）/ 认不出 null。侧栏画 completed、error、interrupted（虚线圈暂停号，悬停说明），aborted 和 pending 不画。

