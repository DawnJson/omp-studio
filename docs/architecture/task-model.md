# 任务模型和运行时

实现：`src/main/tasks/`（`task-registry`、`task-machine`、`task-runner`、`task-pool`、`event-batcher`、`translate`、`dialogs`、`runtime`），`src/main/omp/{launch,launch-args,session-init}.ts`，`src/main/platform/win32/{ffi,job-object}.ts`，`src/main/ipc/task-handlers.ts`。omp 行为结论均在 18.12.1 上实测（`fixtures/rpc/` 在这个版本重录）。

## 一个任务

一个任务 = 一个项目目录 + 一个 omp 会话 + （存活时）一个 omp 进程。进程可被回收，任务和会话不会：再打开任务时起新进程，`switch_session` 回到同一个会话文件。

- 持久化：`userData/tasks.json`（`TaskRegistry`，先写临时文件再改名，写盘串行）。`tasks.json` 损坏时 `load` 抛错，不当成空表覆盖。重命名和归档存这里。改名同时走 omp 自己的命令：任务有进程时发 `set_session_name`，没有进程（stopped / 被回收）时记在内存里，下次握手后补发；omp 推来 `session_info_update`（`/rename` 或 omp 自己改了会话名，带 `title`）时用同一条保存路径更新任务标题（标题相同或为空则忽略，避免回声）。不手写 `~/.omp` 里的会话文件（决策 9）。
- 记录字段：`id, projectId, sessionFile|null, title, createdAt, updatedAt, archived, model, thinkingLevel, worktreePath`（恒 null）。
- `sessionFile` 在第一轮（`prompt_result`）或恢复之后才写入：新会话的文件在第一条 assistant 消息后才落盘，之前 `get_state` 给的路径不能存。实测 18.12.1：`get_state.sessionFile` 在握手后、首轮前就有值。
- 新任务标题是 `""`；第一次 `sendPrompt` 取首条消息第一行（60 字符）；`resume` 时 title 为 null 则载完历史后取第一条用户消息。
- 审批模式不在任务里存：启动时从不传 `--approval-mode`，omp 读自己配置里的 `tools.approvalMode`（启动时读一次）。输入框胶囊改的是 omp 配置（`omp config set`），之后启动的任务生效。
- 归档：关进程，记录保留 `archived:true`；`TaskPool.resume()` 找到同一会话文件的任务会把它恢复成未归档（同一 id）。
- 分叉 / 回溯（`docs/architecture/session-tree.md`）：`TaskPool.forkTask` 新增一条任务记录，`sessionFile` 是 omp `branch` 新建的文件，同项目、同 cwd（worktree 任务的分叉共用同一个 worktree，所以 `discardWorktree` 在还有别的任务（含已归档的）用它时拒绝）、同模型；原任务的会话文件和进程会话不变。`branchTask`（会话树面板选中）是就地回溯：任务的 `sessionFile` 改成 `branch` 新建的文件，原文件留在磁盘上。两者都只在任务空闲（没有在途命令、`!命令`、`/btw`）时做，否则 `SessionBusyError`；期间 `TaskRunner` 的 `#sessionOp` 让别的命令经 `#awaitSessionIdle()` 等着、`get_state` 的应答不写进记录。
- `messageId` 只在进程内唯一：消息键 `${gen}:${messageId}`，`gen` 每次 spawn 递增；历史消息键 `h:<序号>`。

## 启动序列

`start()`：`acquireSlot` → `buildLaunch`（`--mode rpc-ui [--model] [--thinking] [--allow-home]`，cwd = 项目目录，env = 进程环境 + `getApiKeyEnv()`）→ `OmpConnection.spawn` → 同一个同步段里挂 `onFrame` 并 `assignToAppJob(pid)` → `ready`（含 v2 协商）→ `initializeSession`：

`set_event_filter {events:null, messageUpdates:"delta"}` → `set_ask_dialog {enabled:true}`（失败保留 select+editor 回退）→ `set_subagent_subscription {level:"progress"}` → [`switch_session`] → `get_state` → `get_available_thinking_levels`。恢复时再 `get_messages_page`（limit 256，按时间正序，翻到没有 `nextCursor`）；已有快照的任务（回收后再打开）跳过历史，免得丢工具执行细节。

录制脚本和应用共用 `initializeSession`，所以 fixture 里的 `in` 帧顺序和应用一致。实测 18.12.1：`set_event_filter` 应答带 `messageUpdates:"delta"`，`set_ask_dialog` 成功。

启动失败的 `TaskError.kind`：`omp_unavailable`（`getOmpExecutable` reject）、`spawn_failed`、`handshake_failed`（握手或初始化命令失败，附 stderr 末 8 行）、`restore_model_failed`（`switch_session` 报 `Could not restore model`）。进程意外退出 `exited`，帧解码错误 `protocol`。

## 状态机

纯函数 `transition(state, input)`（`task-machine.ts`），`test/task-machine.test.ts` 逐条覆盖：

| 输入 | 效果 |
|---|---|
| `start` | stopped/error → starting（清错误） |
| `ready` | starting → idle |
| `start_failed` / `failed` | error，清空对话框 |
| `prompt_accepted {agentInvoked}` | `agentInvoked:false` 不动；否则 working=true |
| `prompt_rejected` | 状态不变，`lastTurn = error` |
| `agent_start` | working=true（后台任务唤醒也算） |
| `prompt_result` | 写 `lastTurn`；`sessionSettled:true` 时 working=false；不在前台置 `unread` |
| `session_settled` | working=false |
| `dialog_open` / `dialog_close` | 维护 `dialogs[]`，非空即 `needs_you`；清空后按 working 回 running/idle |
| `stopped` | 主动关闭 → stopped（不是 error） |
| `mark_read` | 清 unread；`lastTurn` 为 error 时清掉 |

状态 = 有对话框 ? needs_you : working ? running : idle（starting/error/stopped 由生命周期输入决定）。

**竞态**：`prompt` 的应答和后面的 `prompt_result`/`session_settled` 可能在同一个数据块里被同步处理，而 `await request("prompt")` 的续体晚于它们才运行。若续体再设 working=true，任务会卡在 running。所以 runner 用 `settleEpoch` 计数：发送前记下，续体里只在没有 settle 过时才应用 `prompt_accepted`（`agent_start` 本身已经让任务进 running）。

## 对话流

`translateFrame(frame, gen, at)`（纯函数）把帧译成 `TranscriptEvent`：去掉 `message_update` 里的 `partial`（delta 模式本来没有），丢 `toolcall_delta`；`extension_error`/`rpc_frame_error` 变 `notice`；compaction/retry 变 `status_line`；`subagent_lifecycle` 变 `subagent`。语义与 `test/transcript.test.ts` 里的假主进程一致。

`EventBatcher`：每任务一个。16 ms 或 64 个事件推一批；批内合并相邻同消息同 `contentIndex` 的 `text_delta`/`thinking_delta`，同 `toolCallId` 的 `tool_update` 只留最后一个。**快照只反映已推送的批次**（合并后的事件数才是 `seq`），`snapshot()` 先冲刷再返回，所以 `getTranscript` 的 `seq` 和渲染进程累计应用的事件数一致。状态变化（`dialog`、`prompt_result`、`settled`、`agent_start`）先冲刷对话流再推 `taskState`。

回收后的任务保留快照，已停止的任务最多留 10 份（LRU），更久的 `reset()` 释放，再打开时从会话文件恢复历史。

## 上下文使用率和状态刷新

`get_state` 在 assistant `message_end`、`agent_end`、`auto_compaction_end`、`notice` 后调一次，同一任务 1 秒内最多一次；`prompt_result`、`session_settled`、`model_changed`、`thinking_level_changed`、`config_update` 立即刷新；本地完成的斜杠命令（`prompt` 应答 `agentInvoked:false`，如 `/fast`、`/slow`）和 `set_fast_mode` / `set_slow_mode` 之后也立即刷新。刷新同时更新 `contextUsage`、模型、思考档位、队列、`todoPhases`（待办阶段，原样搬进 `TaskState.todoPhases`；todo 工具的 `tool_execution_end`（工具名含 todo）和 `todo_auto_clear` 也会触发一次节流刷新）、回收判据（`isSettled && !hasPendingAsyncWork`）、`sessionFile`，以及 `fastMode` / `slowMode` / `usageLimit` / `tokensPerSecond`（`tasks/session-extras.ts` 的纯映射；实测 `tokensPerSecond` 在流式输出期间为 null，回复结束后才有值，所以靠 `message_end` 的节流刷新就够，不另外轮询）。`queue_update` 直接更新队列 chip。

## 进程上限和回收

- `maxLiveProcesses`（设置，默认 6）是软上限。起新进程时存活数（含 starting）已到软上限：回收最久未用的**可回收**任务（idle、无对话框、`get_state` 报告已安静、不是前台）；没有可回收的就超出软上限照起，到硬上限（× 2）才失败，任务进 error（`spawn_failed`，"too many tasks…"）。
- 定时回收：`sweep(now)` 每分钟跑一次，可回收状态持续 15 分钟关进程；`now` 由调用方传入，测试不依赖真实时钟。
- `shutdown()`：并行 `close(5000)`（关 stdin，超时按进程树 `taskkill /T /F`）。退出路径只有 Shell 的 `before-quit`：`runtime.ts` 用 `registerShutdownHook(() => pool.shutdown())` 接入。
- 窗口 × 不退出：窗口只隐藏（`hide-on-close.ts`），任务池、状态机和 omp 子进程都不受影响，应用常驻托盘（决策见 `background-run.md`）。`sweep` 照旧只回收 idle 且已安静的任务，正在跑和等你确认的任务不会被收；窗口隐藏期间的状态变化照常经 `taskState` 事件推给（隐藏的）渲染进程，并刷新托盘的提示和菜单。真正的退出入口（托盘"退出"、应用菜单退出、安装更新、系统注销）才会走上面的 `shutdown()`。

## 进程树兜底（Job Object）

`job-object.ts`：第一次用时建应用级 Job，只设 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`，不设任何 breakaway；每个 omp 进程 spawn 后同步 `OpenProcess` + `AssignProcessToJobObject`。koffi 调用全在 `ffi.ts`（kernel32 / advapi32 / user32，一次写全；E 的 `user-path.ts` 用同一个）。

实测（`test/job-object.test.ts`，Node 24.13 / Windows 11，用 `test/fake-omp/job-host.ts` 当"主进程"并强杀它）：

- 放进 Job：fake-omp 和它的 detached 孙进程都在 5 秒内消失。
- 不放进 Job（对照）：fake-omp 随主进程消失（libuv 的全局 Job），孙进程留下。
- 所以 arch 6.4 的推测成立：libuv 的 Job 只管直接子进程，孙进程脱离它；我们的无 breakaway 嵌套 Job 把整棵树兜住。`IsProcessInJob` 验证了分配生效。
- 注意：fake-omp 的孙进程必须 `detached`，否则它进了 fake-omp 自己的 libuv Job，fake-omp 一死孙进程就跟着没了，测试发现不了残留。
- 没验证：真实 omp（Bun）的 bash 工具运行中强杀主进程；spawn 和 assign 之间的竞争窗口只能靠"ready 之前 omp 不起工具进程"的推测。非 Windows 上 `assignToAppJob` 是空操作。

## 对外接口

`getTaskPool(): Promise<TaskPool>`（`runtime.ts`）。`TaskPool` 除 20 个 IPC 函数的对应方法外：`listSessionLinks()`、`ensureProject(cwd)`、`resume({sessionFile, cwd, projectId, title})`（供历史列表）、`sweep(now)`、`shutdown()`。测试注入：`STUDIO_TEST_OMP`（JSON `{command,args}`，仅未打包）。
