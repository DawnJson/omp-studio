# 会话历史：只读索引与恢复

范围：侧栏/命令面板里的"历史会话"（含终端里建的会话）和"恢复会话"。代码：`src/main/history/`、`src/main/ipc/history-handlers.ts`。
omp 版本：文档依据 omp 18.12.0 随附的 `session.md`、`session-switching-and-recent-listing.md`；本机用真实 `~/.omp` 目录只读核对过文件头形状（标题槽 + 会话头 + 条目）。恢复由任务运行时 `TaskPool.resume()` 完成（见 task-model.md）。

## 为什么读文件

omp 没有"列出会话"的 RPC。omp 自己的文档给出存储格式，我们**只读**它：从不写 `~/.omp`（[omp-boundaries.md](omp-boundaries.md)）。格式不是协议契约，升级后可能变，所以：

- 只解析文件前缀（标题槽、会话头、第一条用户消息），不解析正文；
- 解析不了的文件计数跳过（`SessionScan.skipped`），不报错，其余会话照常列出；
- 恢复本身由 omp `--resume` 完成，不受格式变化影响。

## 目录和格式

```
<agentDir>/sessions/<编码后的 cwd>/<时间戳>_<sessionId>.jsonl
```

- `agentDir`：`PI_CODING_AGENT_DIR`（非空时）；否则 `<home>/<PI_CONFIG_DIR 或 .omp>/agent`（`resolveAgentDir`）。测试和 e2e 用前者指向临时目录。
- **不自己算 `<编码后的 cwd>`**：只枚举每个桶目录里的顶层 `*.jsonl`（桶里同名的目录是 omp 的附属数据，忽略），项目归属一律读会话头里的 `cwd`。
- 文件开头是定宽的 `{"type":"title",...,"pad":"   "}` 标题槽（含 `title`），随后一行 `{"type":"session","id","cwd","timestamp",...,"title"?}`；旧版文件没有标题槽。
- 用户消息条目：`{"type":"message","message":{"role":"user","content":[{"type":"text","text":"..."}]}}`，`content` 也可能是字符串。

## 索引（`SessionIndex`）

读多少、标题长度、并发数等取值见 `src/main/history/session-index.ts`。

- **只读前缀**；没有标题、前缀里也没有用户消息（首条消息很长，比如带图片）时放宽再读一次。截断的最后一行丢弃，不当成损坏。
- **标题**：标题槽的 `title` > 头里的 `title` > 无；显示名回退到第一条用户消息首行，再回退到 `history.untitled`。标题槽之外的 `title_change` 条目不解析。
- **缓存**按 `(路径, mtime, size)`，没变的文件不重读，消失的文件清除。
- **缓存存盘**在 `userData/session-index.json`（studio 自己的目录，不写 `~/.omp`；`SessionIndexStore`，`ipc/history-handlers.ts` 接上）：重启后没变的文件不再读前缀和末尾，只剩列目录和 stat。缓存有变化的那次扫描之后串行写一次，不等它；写不了只记 WARN。存盘带格式版本、studio 版本和会话目录，任一不对就整份作废、照常从文件读（升级后解析口径可能变）。实测（本机 402 个会话、4.1 GB，2026-11-11）：没有存盘时，磁盘缓存冷的首次扫描约 2.2 s、磁盘缓存热约 90 ms；读回存盘后约 7 ms，存盘约 300 KB。
- **并发的扫描合并**：正在扫时来的请求排成一次，在它之后再扫（这期间的变化要看得到），排着的那次被所有后来者共用。启动时侧栏先用空的任务列表要一次、任务列表到了又要一次，不合并就是两遍并发的冷读、前一遍的结果还被丢掉。
- **排序**按 mtime 从新到旧（omp 写文件时才更新，所以"最近"近似为"最近有写入"）。
- **跳过**：头缺 `id`/`cwd`、头之前有垃圾行、空文件、不是 JSON 计入 `skipped`。读取时被占用/无权限（`EBUSY/EPERM/EACCES`）本次计入 skipped 但不缓存，下次重试；扫描中被删（`ENOENT`）静默忽略。
- **空壳**：既没标题也没有用户消息的会话不列出（和 omp 自己的会话选择器一致）。
- **路径比较**：`pathKey`，Windows 上不分大小写和斜杠方向。
- 同一 `id` 出现在多个文件时（例如备份），`findById` 取最新的。

## IPC

| 函数 | 行为 |
|---|---|
| `listSessions(projectId \| null)` | 扫描 → `buildSessionSummaries`：`projectId` 由 cwd 对上任务池的项目；`taskId` / `archived` 由会话文件对上 `listSessionLinks()`（挂在未归档任务上的填 `taskId`，它就是任务行；挂在已归档任务上的 `archived: true`，侧栏只在"已归档"里列，点开 `resume` 恢复成同一个任务）；`parentId` 由会话头的 `parentSession` 在全部索引里对上（omp 整会话分叉写父会话 id、从某条消息分叉写父会话文件路径，两种都认），侧栏据此把分叉缩进在原会话下面，原会话那一行可以收起它下面的分叉（issue #9，规则见 spec §4.5"收起分叉"）。传了项目 id 就只留 cwd 相同的。每次调用顺带在后台跑一次对账 `TaskPool.pruneMissingSessions`（issue #10，规则见 [task-model.md](task-model.md)「会话文件被删」），不等它 |
| `archiveSession(sessionId)` | 历史会话归档（issue #9）。没挂在任务上的（终端里开的）建一条 `archived:true` 的任务记录（会话目录还不是项目时先加成项目），不起 omp、不动会话文件；挂在任务上的按任务归档 |
| `deleteSession(sessionId)` / `deleteTask(taskId)` | 真删除，经 omp 的 `/delete`（下面「删除会话」，issue #10）。会话按头里的 `id` 找文件，挂在任务上的（含已归档的）按任务删；会话目录没了也能删 |
| `resumeSession(sessionId)` | 按头里的 `id` 重新扫描找文件 → 检查 `cwd` 目录仍存在（不在就报错，不替用户迁移会话）→ `ensureProject(cwd)` → `TaskPool.resume({sessionFile, cwd, projectId, title})`。已有任务挂着这个文件时返回那个任务 |
| `ensureSessionProject(sessionId)` | 同 `resumeSession` 的查找和 cwd 检查，只做 `ensureProject(cwd)`，不建任务。侧栏里只在历史会话出现的文件夹点 `＋` 时用 |
| `revealProject / revealTaskSession` | `shell.showItemInFolder`，路径由主进程按 id 查表，渲染进程不传路径。`revealTaskSession` 选中的是会话文件，不是任务的工作目录；工作目录走 `openTaskFolder`（`task-handlers.ts`） |
| `getTaskSessionRef` | 任务的会话 id 和文件路径（复制用）；还没有会话文件返回 null |

## 已知限制 / 风险

- **终端正在使用同一个会话时恢复**（实测 omp 18.12.6，2026-10-22，真实 omp + 临时 agent 目录，一次性探针）：
  - **不实时**：studio 这边的 omp 只在启动时把会话文件重放一次，之后终端那边的新内容不会出现；终端正在跑的工具调用在这边显示成 `1 tool call elided — no result on this branch` + 一行 `Warning: Previous session ended while 1 tool call remained pending…`。
  - **打开时一般不提示**。例外（从用户真实会话文件只读看到）：会话历史里用过 eval 工具时，omp 恢复时会追加一条隐藏的 `custom_message`（`customType: "eval-state-context"`），这一写就触发下面的分叉，所以只打开不发消息也会出警告、生成新文件。
  - **一发消息就分叉**：只要另一个 omp 进程还以写模式开着这个文件（终端空闲也算），这边第一次发送时 omp 在转录里打一行 `Warning: Session … is open for writing in another omp process, so this session now saves to <新文件> …`（文字节点，不是 toast），之后写进新的兄弟文件（`parentSession` = 原会话 id，复制了原有条目），原文件和终端那边不受影响。
  - omp 18.12.6：分叉后 omp 不再发 `omp_session_file`，studio 记的还是旧文件，分叉出去的那段对话要从会话列表里另找。
  - omp 18.18.2（2026-11-09 实测，issue #9）：studio 的任务开着、空闲时另一个 `omp -p --resume=<原文件>` 发消息，那边分叉到新文件（侧栏缩进在任务下面）；studio 这边"重开会话"时 omp 自己跟到分叉上：对话里出现那边的一轮和警告"Session … went on in …; resuming …"，任务记的会话文件换成新文件，原文件留在历史里成了没有任务的父会话。studio 的进程已经关了（空闲关闭）时，那边直接写回原文件、不分叉。终端已退出后恢复没有警告、正常写回原文件。
  - 索引无法提前判断文件是否被占用。
- **重新读会话文件的时机**：只在起 omp 进程时——重开会话（`TspRunner.restart`：关进程再起）和打开一个已停止的任务，都用 `omp --resume=<会话文件>`，omp 从文件重放整段对话，skill、MCP、插件和配置也一起重新读。别的进程往同一个会话文件写了新内容后，想在 studio 看到就重开会话（按钮提示 `task.restartTip` 写明，issue #9）；**studio 不监听文件变化、不提示（仓库所有者定，不做）**。
- 没有增量监听：第一次装好（或升级后）的首次扫描要读每个文件的前缀和末尾，之后走存盘的缓存。重扫的时机：侧栏换 refreshKey（任务列表变化）、进出搜索、窗口重新获得焦点（终端 omp 在这期间可能新建或删掉了会话，issue #8；顺带对账，issue #10）、每次打开命令面板。

## 删除会话（`/delete`，2026-11-10，issue #10）

界面见 spec §4.2（任务菜单）和 §4.5（会话行菜单）；主进程流程见 [task-model.md](task-model.md)「删除会话」。studio 不写 `~/.omp`，删除只经 omp 自己的 `/delete`（omp 文档 `session-operations-export-share-fork-resume.md`「New and delete」：删当前会话的 JSONL 和 artifact 目录，尽力而为，删不掉也照样换到新会话；vibe 模式下拒绝）。

实测（omp 18.18.6，2026-11-10，一次性探针：`TaskPool` + PATH 上的真实 omp、临时 `PI_CODING_AGENT_DIR`、`PI_TUI_TSP_RECORD` 录双向消息）：

| 情形 | omp 的反应 |
|---|---|
| 任务自己的 omp（刚答完一轮）里 `send` `/delete` | 没有确认步骤。main 里的对话节点全部 `del`，加一个 `text`：`[图标] Session deleted`（不是 toast，没有 role）；很快会话文件不在了（新会话不落盘）。之后 `omp session lease` 仍报这个 id 被这个进程占着，直到进程退出；studio 记录里的 `sessionFile` 还是旧路径 |
| 没有进程：新起 omp `--resume` 这个会话再发 `/delete` | 同上。只 `--resume`、还没写东西时 omp 不占租约（`held: []`） |
| vibe 模式里发 `/delete` | 不删；main 里加一条 `row role=omp.notice.warning`：`Exit vibe mode first.` |
| **别的 omp 进程占着这个会话** | 照样 `Session deleted`，但文件**没删**，而且被截短到只剩标题槽和半行，之后 `--resume` 报 `the session header is missing or malformed`，会话坏了。所以删之前先问 `omp session lease --json -- <id>`（只观察、不占用，输出 `{"held":[...],"unknown":[...]}`），占着就拒绝 |

所以 studio 的判据不是 `Session deleted` 这行字，而是会话文件真的不在了（`TspCommands.deleteSession`）。删除失败的提示带 omp 的原话（`task.deleteFailed`）。

没覆盖到的：问租约和临时 omp 发 `/delete` 之间（临时 omp 启动的那一两秒）终端里又打开了这个会话，仍会碰上上表最后一行（omp 不给原子操作）；studio 自己的任务有进程时不问租约（占着的就是它自己）。

## 测试

`test/session-index.test.ts`：路径含空格和中文；标题槽/旧格式/字符串内容；截断前缀；损坏、空、非会话文件计数；超长首条消息；缓存失效和删除；Windows 路径大小写；`resolveAgentDir`。`test/sidebar-model.test.ts`：分组排序、重名项目标签、等你确认跳转、状态点形状、模糊匹配、面板分组。
`test/e2e/sidebar.e2e.ts`：侧栏键盘、归档撤销、命令面板、已归档会话和任务菜单的"删除会话…"与确认框（主进程的删除换成桩）。
`test/task-pool.test.ts`「会话文件在 omp 里被删了」「删除会话」：对账的各个条件、有进程 / 没进程 / 已归档 / 终端会话的删除（假 omp 收到 `/delete` 删文件，`FAKE_TSP_DELETE_FILE`）、租约被占时拒绝；`test/session-delete.test.ts`：`omp session lease` 输出、警告行、"不在"的错误码。

## 会话信息、请求记录、置顶、分享、重试（omp 18.12.5）

界面见 spec §4.31。代码：`src/main/session-info/`（`session-header.ts`、`session-pins.ts`、`session-stats.ts`、`share.ts`）、`src/main/ipc/session-info-handlers.ts`、`src/shared/omp-output/share.ts`、`src/shared/tsp/error-turn.ts`、`src/shared/ui/session-trace.ts`、`src/renderer/src/features/session-info/`。

### 数据来源（都只读，写入只经 omp）

| 要什么 | 来源 | 备注 |
|---|---|---|
| 会话头 | 会话文件前缀里的 `type:"session"` 行 | 字段 id、version、timestamp、cwd、title、parentSession、additionalDirectories |
| 置顶 | `<agentDir>/session-pins.json`（会话 id 数组） | 实测：`/pin` 很快写入，id 是会话头的 id；再发一次 = 取消。文件缺失 = 无置顶；格式不认识 = 无置顶并记 WARN |
| 用量 | 会话文件（`readSessionUsage`，和输入框同口径，见下「TSP 任务的 `sessionUsage`」） | 不读 stats.db 的 `session_rollup`：它只在 `omp stats` 运行时更新，进行中的会话是旧的 |
| 请求记录 | `stats.db.messages`（最近 `TRACE_LIMIT` 条）+ `tool_calls` 按 entry_id 挂上 | 表结构实测自本机 omp 18.12.5 的库；duration / ttft 为毫秒 |

`session_file` 在库里是 omp 写库时的路径原文：先精确匹配 `path.resolve` 后的值，Windows 上没命中再不分大小写和斜杠方向。`stats.db` **只在 `omp stats` 运行时同步**（omp-usage.md），所以请求记录先读现有库、同时让 omp 同步一次（`syncStatsDb`，和用量页共用，同一时间只跑一个）再重读；同步失败只提示。

### IPC（`ipc.ts`，参数全部校验，路径由主进程按任务 id 查表）

`getTaskSessionInfo(taskId, refresh)`、`getTaskSessionTrace(taskId, refresh)`、`getShareSettings(taskId)`（`omp config list --json` 在任务目录下读 share.*）、`shareTask(taskId, gist)`。置顶切换和重试走 `runTaskCommand {kind:"pin"|"retry"}`。`listSessions` 的 `SessionSummary.pinned` 来自置顶文件。

### 置顶（`/pin`）

TSP 实测：`/pin` 的 toast 是 `Session pinned to the top of the resume list.` / `Session unpinned.`。studio 切换前后各读一次置顶文件，状态没变就把 omp 的原话当警告显示；变了就重取 `listSessions`，侧栏跟着重排。

入口：会话信息对话框、`/pin`、命令面板、任务菜单的"置顶 / 取消置顶"（状态取挂在这个任务上的会话的 `pinned`，`use-history-sessions.ts` 的 `useTaskPinned`）。`sidebar-model.ts` 给每一行算 `pinned`，排序规则见 spec §1.2「任务排序」；行上画图钉。没挂在任务上的历史会话没有置顶入口：`/pin` 要在 omp 进程里跑，先恢复成任务再置顶。

### 分享（`omp share <文件> [--gist]`）

**会上传**，所有者 2026-10-21 定：先弹确认框（服务器、是否脱敏、gist 选项）。输出格式用**本机 127.0.0.1 的假 share 服务器**实测，没有连任何真实服务器：成功退出码 0、stdout `Share URL: <server>/<id>#<key>`；失败退出码 1、stdout 空、stderr 是 Bun 堆栈加一行 `error: Share upload to … failed: …`。`parseShareOutput` 认 `Share URL:` / `Gist URL:` 标签，只接受 http(s)，认不出时界面显示 omp 原文。**没实测**：`--gist` 的输出、截断说明行、`share.redactSecrets` 的效果。

### 请求记录页"在浏览器中打开"（omp 18.12.6）

实测 omp `/trace`（TSP）：在任务进程里起统计服务（已有则复用），**omp 自己打开浏览器**，状态 toast `Trace: http://127.0.0.1:3847/#/traces?s=…`，对话里不加节点。选它而不是 `omp stats`：后者要 studio 管一个长驻进程，且会再打开一个根页面标签。`TaskCommand { kind: "trace" }`，任务运行中按钮禁用；studio 自己不开链接（会出两个标签）。录制 `fixtures/tsp/trace-link.jsonl`。

### 重试（`/retry`）

实测（`fixtures/tsp/error-turn.jsonl`，无效 key → 401）：错误卡是 `omp.assistant` 里的 `card role=omp.error`，**没有重试动作**；发 `/retry` 成功时**不发 toast**，直接重跑这一轮。所以 TSP 的 `retry` 走"安静命令"（出现新 toast 才算失败，如 `Nothing to retry`）。重试按钮只挂在 `trailingErrorCardId` 选出的收尾错误卡上。

### 历史状态

口径对齐 omp `session-listing.ts`（omp 18.12.6）：completed / error / aborted / interrupted（length、内容里有 toolCall、最后是工具结果）/ pending（最后是用户消息）/ 认不出 null。侧栏画 completed、error、interrupted，aborted 和 pending 不画。

### TSP 任务的 `sessionUsage`

omp 的 TSP 输入框卡片只给费用。token 分项和请求数由 `TspRunner.#refreshTotals` 在费用变化时从**会话文件**读（`totalUsage`，范围同 get_session_stats），不用 `session_rollup`（进行中的会话是旧的）。

**范围的规则**（`src/main/history/session-usage.ts`，照 omp 18.18.5 源码对齐）：get_session_stats = 内存里对话的 assistant 消息 + 当前分支窗口内的 `model_usage` 记录（`packages/coding-agent/src/session/session-stats.ts` `forEachActiveModelUsage`）。

- `model_usage`：不进对话的模型调用（后台作业、标题、缓存预热等），`usage` 和 assistant 消息同形。带 `cacheRefresh` 的也算；studio 每条记一个请求（omp `stats.db` 也是一条一行）。
- **按分支**，不是整个文件：只算从叶子沿 parentId 走到根这条链上的。迟到的用量挂在发起时的位置、带 `activeLeafId`，不在当前分支上，不算。
- **叶子**照 omp 回放（`session-entries.ts` `resolveSessionLeafId`）：最后一条带 `activeLeafId` 就取它（`null` 为没有叶子；指向的记录不在时取最后一条不带 `activeLeafId` 的），否则取最后一条本身。直接取最后一条会在它是迟到的用量时截短当前分支。
- **窗口**：最近一次压缩之后有 `/clear` 留下的 `reset_boundary` 就从它之后起；否则从最近一次压缩的 `firstKeptEntryId` 起，再往前带上紧挨着的非消息记录。assistant 消息用同一个窗口。`whole`（含压缩前的合计）只在压缩过时给。
- **没跟**：get_session_stats 还加上 `task` 工具结果里子代理的用量（studio 的费用段把子代理单独写）；恢复会话时 omp 重建对话会去掉没有结果的工具调用、丢掉以 error / aborted 结束的 assistant 消息，这些消息的用量 omp 恢复后不算，studio 算。

实测（omp 18.18.5，会话副本 `omp --mode rpc --resume <副本>` 只发 `get_session_stats`，原文件只读）：三个带 `model_usage` 的会话 token 分项和费用逐项相等（含分支上 / 不在分支上的用量、压缩两次的会话）；一个 `/clear` 过的会话只差一条内容全是没有结果的工具调用的 assistant 消息（上面"没跟"的第二条）。

**增量读**（`src/main/tsp/session-file-reader.ts`）：真实会话文件常见 30–150 MB，整份读一次会阻塞主线程上百毫秒、占上百 MB 临时内存，所以每个文件一个 `SessionFileReader`，只读上次位置之后追加的字节，按 `\n` 切行、每行 `JSON.parse` 一次，同时喂用量累加器（`SessionUsageAccumulator`）和每轮脚注累加器（`SessionExtrasAccumulator`）。没有 `\n` 结尾的最后一行留到下次（omp 每个条目都带换行写入）；文件变短、或上次位置之前的末尾字节变了（被重写）就清空累加器从头读。实测（Node 24，本机会话文件副本）：55 MB 首次约 230 ms（分块读，事件循环最长被占约 5 ms）、追加一行约 8 ms。

- **用量一个文件一个读取器**（`src/main/tsp/session-files.ts`）：任务自己和 `readSessionUsage` 共用一个 `SessionReaderCache`，一遍读取同时喂两个累加器。任务用 `holdSessionFile` 占住当前会话文件的读取器（不会被别的文件挤掉后从头再读）；没被占住的（历史会话、已归档任务）按文件留最近几个。不做"不解析就跳过某些行"：用量要每一条带 id 的记录（沿 parentId 走分支）。
- 会话树（`readSessionEntries`）用 `session-tree-file.ts` 自己的、不被占住的缓存：树的累加器留着用户消息的整条内容（含图片 base64），放进任务一直占着的读取器里内存会随碰过的会话一直涨；代价是打开会话树时这个文件再读一遍。树的累加器只留用户消息、压缩点、分支摘要、标签条目的内容，其余条目只留 type / id / parentId。
- `readSessionUsage` 和 `readSessionEntries` 有同一个文件大小上限（`session-file-reader.ts` 的 `MAX_SESSION_FILE_BYTES`），超过抛错。

### 测试

`test/session-stats.test.ts`（临时 `stats.db` 夹具，表结构抄自 omp）、`session-info-files.test.ts`（置顶、会话头）、`session-share.test.ts`（分享输出、假 omp）、`session-trace.test.ts`、`tsp-error-turn.test.ts`（逐帧回放）、`session-usage.test.ts`、`session-files.test.ts`（任务和用量共用一个读取器）、`session-index.test.ts`（pinned）、`sidebar-model.test.ts`（置顶排序）。

没有在真实 omp 里验证 TSP `/retry` 经 `runQuietCommand` 的端到端。
