# 任务模型和运行时

实现：`src/main/tasks/`（`task-registry`、`task-machine`、`tsp-runner`、`task-pool`、`gate-notifier`、`runtime`），`src/main/tsp/`（`tsp-session`、`stream`），`src/main/omp/{launch,launch-args}.ts`，`src/main/platform/win32/{ffi,job-object}.ts`，`src/main/ipc/task-handlers.ts`。omp 行为结论在 omp 18.12.5 上实测（TSP 协议和节点见 [tsp-migration.md](tsp-migration.md)）。

## 一个任务

一个任务 = 一个项目目录 + 一个 omp 会话 + （存活时）一个 omp 进程。所有任务都是同一种：交互式 `omp` 跑在伪终端里（node-pty，`useConptyDll: true`），界面是 omp 发来的 TSP 节点树。进程可被回收，任务和会话不会：再打开任务时起新进程，`omp --resume=<会话文件>` 回到同一个会话。

- 持久化：`userData/tasks.json`（`TaskRegistry`，先写临时文件再改名，写盘串行）。`tasks.json` 损坏时 `load` 抛错，不当成空表覆盖。重命名和归档存这里。
- 记录字段：`id, projectId, sessionFile|null, title, createdAt, updatedAt, archived, model, thinkingLevel, worktreePath, worktreeBranch, worktreeBase`，分叉出的任务另有 `forkFrom`。`updatedAt` 只由用户发消息和一轮结束写入（侧栏按它排序，改名、存会话文件、归档等记账写入不碰它）。
- 读老记录：`load` 丢掉记录里已经没有意义的 `engine` 字段，其余原样保留；下次保存时落盘。设置文件里残留的 `taskEngine` 在下次写设置时丢掉（`sanitize` 只认已知字段）。
- `sessionFile`：omp 在启动时就用 `OSC 1337 SetUserVar=omp_session_file=<base64 路径>` 报出路径，但新会话的文件要到第一条回复之后才落盘，所以只在文件存在时才记进任务，并在回合结束、进程退出、关闭时重试。
- 标题：新任务标题是 `""`；第一次 `sendPrompt` 取首条消息第一行（60 字符）；omp 的 OSC 0/2 标题去掉私有区图标后只在"记录里标题为空、是草稿第一句话临时取的、或是上一次采用的 omp 标题"时才覆盖，用户改过名就不再动。**改名只改本地记录**：交互模式没有从外部改会话名的入口，往输入框塞 `/rename` 会混进用户的草稿。不手写 `~/.omp` 里的会话文件。
- 审批模式不在任务里存：启动时从不传 `--approval-mode`，omp 读自己配置里的 `tools.approvalMode`（项目 `.omp/config.yml` 盖过全局，见 [omp-settings.md](omp-settings.md)「审批模式」）。
- 归档：关进程，记录保留 `archived:true`；`TaskPool.resume()` 找到同一会话文件的任务会把它恢复成未归档（同一 id）。
- 分叉 / 回溯见 [session-tree.md](session-tree.md)：`TaskPool.forkTask` 新增一条记录，`forkFrom` 记要 `omp --fork` 的原会话文件，新会话文件一落盘就记进 `sessionFile` 并清掉它（worktree 任务的分叉共用同一个 worktree，所以 `discardWorktree` 在还有别的任务（含已归档的）用它时拒绝）；回溯不换会话文件。

## 启动

`TspRunner.start()`：状态机 `start` → worktree 目录还在吗（不在：`worktree_missing`）→ `acquireSlot`（进程上限，见下）→ `buildLaunch`（`--resume=<会话文件>` 或 `--fork=<forkFrom>`、`--model`、`--thinking`、`--allow-home`，cwd = 任务目录，env = 进程环境 + `getApiKeyEnv()` + `TERM_PROGRAM=tern` 等）→ `TspSession.start`（node-pty 起进程、回 `hello`、按信用值回 `ack`，细节见 [tsp-migration.md](tsp-migration.md) §7）→ 等握手 → 状态机 `ready`，随后立刻对当前文档同步一次状态（omp 可能在回复 hello 之前就已经发了第一批帧）。

启动失败的 `TaskError.kind`：`omp_unavailable`（找不到 omp）、`spawn_failed`、`worktree_missing`；进程意外退出 `exited`。失败时状态是 `error`，promise 也 reject。`STUDIO_TEST_OMP`（JSON `{command,args}`，仅未打包）替换整条命令，e2e 和单测用它跑 `fake-tsp-omp`。

## 状态机

纯函数 `transition(state, input)`（`task-machine.ts`），`test/task-machine.test.ts` 逐条覆盖：

| 输入 | 效果 |
|---|---|
| `start` | stopped/error → starting（清错误） |
| `ready` | starting → idle |
| `start_failed` / `failed` | error，清空 `dialogs` |
| `agent_start` | working=true |
| `prompt_result` | 写 `lastTurn`（`completed` / `aborted` / `error`），working=false；不在前台置 `unread` |
| `dialog_open` / `dialog_close` | 维护 `dialogs[]`，非空即 `needs_you`；清空后按 working 回 running/idle |
| `stopped` | 主动关闭 → stopped（不是 error） |
| `mark_read` | 清 unread；`lastTurn` 为 error 时清掉 |

状态 = 有 `dialogs` ? needs_you : working ? running : idle（starting/error/stopped 由生命周期输入决定）。输入从文档推导，不是 omp 发的事件：`shared/tsp/task-status.ts` 的 `deriveTaskStatus` 看 dock 里有没有运行状态行（`omp.working` / `omp.working.stop` / `omp.composer.stop`，出现 = `agent_start`，消失 = `prompt_result`）和提问 / 审批节点（`omp.editor.ask*` = 门，主进程为它合成一个 `confirm` 型的 `DialogRequest`，见 [dialogs.md](dialogs.md)）。用户按过停止的那一轮 `lastTurn` 记为 `aborted`，哪怕之后 omp 又继续跑完。依据是 `fixtures/tsp/{task,approval,ask}.jsonl` 逐帧（`test/tsp-task-status.test.ts`）；主区里的 spinner 和 `omp.hud.activity`（待办面板，回合结束后还在）不可靠，不用。

## 输入框上的状态从哪来

模型、思考强度、上下文占用、费用不是命令的应答，而是从 omp 输入框卡片上的节点读（`shared/tsp/composer-state.ts`，`TspRunner` 每次文档变化调用，变了才发布）：`omp.composer.model`、`omp.composer.model.effort`、`omp.composer.context`（meter）、`omp.composer.usage`。对照表在 [tsp-migration.md](tsp-migration.md) §10.2。待办阶段从 dock 里 `omp.hud.todo` 的 checklist 换算成 `TaskState.todoPhases`（`shared/tsp/todos.ts`）。输入框被提问 / 审批替换的那几帧读不到，沿用上一次的值。

omp 不给的数据从会话文件补（只读，不写 `~/.omp`）：每轮的用量脚注、最近一条回复的输出速度、上下文构成里系统提示词和工具定义的 token 数、每轮费用、按模型的累计用量，见 `src/main/tsp/session-extras.ts`、`turn-costs.ts` 和 [tsp-migration.md](tsp-migration.md) §10.1。

## 进程上限和回收

- `maxLiveProcesses`（设置，默认 6）是软上限。起新进程时存活数（含 starting）已到软上限：回收最久未用的**可回收**任务；没有可回收的就超出软上限照起，到硬上限（× 2）才失败，任务进 error（`spawn_failed`，"too many tasks…"）。
- 可回收（`TspRunner.recyclable`）：有进程、状态 idle、没有未答的门、文档里没有还在跑的 `tool` / `agent` 卡片（转到后台的任务）、没有在跑的旁路提问（`/btw`）；前台任务由池排除。
- 定时回收：`sweep(now)` 每分钟跑一次，可回收状态持续 15 分钟（`IDLE_RECYCLE_MS`）关进程；`now` 由调用方传入，测试不依赖真实时钟。
- 回收后的任务保留最后一份节点树快照，已停止的任务最多留 10 份（LRU），更久的释放，再打开时 `--resume` 由 omp 重发整段对话。
- `shutdown()`：并行 `close(5000)`（先 `taskkill /T /F` 进程树，再 `pty.kill()`）。退出路径只有 Shell 的 `before-quit`：`runtime.ts` 用 `registerShutdownHook(() => pool.shutdown())` 接入。
- 窗口 × 不退出：窗口只隐藏（`hide-on-close.ts`），任务池、状态机和 omp 子进程都不受影响，应用常驻托盘（决策见 [background-run.md](background-run.md)）。`sweep` 照旧只回收 idle 且已安静的任务；窗口隐藏期间的状态变化照常经 `taskState` 事件推给（隐藏的）渲染进程，并刷新托盘的提示和菜单。真正的退出入口（托盘"退出"、应用菜单退出、安装更新、系统注销）才会走上面的 `shutdown()`。

## 进程树兜底（Job Object）

`job-object.ts`：第一次用时建应用级 Job，只设 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`，不设任何 breakaway。任务的 omp 进程在 pty 里，用 `assignToOwnJob`（和内置终端一样：每个 pty 进程放进自己的 Job，关的时候一起收）；后台服务进程用 `assignToAppJob`（应用级 Job）。koffi 调用全在 `ffi.ts`（kernel32 / advapi32 / user32，一次写全；`user-path.ts` 用同一个）。

实测（`test/job-object.test.ts`，Node 24.13 / Windows 11，用 `test/fake-omp/job-host.ts` 当"主进程"并强杀它）：

- 放进 Job：fake-omp 和它的 detached 孙进程都在 5 秒内消失。
- 不放进 Job（对照）：fake-omp 随主进程消失（libuv 的全局 Job），孙进程留下。
- 所以 libuv 的 Job 只管直接子进程，孙进程脱离它；我们的无 breakaway 嵌套 Job 把整棵树兜住。`IsProcessInJob` 验证了分配生效。
- 注意：fake-omp 的孙进程必须 `detached`，否则它进了 fake-omp 自己的 libuv Job，fake-omp 一死孙进程就跟着没了，测试发现不了残留。
- 没验证：真实 omp（Bun）的 bash 工具运行中强杀主进程；spawn 和 assign 之间的竞争窗口只能靠"ready 之前 omp 不起工具进程"的推测。非 Windows 上 Job 相关调用是空操作。

## 对外接口

`getTaskPool(): Promise<TaskPool>`（`runtime.ts`）。`TaskPool` 的方法对应 `ipc.ts` 里任务相关的 IPC 函数（`createTask`、`openTask`、`sendPrompt`、`stopTask`、`compactTask`、`runTaskCommand`、`getSessionTree`、`forkTask`……，渲染进程只传 id 和封闭的参数），另有 `listSessionLinks()`、`ensureProject(cwd)`、`resume({sessionFile, cwd, projectId, title})`（供历史列表）、`sweep(now)`、`shutdown()`。`openTask` 只负责拉起进程，不返回对话内容：对话是节点树，渲染进程按 `getTspSnapshot` + `tspBatch` 同步（[tsp-migration.md](tsp-migration.md) §8）。

测试：`test/task-pool.test.ts`、`test/task-tsp.test.ts`、`test/task-tsp-tree.test.ts`、`test/task-tsp-btw.test.ts`、`test/task-registry.test.ts`、`test/task-machine.test.ts`（都跑 `fake-tsp-omp` 回放 `fixtures/tsp/*.jsonl`）；真实 omp 冒烟 `test/task-real-omp.test.ts`（`STUDIO_REAL_OMP=1`）。
