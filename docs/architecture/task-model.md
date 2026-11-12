# 任务模型和运行时

实现：`src/main/tasks/`（`task-registry`、`task-machine`、`tsp-runner`、`task-pool`、`gate-notifier`、`runtime`），`src/main/tsp/`（`tsp-session`、`stream`），`src/main/omp/{launch,launch-args}.ts`，`src/main/platform/win32/{ffi,job-object}.ts`，`src/main/ipc/task-handlers.ts`。omp 行为结论在 omp 18.12.5 上实测（TSP 协议和节点见 [tsp-migration.md](tsp-migration.md)）。

## 一个任务

一个任务 = 一个项目目录 + 一个 omp 会话 + （存活时）一个 omp 进程。所有任务都是同一种：交互式 `omp` 跑在伪终端里（node-pty，`useConptyDll: true`），界面是 omp 发来的 TSP 节点树。进程可被回收，任务和会话不会：再打开任务时起新进程，`omp --resume=<会话文件>` 回到同一个会话。

- 持久化：`userData/tasks.json`（`TaskRegistry`，先写临时文件再改名，写盘串行）。`tasks.json` 损坏时 `load` 抛错，不当成空表覆盖。重命名和归档存这里。字段见 `TaskRecord`。`updatedAt` 只由用户发消息和一轮结束写入（侧栏按它排序，改名、存会话文件、归档等记账写入不碰它）。
- 读老记录：`load` 丢掉已无意义的 `engine` 字段，其余原样保留；设置里残留的 `taskEngine` 由 `sanitize` 在下次写设置时丢掉。
- `sessionFile`：omp 启动时就用 `OSC 1337 SetUserVar=omp_session_file=<base64 路径>` 报出路径，但新会话的文件要到第一条回复之后才落盘，所以只在文件存在时才记进任务；每批帧、回合结束、进程退出、关闭时都重试。必须在第一轮进行中就记上：否则会话列表（`SessionSummary.taskId` 按记录里的会话文件匹配）把它当另一条列出，点开后再 `--resume` 同一个文件，omp 发现文件被占就分叉，侧栏出现两条同名任务（见 [session-history.md](session-history.md) 「终端正在使用同一个会话时恢复」；`test/task-tsp.test.ts`「一轮进行中」；真实 omp 18.12.6 实测还在 running 时就记上了）。
- 一个会话文件最多挂在一个任务上（issue #11）：`TaskRegistry.addTask` / `updateTask` 遇到别的任务已经挂着的 `sessionFile`（按 `pathKey` 比，Windows 上不分大小写、不看斜杠写法）抛 `SessionFileTakenError`。`resume` / `archiveSession` 先按会话文件找已有任务，不会撞上；omp 在进程里换到了别的任务的会话（omp 里 `/resume` 了它）时，`TspRunner.#persistSessionFile` 记一条 WARN，这个任务的记录保持原来的文件，同一个文件不再重试。两个任务挂同一个文件就会对同一个会话起两个 omp，后写的那个被 omp 分叉成新文件。
- 标题：新任务标题为空；第一次 `sendPrompt` 取首条消息第一行（`convert.ts`）；之后以 omp **记在会话文件里的标题**为准：omp 每次定标题（自动生成、`/rename`）都在文件末尾追加 `{"type":"title_change","title":…}`（omp 18.16.0 实测），`SessionTitleTracker`（`tsp/session-files.ts`）取最后一条，只在"记录里标题为空、是草稿第一句话临时取的、或是上一次采用的 omp 标题"时才覆盖，用户改过名就不再动。
  - **终端标题（OSC 0/2）不当标题**：Windows 上 ConPTY 把伪终端里任何程序改的控制台标题都转发成 OSC 0，omp 跑的 cmd、PowerShell 会把它改成 `C:\WINDOWS\system32\cmd.exe` 之类（issue #8）。OSC 标题只用来取 ` · #12` 的 PR 号，且只认去掉后缀后和会话文件标题一致（或是占位 `omp`）的那条；收到 OSC 标题时和每轮结束时读会话文件。
  - **误存的控制台标题自动换掉**（issue #9）：`looksLikeConsoleTitle`（`shared/ui/clean-title.ts`）识别；`TaskPool.init` 对这样的记录（含已归档的）读会话文件头换成 omp 的标题，没有就用首条消息首行，再没有（含会话文件已不在）就留空；读不了的只记日志、原样保留。分叉不沿用控制台标题。
  - **改名只改本地记录**：交互模式没有从外部改会话名的入口，往输入框塞 `/rename` 会混进用户的草稿。不手写 `~/.omp` 里的会话文件。
- 审批模式不在任务里存：启动时从不传 `--approval-mode`，omp 读自己配置里的 `tools.approvalMode`（项目 `.omp/config.yml` 盖过全局，见 [omp-settings.md](omp-settings.md)「审批模式」）。
- 归档：关进程，记录保留 `archived:true`；`listSessionLinks` 带上 `archived`，已归档任务的会话只在侧栏的"已归档"里列出（issue #9），点开走 `TaskPool.resume()`，找到同一会话文件的任务会把它恢复成未归档（同一 id）。终端里开的历史会话也能归档（`TaskPool.archiveSession`：建一条已归档记录，不起进程）。
- 从列表移除项目：只设 `Project.hidden`（`TaskRegistry.setProjectHidden`），任务不动；`addProject`（打开文件夹）、`ensureProject`、在里面新建任务和恢复会话时清掉（issue #9）。
- 会话文件被删（在 omp 的会话列表里删的）：**对账**（issue #10，仓库所有者定，2026-11-10）：启动后（`runtime.ts`）和每次重扫会话列表时（`listSessions`）在后台跑 `TaskPool.pruneMissingSessions`，同时满足这些的任务记录直接去掉（`TaskRegistry.removeTask` + `taskRemoved`）：没归档、有 `sessionFile`、`stat` 报 `ENOENT` / `ENOTDIR`（别的错误不算）、隔一段时间再看还不在（omp 在 Windows 上原子重写会话文件时文件可能短暂不在原处）、没有进程也不在启动中、不是前台任务、没有 worktree。不对账的话侧栏一直列着打不开的任务。没被对账去掉的：起进程前 `stat` 一次，报 `ENOENT` / `ENOTDIR` 才是 `session_missing`（别的错误照常起 omp，由它报错），不起 omp（`--resume=<不存在的文件>` 会让 omp 打 `Session … not found` 后退出 1）。输入框占位换成 `error.sessionMissing`；用户照常发消息时清掉记录里的 `sessionFile`、不带 `--resume` 起进程，在这个任务里开新会话（任务设置保留）。
- 删除会话（issue #10，仓库所有者批准，2026-11-10；界面见 spec §4.2）：`TaskPool.deleteTask` / `deleteSession`。studio 不写 `~/.omp`，删除经 omp 自己的 `/delete`（实测见 [session-history.md](session-history.md)「删除会话」）：有进程（或正在启动）的任务在它自己的 omp 里发；其余（没进程、已归档、终端里开的会话）先问 `omp session lease --json -- <id>`（`history/session-lease.ts`），别的 omp 进程占着就拒绝（`error.sessionInUse`），再起一个临时 omp（`TspRunner`，只在内存、不进任务表、`buildLaunch(…, { temporary: true })`）`--resume` 后发 `/delete`。成功的判据是会话文件真的不在了（`TspCommands.deleteSession` 轮询 `stat`；之前出现新的错误行、警告行或状态 toast 就以原文失败），然后关进程、去掉任务记录。会话文件已经不在、或任务还没有会话文件时不起 omp，直接去掉记录。失败时任务记录不动。
- 分叉 / 回溯见 [session-tree.md](session-tree.md)：`TaskPool.forkTask` 新增一条记录，`forkFrom` 记要 `omp --fork` 的原会话文件，新会话文件一落盘就记进 `sessionFile` 并清掉它（worktree 任务的分叉共用同一个 worktree，所以 `discardWorktree` 在还有别的任务（含已归档的）用它时拒绝）；回溯不换会话文件。

## 启动

`TspRunner.start()`：状态机 `start` → worktree 目录还在吗（不在：`worktree_missing`）→ 会话文件还在吗（不在：`session_missing`）→ 有会话文件时问租约（被占：`session_in_use`，见下）→ 开始读新任务默认模型（`#loadNewTaskDefaults`，不等它）→ `acquireSlot`（进程上限，见下）→ `buildLaunch`（`--resume=<会话文件>` 或 `--fork=<forkFrom>`、`--model`、`--thinking`、`--allow-home`，cwd = 任务目录，env = 进程环境 + `TERM_PROGRAM=tern` 等）→ `TspSession.start`（node-pty 起进程、回 `hello`、按信用值回 `ack`，细节见 [tsp-migration.md](tsp-migration.md) §7）→ 等握手 → 等默认模型读完 → 状态机 `ready`，随后立刻对当前文档同步一次状态（omp 可能在回复 hello 之前就已经发了第一批帧）。

默认模型和 omp 启动同时进行，两段耗时不相加：冷启动拉模型目录约 0.6 秒，omp 到握手约 0.7 秒（omp 18.12.6 实测，新任务到输入框可发送约 1.05 秒）。默认模型只在新任务（记录里没有模型）时读，`--model` 不依赖它。

**恢复前看租约**（issue #11，仓库所有者批准，2026-11-12）：`--resume` 已有会话文件之前，`TspRunner` 问一次 `omp session lease --json -- <id>`（`TspRunnerHost.sessionInUse` ← `PoolDeps.sessionInUse`，`runtime.ts` 接 `history/session-lease.ts`，和删除会话同一个函数）。别的 omp 进程占着就不起进程，任务进 error（`session_in_use`），输入框占位写原因（`error.sessionHeld`）；用户在那边退出后发消息、重开会话或再点开任务都会重新查。原因：omp 不让两个进程写同一个会话，后写的那个第一次写盘时悄悄搬到新的兄弟文件（新 id，`parentSession` 指向原会话），见 omp 文档 `omp://session.md`「Persistence Guarantees and Failure Model」；studio 这边就成了侧栏里又一条同名会话。
- 检查本身失败（老版本 omp 没有这个子命令、超时、输出认不出）记 WARN、照常起（仓库所有者定，2026-11-12）。
- 这个任务自己的上一个进程不算进去：只有 stopped / error 的任务才走到 `#start`，`close()` 等进程退出才返回；omp 的租约是内核对象（Windows 命名 mutex、Linux 抽象 socket、macOS `flock`），进程一退出就释放（omp 18.19.0 文档）。
- omp 只在写会话时占租约，只读打开不占：终端那边刚 `--resume`、还没写东西时查不出来，这时 studio 照常起，之后先写的那边留在原文件 [推测，omp 18.19.0 文档，没实测]。
- 起进程的路径都是用户触发的（打开任务、发消息、重开会话、会话命令）；`init`、对账、回收都不起进程，不会在后台冒出这个错误。代价：每次打开有会话文件的任务多跑一次 `omp session lease`（实测约 0.1–0.2 秒，omp 18.19.0；上限 10 秒，超时照常起进程）。

启动失败的 `TaskError.kind`：`omp_unavailable`（找不到 omp）、`spawn_failed`、`worktree_missing`、`session_missing`、`session_in_use`；进程意外退出 `exited`。失败时状态是 `error`，promise 也 reject。`STUDIO_TEST_OMP`（JSON `{command,args}`，仅未打包）替换整条命令，e2e 和单测用它跑 `fake-tsp-omp`。

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

状态 = 有 `dialogs` ? needs_you : working ? running : idle（starting/error/stopped 由生命周期输入决定）。输入不是 omp 发的事件，而是推导出来的：omp 的 OSC 7501 是主信号（working / blocked / done / error / idle），这一轮的结局以它为准（done → completed、error → error 且错误原文在 `lastTurn.error.message`、idle → aborted）；没收到过 7501 的会话才退回节点推导：`shared/tsp/task-status.ts` 的 `deriveTaskStatus` 看 dock 里有没有运行状态行（`omp.working` / `omp.working.stop` / `omp.composer.stop`）和提问 / 审批节点（`omp.editor.ask*` = 门，主进程合成 `confirm` 型的 `DialogRequest`，见 [dialogs.md](dialogs.md)），另有 `omp.loader` 算 running、`omp.overlay.hook-*` 等模态弹窗算 needs_you。详见 [tsp-migration.md](tsp-migration.md) §7「状态推导」；依据 `fixtures/tsp/{task,approval,ask}.jsonl` 逐帧（`test/tsp-task-status.test.ts`）。主区里的 spinner 和 `omp.hud.activity`（待办面板，回合结束后还在）不可靠，不用。

"回答结束了还显示处理中"（2026-11-10 所有者报告，omp 18.18.6，没复现）：状态行的文字只来自 dock 的 `omp.working.label`，所以当时渲染进程的文档里运行状态行还在；录制里 omp 都在发用量行的同一帧删掉它。节点和 7501 不一致持续 5 秒时，`TspRunner.#watchSplit` 往主进程日志写 `status split for 5s`。再出现时：有这一行 = 两个信号不一致，看哪边没结束；没有 = 两边都说还在跑，omp 自己没停（收尾如 TTSR judge、标题生成）[推测]。

## 输入框上的状态从哪来

模型、思考强度、上下文占用、费用不是命令的应答，而是从 omp 输入框卡片上的节点读（`shared/tsp/composer-state.ts`，`TspRunner` 每次文档变化调用，变了才发布）：`omp.composer.model`、`omp.composer.model.effort`、`omp.composer.context`（meter）、`omp.composer.usage`。对照表在 [tsp-migration.md](tsp-migration.md) §10.2。待办阶段从 dock 里 `omp.hud.todo` 的 checklist 换算成 `TaskState.todoPhases`（`shared/tsp/todos.ts`）。输入框被提问 / 审批替换的那几帧读不到，沿用上一次的值。

omp 不给的数据从会话文件补（只读，不写 `~/.omp`）：每轮的用量脚注（含每轮费用，写法照 omp，恢复的行和实时的行一致）、最近一条回复的输出速度、按模型的累计用量，见 `src/main/tsp/session-extras.ts` 和 [tsp-migration.md](tsp-migration.md) §10.1。

## 进程上限和回收

- `maxLiveProcesses`（设置）是软上限。起新进程时存活数（含 starting）已到软上限：回收最久未用的**可回收**、没标保持运行的任务；没有可回收的就超出软上限照起，到硬上限（× 2）才失败，任务进 error（`spawn_failed`）。
- 可回收（`TspRunner.recyclable`）：有进程、状态 idle、没有未答的门、文档里没有还在跑的 `tool` / `agent` 卡片（转到后台的任务）、没有在跑的旁路提问（`/btw`）；前台任务由池排除。
- 定时回收：`sweep(now)` 每分钟跑一次，可回收状态持续到设置的时长（`StudioSettings.idleClose` → `IDLE_CLOSE_MS`；可设，仓库所有者定，2026-10-28）关进程；`now` 由调用方传入，测试不依赖真实时钟。
- 关闭会话（issue #11，仓库所有者批准，2026-11-12）：任务菜单和命令面板的"关闭会话"（`closeTask` → `TaskPool.closeTask`）和空闲回收走同一条路（`#recycle`）：结束进程，任务和最后一份快照留着（stopped），前台任务也能关。忙（不可回收）时拒绝，没有进程时什么也不做。再切到它（`openTask`）或发消息（`sendPrompt` 先 `start`）时 `--resume` 同一个会话文件。用途：要在终端里接着用这个会话时先在 studio 关掉，否则 studio 的进程占着租约，终端那边一写就分叉。实测（omp 18.19.0，`test/task-real-omp.test.ts`）：跑过一轮的任务进程活着时 `omp session lease` 报占着，关闭会话后报没占，再打开照常恢复同一个文件。
- 保持运行（`TaskRecord.keepAlive`，任务菜单里开关，`setTaskKeepAlive`；重启后还在）：定时回收和软上限回收都跳过它；硬上限照算，进程退出、用户停止照常。用途：Python eval 里的变量、`/add-dir` 加的目录、后台作业这些只在进程里的东西不丢。
- 回收后的任务保留最后一份节点树快照，已停止的任务的快照按 LRU 限量保留，更久的释放，再打开时 `--resume` 由 omp 重发整段对话。意外退出（error）同样留着最后一份。进程不在时快照里可能还有 `running` 的工具卡、子代理和计时节点：渲染进程不改文档，只按 `TspEndedAtCtx` 把它们画成已取消 / 已中止、计时停在看到进程结束的那一刻（`use-clock.ts`），见 spec「omp 进程意外退出」。Windows 上 pty 的 Job 在进程退出时关掉，后台作业随之结束，所以这样画是真实状态。
- `shutdown()`：并行 `close`（先 `taskkill /T /F` 进程树，再 `pty.kill()`）。退出路径只有 Shell 的 `before-quit`：`runtime.ts` 用 `registerShutdownHook(() => pool.shutdown())` 接入。
- 窗口 × 不退出：窗口只隐藏（`hide-on-close.ts`），任务池、状态机和 omp 子进程都不受影响，应用常驻托盘（决策见 [background-run.md](background-run.md)）。窗口隐藏期间状态变化照常经 `taskState` 推给渲染进程并刷新托盘；节点树批次（`tspBatch`）在窗口隐藏或最小化期间压下不发，窗口出来时渲染进程重拉快照（`main/tasks/tsp-feed.ts`，见 [tsp-migration.md](tsp-migration.md) §8）。真正的退出入口（托盘"退出"、应用菜单退出、安装更新、系统注销）才走 `shutdown()`。
- 新加一种以某个目录为 cwd 的常驻子进程（项目 rpc-ui、终端、pty）时，同时检查所有会删这个目录的路径（丢弃 worktree、清理无主 worktree）有没有先把它关掉：cwd 占着目录，`rmdir` 报 EBUSY（例：`service/project-omp.ts` 的 `closeUnder` 由 `runtime.ts` 的 `worktreeOps.remove` 先调）。

## 进程树兜底（Job Object）

`job-object.ts`：第一次用时建应用级 Job，只设 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`，不设任何 breakaway。任务的 omp 进程在 pty 里，用 `assignToOwnJob`（和内置终端一样：每个 pty 进程放进自己的 Job，关的时候一起收）；后台服务进程用 `assignToAppJob`（应用级 Job）。koffi 调用全在 `ffi.ts`（kernel32 / advapi32 / user32；`user-path.ts` 用同一个）。

实测（`test/job-object.test.ts`，Node 24.13 / Windows 11，用 `test/fake-omp/job-host.ts` 当"主进程"并强杀它）：

- 放进 Job：fake-omp 和它的 detached 孙进程都消失；不放进 Job（对照）：fake-omp 随主进程消失（libuv 的全局 Job），孙进程留下。所以 libuv 的 Job 只管直接子进程，我们的无 breakaway 嵌套 Job 把整棵树兜住。`IsProcessInJob` 验证了分配生效。
- 注意：fake-omp 的孙进程必须 `detached`，否则它进了 fake-omp 自己的 libuv Job，fake-omp 一死孙进程就跟着没了，测试发现不了残留。
- 没验证：真实 omp（Bun）的 bash 工具运行中强杀主进程；spawn 和 assign 之间的竞争窗口只能靠"ready 之前 omp 不起工具进程"的推测。非 Windows 上 Job 相关调用是空操作。

## 对外接口

`getTaskPool(): Promise<TaskPool>`（`runtime.ts`）。`TaskPool` 的方法对应 `ipc.ts` 里任务相关的 IPC 函数（渲染进程只传 id 和封闭的参数），另有 `listSessionLinks()`、`ensureProject(cwd)`、`resume({sessionFile, cwd, projectId, title})`（供历史列表）、`sweep(now)`、`shutdown()`。`openTask` 只负责拉起进程，不返回对话内容：对话是节点树，渲染进程按 `getTspSnapshot` + `tspBatch` 同步（[tsp-migration.md](tsp-migration.md) §8）。

IPC 调用一返回，不要马上从 store 里读这次改动的结果：主进程推送的 `taskState` 可能比 invoke 的应答晚到。要用新值就从应答里取，或者把要做的事挂起、等 store 跟上再做（`file-preview/roots-store.ts` 的 `selectRootWhenListed`）。节点树批次同理，见 [tsp-migration.md](tsp-migration.md) §8「按序号等镜像」。

测试：`test/task-pool.test.ts`、`test/task-tsp.test.ts`、`test/task-tsp-tree.test.ts`、`test/task-tsp-btw.test.ts`、`test/task-registry.test.ts`、`test/task-machine.test.ts`（都跑 `fake-tsp-omp` 回放 `fixtures/tsp/*.jsonl`）；真实 omp 冒烟 `test/task-real-omp.test.ts`（`STUDIO_REAL_OMP=1`）。
