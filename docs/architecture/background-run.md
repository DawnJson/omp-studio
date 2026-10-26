# 后台运行（关窗口后任务继续跑）：调研和方案

状态：**已决定并实现（2026-10-18）：方案 1 的"常驻托盘"形态。** 对应阶段 2.6"后台运行"。下面的调研、实测和方案对比是决策依据，原样保留；"决策"一节写最终行为和它与"推荐：收尾模式"的差别。调研时只读代码和环境；实验用的 omp 全部用临时 `PI_CODING_AGENT_DIR`，实验目录用完已删。

标注约定：**实测** = 本机亲手测的，写明版本；**文档** = 官方文档原文，附链接；**推测** = 没有证据，只是推断。omp 的结论一律带版本号，本机 omp 是 18.12.1（`omp --version`），模型 `deepseek/deepseek-v4-flash`，Windows 11，Node 24。

## 决策（2026-10-18，仓库所有者）：常驻托盘

不做收尾模式（"所有任务安静后自动退出"），**应用始终常驻托盘**：点窗口 × 只隐藏窗口，主进程、任务和 omp 子进程继续跑；退出只有明确的入口。没有"常驻/收尾"开关（owner 选了常驻，不加设置项）。

**行为：**

- 窗口 ×（含 Alt+F4）：整窗淡出后 `hide()`（`concealWindow`，2026-10-26 起；时长见 `spec.md` §2.6“窗口出现 / 消失”），不销毁，也不弹确认。第一次关窗口时发一条系统通知"omp-studio 仍在托盘运行"，之后不再提示（记在 `userData/window-state.json` 的 `trayNoticeShown`，不是 omp 配置，也不进 `StudioSettings`）。
- 托盘图标（`resources/tray.png`，像素 π 加“层叠”淡影，和界面里的标志同一份数据，由 `npm run icons` 生成，见 `docs/design/spec.md` §3.1“标志”；打包时经 `extraResources` 放到 `resources/tray.png`）：悬停提示是应用名，有任务在忙时附 "N 个运行中，M 个等你确认"；左键显示并聚焦窗口；右键菜单：打开 omp-studio / 摘要行（灰）/ 最多 6 条在忙的任务（点击显示窗口并定位到该任务）/ 退出。托盘图标和菜单由系统绘制，自动化测试点不到，菜单模板是纯函数（`tray-model.ts`）单测。
- 再次启动应用（`second-instance`）、macOS 的 `activate`、点系统通知、点托盘：都走 `showMainWindow()`——显示隐藏的窗口并淡入（`revealWindow`），最小化的先还原，窗口不在了才重建（重建的窗口和启动时一样等渲染进程第一帧上屏再淡入）。
- 退出时窗口先淡出隐藏：`main-window.ts` 注册的退出 hook，和关 omp 等其余 hook 并行，不拖慢退出。
- 通知：任务进入"等你确认"时照旧发（窗口隐藏时 `isFocused()` 为 false，天然满足"没焦点"）；新增：窗口看不见（隐藏在托盘、最小化）时，任务正常跑完或出错也发一条。窗口可见时不发（侧栏已有完成点）。两种通知共用设置里的"有任务在等你时通知我"开关。点通知显示窗口并定位到该任务。
  - **2026-10-23 起通知开关改用 omp 的设置**：上面说的 studio 自己的“有任务在等你时通知我”（`notifyOnGate`）已删，“等你确认”看 `ask.notify`、完成看 `completion.notify`、出错看 `error.notify`（`on` 才发；默认 ask 开、completion 开、error 关），触发条件（窗口没焦点 / 窗口看不见）不变；不做迁移，以前关过旧开关的用户需要在设置 → 通用 →“通知与回顾”里自己关这三项。见 `omp-settings.md`「studio 的系统通知遵守 omp 的 `*.notify`」。下面“是否复用 `notifyOnGate`”的待决策项已作废。
- 真正的退出入口：托盘"退出"、应用菜单的退出（`quitApp`）、自动更新"重启并安装"（`finishShutdown()` 之后 `quitAndInstall`）、系统注销/关机（窗口的 `session-end` 事件触发 `finishShutdown()`）。它们都经过 `shutdown.ts`：`before-quit` 或 `finishShutdown()` 把 `isQuitting()` 置 true，`hide-on-close.ts` 的 close 处理器此后放行，不会吞掉 `quitAndInstall` 触发的退出。退出流程本身没改：并行关所有任务的 omp（结束进程树再关伪终端，见下文"现状"），服务进程和项目 rpc-ui 池关 stdin，超时强杀，Job Object 兜底。
- `window-all-closed` 不再退出（装了空监听以关掉 Electron 的默认退出）；最后一个窗口只会在真正退出或渲染进程被销毁时关掉。

**为什么隐藏而不销毁（对调研里"3a 不推荐"的修正）：** 调研推荐销毁窗口、靠快照冷启动恢复，是因为收尾模式下进程很快会退出，省的是内存。常驻模式下用户会反复把窗口调出来，隐藏不销毁能原样保留输入草稿、滚动位置、展开状态，也省掉"重建窗口时渲染进程订阅事件的时序"这一类问题。代价是常驻一个渲染进程的内存（Chromium 渲染进程通常几十 MB 量级，**未实测**），对一个本来就要常驻的桌面客户端可以接受。

**没做的（相对调研方案）：** 关窗口时的确认弹窗、任务安静后自动退出、更新前"后台有任务"的确认。更新仍然是 `prepareInstall()` 先关所有 omp 再安装，会中止在跑的任务（实测 A）；托盘"退出"同样直接中止任务，不二次确认——这是仓库所有者定的"退出才中止"语义。

**未实测：** 真机上系统注销/关机时 `session-end` 的触发；托盘图标在 Win11 里被折叠到"隐藏的图标"里的发现性（所以首次关窗口时发一条提示）；常驻渲染进程的内存基线；安装包装好后托盘图标是否从 `resources/tray.png` 正常加载（e2e 跑的是未打包版本，走仓库 `resources/`）。

## 结论

1. omp 的会话和 stdin 绑定，**不存在"让 omp 脱离 stdin 继续跑"的办法**（实测，18.12.1：工具执行中关 stdin，85 ms 内进程以 0 退出，正在跑的命令被中止）。要在窗口关掉后继续跑，只能有一个进程一直握着 omp 的 stdin 管道。
2. 能握住管道的进程有两种：**主进程自己**（方案 1，留在托盘），或**一个独立的后台进程**（方案 2）。实测（18.12.1 + Node 24）：独立的 detached 进程握着 omp，父进程被强杀后，omp 的那一轮照常跑完（见"实测 C"），所以方案 2 在技术上可行。
3. Codex 桌面版和 Claude Code 桌面版的**本地会话都要求应用本身在运行**（文档，链接见下）；真正"关了窗口甚至关机也继续跑"的都是云端或 SSH 远端。Tern 是唯一用独立 daemon 的，但它是终端复用器，daemon 里跑的是 PTY 子进程，和我们"自己解析 RPC 协议"的结构不同。
4. **推荐方案 1 的收尾模式**：关窗口时如果有任务在跑，窗口销毁、主进程留在托盘继续跑；所有任务都安静后自动退出（可在设置里改成常驻）。现有三条规则（会话绑 stdin、退出时关 omp、Job Object）**全部不用改**，只改"窗口关闭 ≠ 退出"这一条。工作量约 3–4 个工作日。方案 2 留到有"更新或主进程崩溃时任务也不能断"的明确需求再做。

## 调研

### Tern（本机已安装，只读）

Tern 0.9.4（`%LOCALAPPDATA%\Tern\updates\state.json` 的 `installed.release.version`），GPU 渲染的终端复用器，omp 在它的 pane 里以 TUI 方式运行。

**实测（2026-10-18，本机日志和进程表）：**

- 进程表里有两个 `tern.exe`：窗口进程，和它的**子进程** `tern.exe daemon --socket \\.\pipe\tern-<用户名>`（`Win32_Process.ParentProcessId` 指向窗口进程）。daemon 由第一个窗口拉起，监听命名管道。
- `Logs\tern-daemon.log` 记录了 12 天里 20 次 daemon 启动。窗口是 daemon 的"客户端"：`daemon client attached/detached kind=Window`；`tern` 命令行也是客户端（`kind=Cli`，195 次）。
- 同一个 daemon 进程连续跑了十几个小时，期间窗口多次 detach / attach（例如 10-12：08:26 启动，23:29 最后一次 detach），说明**窗口和 daemon 是分开的，窗口重连不影响 pane 里的程序**。
- 6 次 `daemon stopped` 都紧跟着 0.1 秒内新 daemon 启动，并且前面约 10 秒有一次窗口 detach + 立刻 attach 且版本不同（日志里 7 次 `client protocol level differs`）。这是**更新后窗口换了版本，要求替换 daemon** 的形状。
- 其余 14 次 daemon 启动前**没有** `daemon stopped`，都发生在早晨，且立刻 `restoring daemon panes count=N`（3–5 个）。daemon 是被强行结束的（注销、关机或睡眠后被收），没有走优雅退出。daemon 重启后 pane 里的 omp 被重新拉起：进程表里两个 omp 的命令行是 `omp --restore <会话文件>`。
- `daemon.state`（约 10 MB）是魔数 `TDS9` + JSON，记录各 pane 的布局和屏幕历史。

**二进制内嵌的更新说明和帮助文本（`strings tern.exe`，实测内容，行为靠推测）：**

- "Added persistent sessions served by a background daemon, so shells survive closing the window"
- "closing one of several windows ends its programs, while quitting keeps sessions"（退出窗口 ≠ 结束 session，关其中一个窗口才结束）
- "Made updating Tern keep your programs running on macOS and Linux: restarting the session daemon hands its panes to the new version in place"：只在 macOS / Linux 做到了更新时不断程序，**Windows 没有**。上面日志里更新时 daemon 被替换、pane 靠 `omp --restore` 重新拉起，与此吻合（推测）。
- "Fixed an omp you started yourself ... not coming back when the session daemon is restored (after a crash or a restart that can't keep programs running): the shell now runs `omp --resume`"：daemon 崩溃或更新后，omp 靠重新 resume 会话文件恢复，不是接着原来的进程跑。
- "Fixed panes restored after an update or daemon restart losing the omp transcript, the command that started it and the output of a command still running"：恢复后正在跑的命令的输出会丢，Tern 自己也在补这个洞。
- `tern daemon [--socket PATH] [--login]`：`--login` 在后台启动 daemon，等同"开机自启"。macOS 27 上 daemon 被登记为登录项。
- 版本不一致问题是真实存在的：字符串里有 "This machine's session daemon runs another build: restart it first"、"only a window on this machine may upgrade the daemon"。

**对我们的意义：** Tern 的 daemon 里是 PTY 子进程，客户端只转发字节和屏幕状态，所以 daemon 协议很薄，也不关心 omp 在说什么。我们的任务运行时（`tsp-runner`、`tsp-session`、状态机、任务池）都在主进程里，要拆就得把这一整块拆进 daemon。另外 Tern 在 Windows 上的更新也逃不掉"替换 daemon 会断程序"。

**没测到的：** 在 Windows 上点掉最后一个窗口后 daemon 是否继续存活（日志里 daemon 在窗口全部 detach 之后没有再写日志，无法区分"在跑"和"没动静"）。不要据此下结论。

### Codex 桌面版

- **文档**：计划任务页写明桌面版要"保持电脑开着、应用在运行"：*"Keep the computer on and the app running when a scheduled task needs local files."* <https://learn.chatgpt.com/docs/automations?surface=app>（同页还说本地项目的计划任务要求"the machine powered on and the ChatGPT desktop app running"）。
- **架构（文档/二手）**：桌面版、VS Code 扩展等富客户端把 `codex app-server` 作为**子进程**拉起，用 stdio 上的 JSON-RPC 通信，一个 server 里托管多个 thread。<https://www.infoq.com/news/2026/02/opanai-codex-app-server>、<https://www.promptfoo.dev/docs/providers/openai-codex-app-server>。这和 omp-studio 现在的结构（主进程拉 omp 子进程、stdio）是同一类。
- **Windows 上关窗口的实际表现是 bug，不是功能**：关掉窗口后残留多个 `codex.exe` 和 `conhost.exe`，阻止重新启动。<https://github.com/openai/codex/issues/13970>（有人定位到是一个无参数的 `pwsh.exe` 子进程拽着它们不退）、<https://community.openai.com/t/codex-windows-app-ui-closes-but-background-processes-remain-blocking-relaunch/1379095>。这正是 `AGENTS.md` 要求"不能留下孤儿进程"、并用 Job Object 兜底的原因。
- 没有查到 Codex 桌面版在 Windows 上"关窗口后任务继续跑"的官方说明。**推测**：关窗口即结束，与文档要求"应用在运行"一致。

### Claude Code 桌面版

- **文档（本地计划任务）**：*"A local task runs on your machine with direct access to your files and tools, but only fires while the app is open and your computer is awake."* 睡眠时错过的运行会跳过，应用重新启动或电脑唤醒时只补跑一次最近错过的。<https://code.claude.com/docs/en/desktop-scheduled-tasks>
- **文档（会话）**：只有云端会话"continue even if you close the app or shut down your computer"。<https://code.claude.com/docs/en/desktop>（Cloud sessions 一节）
- **文档（SSH 会话，最像"后台服务"的做法）**：远端机器上有 Desktop 安装的 background helper，Claude Code 作为 helper 下的进程运行，所以"退出 Desktop、睡眠、断网"后任务继续跑；helper 把每个会话最近 16 MiB 输出缓冲起来，重连后补显示（缓冲丢掉的部分显示 "Some output produced while you were disconnected may be missing here."）。同页还有这些限制：登录凭据会过期；等待审批的请求会在远端一直等，无超时；**Windows 版 Desktop 退出后不会重新接回任务**（"Desktop on Windows: you don't get the running task back, because Desktop never rejoins after a quit"）；更新带来新 helper 时会替换 helper，"can end a task that still runs"；Desktop 自己更新重启时，**有 SSH 任务在跑就等着**（"That restart waits while Claude is working on an SSH task"）。<https://code.claude.com/docs/en/desktop> 的 "Keep a task running while Desktop is disconnected" 一节。
- 本地会话是否在 Windows 上关窗口继续跑，文档没有单独说明；**推测**：本地会话由 Desktop 进程持有，应用退出即结束，与计划任务页的"app is open"一致。

### 调研小结

| 产品 | 关窗口后本地任务继续跑？ | 机制 | 更新时 |
|---|---|---|---|
| Codex 桌面版 | 文档要求应用在运行；Windows 上关窗口残留进程是 bug | 主进程拉 `app-server` 子进程 | 未查到 |
| Claude Code 桌面版（本地） | 文档要求应用打开；不继续 | 主进程持有会话 | 未查到 |
| Claude Code 桌面版（SSH 远端） | 继续（有凭据过期、Windows 不重接等限制） | 远端 helper 进程 + 16 MiB 输出缓冲 | 新 helper 会替换旧 helper，可能断任务；Desktop 更新会等任务做完 |
| Tern（Windows，实测） | 窗口和 daemon 分离，窗口重连不影响 pane | 独立 daemon + 命名管道，PTY 子进程 | Windows 上替换 daemon，靠 `omp --restore` 重新拉起，运行中的命令输出丢失 |

三家都没有"本地、纯 Electron、关窗口继续跑 + 更新不断任务"的现成答案。

## omp 实测（18.12.1）

`omp --mode rpc-ui --model deepseek/deepseek-v4-flash --approval-mode yolo`，cwd 和 `PI_CODING_AGENT_DIR` 都在仓库外的临时目录。提示词让模型用 bash 工具跑一条 `node -e "setTimeout(()=>writeFileSync('markerN.txt','done'),20000)"`（20 秒后才写标记文件），以此判断命令是否被执行完。

**实测 A：工具执行中关 stdin。** 收到 `tool_execution_start` 后 `stdin.end()`：

- 关 stdin 发生在工具开始后约 33 ms，**关 stdin 后 85 ms 进程退出，退出码 0**；
- 标记文件没有生成（命令被中止）；
- 会话文件最后一条是 `toolResult`，内容 `Command aborted`；
- 关 stdin 之后还收到了 `tool_execution_end`、`message_*` 等收尾帧。

结论（18.12.1）：`omp://rpc.md` 写的"stdin 关闭 → 排空已接受的命令 → 释放会话 → 退出"成立，**而且会中止正在跑的工具**，不是"跑完这一轮再退"。关 stdin 不能用来"脱离"。

**实测 B：进程在工具执行中被强杀（`taskkill /T /F`），再用新进程恢复。**

- 强杀时 `get_state` 已有 `sessionFile`，`isStreaming:true`；
- 工具里的命令随进程树被杀，标记文件没有生成；
- 会话文件此刻只有：用户消息、一条带工具调用的 assistant 消息，**没有对应的 toolResult**；
- 新进程 `switch_session` 成功（`cancelled:false`），`get_state` 为 `isStreaming:false, isSettled:true, messageCount:2`，`get_messages` 返回 `user, assistant` 两条；
- **不会自动接着跑**；再发一条 `prompt` 能正常完成（`prompt_result.status:"completed"`）。

结论（18.12.1）：中途被打断的会话可以从会话文件恢复并继续对话，但**那一轮丢了**——模型调了一半的工具没有结果，需要用户或 UI 重新发一条"继续"。这是"主进程被杀 / 关机 / 更新"路径上任务的真实下限；不能指望 resume 接着跑。（未测：模型收到"继续"后如何处理悬空的工具调用，本次 `ok` 提示词没有覆盖。）

**实测 C：独立 detached 进程握着 omp，父进程被杀。** 父 Node 进程 `spawn(node, holder.js, {detached:true, stdio:'ignore', windowsHide:true})` 后 `unref`；holder 再 spawn omp、持有 stdin 管道、发 prompt（让它跑 12 秒的命令）。工具开始后用 `taskkill /PID <父> /F`（不带 `/T`）杀掉父进程：

- holder 和 omp 都活着，命令跑完（标记文件生成），收到 `tool_execution_end` 和 `prompt_result completed`；
- holder 自己的 60 秒定时器到点后 `stdin.end()`，omp 随之退出码 0。

同一个实验里先用了 `taskkill /T /F`：**holder 也被一起杀了**（`/T` 按父子关系遍历，detached 子进程的父 PID 仍然记着）。所以实验方法和将来的安装器行为都要小心"按进程树杀"（见方案 2 的更新风险）。

**其他事实：**

- omp 没有 daemon / attach / serve 类的原生托管模式：`omp --help` 的 `--mode` 只有 `text/json/rpc/acp/rpc-ui`，子命令里有 `ps`（"List and control daemon-supervised background processes"），那是 omp 自己的后台进程监管，和会话托管无关（`omp://cli-reference.md`；18.12.1 的文档，未实测 `ps`）。
- 扩展 UI 请求（审批、ask）在没人答复时 omp 一直等：`omp://rpc.md` 的 "stdin closes → pending extension UI … rejected" 是唯一提到的清理路径；是否存在默认超时，文档没写，**未实测**。读 omp 18.12.6 源码（`modes/rpc/rpc-mode.ts` 的 `select`/`confirm`/`input`/`editor`）：只有扩展自己传了 `timeout` 才会超时，没传就一直等。后台期间等审批的任务很可能一直停着（推测），这是需要通知的原因。
- 这条只针对**任务**里的 omp（TSP，由任务自己的门和浮层处理）。studio 自己的后台 rpc-ui 进程（服务进程、项目池里的短命进程）不同：连接层（`OmpConnection`，2026-10-23 起）常驻应答，没人认领时对 `select`/`confirm`/`input`/`editor`/`ask` 一律回 `cancelled:true`，`notify`/`setStatus`/`setWidget` 只写日志（见 `omp-rpc.md`）。所以扩展在这些进程里弹的对话框不会把 omp 一直挂住。

## 现状：会在哪里把任务收掉

读自当前代码（未改）：

- `src/main/index.ts:31`：`app.on("window-all-closed", () => app.quit())`。关最后一个窗口 = 退出。
- `src/main/window/shutdown.ts`：`before-quit` 拦一次，跑完所有 hook 再放行；`runtime.ts` 注册 `pool.shutdown()`，并行 `close(5000)`（每个任务 `taskkill /T /F` 进程树再关伪终端），见 `task-model.md`"进程上限和回收"。
- `src/main/tsp/tsp-session.ts`：`close()` 先结束进程树、等退出事件，超时才 `pty.kill()`；spawn 和结束在 `platform/pty-lock.ts` 里排队（node-pty 原生层没有锁）。
- `src/main/platform/win32/job-object.ts`：任务的 omp 在伪终端里，每个进程放进自己的 `KILL_ON_JOB_CLOSE` Job（`assignToOwnJob`）；后台服务进程用应用级 Job。主进程被强杀时由系统收掉整棵树。
- 自动更新：`UpdateService.install` 先 `prepareInstall()`（= `finishShutdown()`）再 `quitAndInstall(true, true)`（`auto-update.md`）。`autoDownload = true`。
- 通知：`gate-notifier.ts` 只在任务进入 `needs_you`、窗口没焦点、设置打开时发；`runtime.ts` 里 `windowFocused: () => getMainWindow()?.isFocused() ?? false`，**没有窗口时也成立**，主进程不需要窗口就能发通知。`onClick` 在没窗口时直接 `return`（`runtime.ts:40`），需要改成"重新创建窗口"。
- 已有的"进程回收"（`task-pool.ts` 的 `sweep`）只回收 idle、无未答的门、已安静、非前台的任务（`task-model.md`），不会误收正在跑的任务。后台模式下"前台"概念要重新定义（见下文方案 1 的待验证项）。

## 方案对比

### 方案 1：主进程留在托盘

窗口关闭时不退出，主进程继续握着所有 omp 的 stdin。

**用户看到的：**

- 点 × ：没有任务在跑 → 和现在一样直接退出；有任务在跑 / 等确认 → 窗口消失，任务栏图标消失，托盘出现图标，右键菜单"打开 omp-studio / N 个任务运行中 / 退出"。
- 任务需要确认时发系统通知（`gate-notifier` 现成），点通知重新打开窗口并定位到该任务。
- 任务跑完发"已完成"通知（新增，目前只有等确认的通知）。
- 收尾模式下所有任务安静后托盘图标消失、进程退出；常驻模式下留着直到用户点"退出"。
- 托盘里点"退出"：等同今天的退出，关所有 omp。

**对现有规则的改动：**

| 现有规则 | 是否改 | 说明 |
|---|---|---|
| 会话绑 stdin，关 stdin 即释放 | 不改 | 持有者还是主进程 |
| 退出时明确关掉子进程 | 不改 | 只改"什么算退出"：× 不再等于退出；托盘"退出"、系统关机、更新安装仍然走 `finishShutdown()` |
| Job Object 兜底 | 不改 | 主进程崩溃仍由 Job 收整棵树。后台任务在主进程崩溃时丢失，和现在一样 |
| `window-all-closed → quit` | 改 | 改成"无后台工作才退出" |

**通知：** 复用 `gate-notifier`；加"完成"通知；点通知在无窗口时重建窗口并 `focusTask`。

**更新 / 安装器：** 主进程持有 omp，更新安装前必须等任务做完或用户确认。`UpdateService` 的 `prepareInstall` 已经先关所有 omp，所以**行为上不会损坏安装**（`KILL_ON_JOB_CLOSE` 那一条已经考虑过），但会中止正在跑的任务（实测 A）。需要加一条：后台有任务时，"重启并安装"要弹确认，或推迟到任务安静后；`electron-updater` 的 `autoInstallOnAppQuit` 默认是 `true`（库默认值，**推测**本项目没改——`src/main/update/service.ts` 里只看到设了 `autoDownload`，实现时要确认），所以托盘"退出"时可能静默触发安装，要明确这个路径。收尾模式下"全安静才退出"天然避开更新冲突。

**工作量：** 3–4 个工作日。
- `index.ts`：`window-all-closed` 判断；`second-instance` / `activate` 在无窗口时重建窗口；
- `TaskPool` 加 `hasBackgroundWork()`（任何任务状态为 `starting/running/needs_you`，或 `get_state.hasPendingAsyncWork`）和 `onSettledAll` 事件；
- 新增 `src/main/window/tray.ts`（图标素材、i18n 菜单）；
- 通知：完成通知 + 无窗口时的点击处理；
- 设置项（见决策 3）、关闭时的确认；
- 更新路径的任务保护；
- 测试（见验证）。

**风险：**
- 窗口销毁后重建，渲染进程要能从主进程快照冷启动恢复：`task-model.md` 说回收后的任务保留最后一份节点树快照，渲染进程按 `getTspSnapshot` + `tspBatch` 序号同步，应该已经支持，但"所有任务都在跑时重建窗口"没有端到端测过，列入验证。
- "前台任务"：`sweep` 的回收判据含"不是前台"。窗口关闭后没有前台，所有 idle 任务 15 分钟后会被回收，对"正在跑"的任务无影响，但对"idle 且想马上回来继续"的任务有影响，需要明确（建议：无窗口时停掉 sweep，因为反正快退出了）。
- 系统注销/关机时 Electron 的退出事件在无窗口的 Windows 应用上是否可靠触发 `before-quit`：**未测**。即使不触发，Job Object 也会在主进程消失时收掉 omp，会话文件按实测 B 可恢复，只是那一轮丢失。
- 常驻模式带来"忘了退出，后台占内存"和"托盘图标被 Win11 折叠看不见"的发现性问题。
- 内存：窗口销毁后只剩主进程和 omp 子进程，具体占用**未测**。

### 方案 2：独立后台服务进程，UI 附着上去

拆成两个进程：服务进程（持有 `TaskPool`、omp 连接、`tasks.json`、通知），窗口进程（Electron 主进程 + 渲染进程）通过命名管道连接。关窗口只是 detach，服务继续跑。这是 Tern 的做法（实测见上）。

**用户看到的：** 关窗口后任务继续跑，再打开窗口自动接回；主进程崩溃、窗口崩溃、更新窗口都不影响任务（更新服务本身除外，见下）。多了一个后台进程，需要管理（托盘或"停止后台服务"命令）。

**对现有规则的改动（比方案 1 大得多）：**

| 现有规则 | 是否改 | 说明 |
|---|---|---|
| 会话绑 stdin | 不改规则，但持有者换成服务进程 | 实测 C 证明 detached 持有者可行 |
| 退出时关子进程 | **要改** | "退出 omp-studio"和"关闭后台服务"成了两件事；要有明确的 UI 区分 |
| Job Object | **要改** | 现有应用级 Job 属于窗口主进程；服务进程要有自己的 Job（同样 `KILL_ON_JOB_CLOSE`，omp 放进它），而且**服务进程不能被放进窗口进程的 Job**；窗口崩溃不再收 omp，服务崩溃收 omp |
| `AGENTS.md` "孤儿进程" | **要改** | 新增"服务进程自身是否孤儿"的规则：单实例锁、版本不匹配、没有客户端时的空闲退出 |

**其他代价：**
- `StudioApi` 的 20 个任务函数、全部事件（`taskState`、`tspBatch`、`taskNotice`、旁路提问……）、历史列表、`getTspSnapshot` 快照都要走服务的 IPC；需要自定协议、帧格式、鉴权（本机命名管道要设 ACL，Tern 的日志里有 `os error 1314` 的权限类告警可以参考这类坑的存在）、版本协商。
- 版本差异：Tern 日志里 7 次 `client protocol level differs`，说明这是常态问题（实测）；每次更新窗口和服务可能不同版本。
- 服务进程要么是 Electron 本身（`ELECTRON_RUN_AS_NODE` 或隐藏窗口的第二个主进程），要么自带 Node（**打包版没有系统 Node**，推测不能依赖用户装的 Node）。要发系统通知就必须是完整 Electron 进程（`Notification` 需要 Electron 主进程；纯 Node 模式下不可用，推测），那它和"留在托盘的主进程"其实是同一个东西，再多一层 IPC。
- **更新 / 安装器：** NSIS 安装要替换安装目录里的文件。服务进程如果是同一个 `omp-studio.exe`，安装器的"应用在运行"检测（electron-builder NSIS 默认行为，**推测**按进程可执行文件名检测）会把它当成正在运行的应用，要么提示关闭，要么被结束；如果被结束，任务就断了——和 Tern 在 Windows 上更新时 daemon 被替换、靠 `omp --restore` 重拉的结果一样（实测）。要避免只有两条路：服务用独立于安装目录的拷贝运行（占磁盘、版本管理更复杂），或更新时先 drain 再替换（那和方案 1 的结果一样，多了一堆复杂度）。Claude Desktop 的 SSH helper 同样"更新带来新 helper 时会替换，可能结束任务"（文档），他们的对策是 Desktop 自己更新重启时等任务做完。

**通知：** 服务进程发（前提是它是 Electron 进程）；点通知要能唤起窗口进程，需要服务能启动窗口，或窗口进程常驻托盘。

**工作量：** 约 2–3 周（协议 + 服务拆分 + 重连/补事件 + 更新处理 + 测试）。
**风险：** 事件补发（窗口离线期间的事件靠服务端缓冲或重取历史，Claude helper 用 16 MiB 缓冲，缓冲溢出就丢，Tern 也有"运行中命令输出丢失"）；服务和窗口版本漂移；多一个长期驻留进程要管；`AGENTS.md` 的进程树规则复杂度翻倍；测试矩阵翻倍（e2e 现在以单进程为前提）。

### 方案 3：其他做法

**3a. 方案 1 的变体：隐藏窗口而不销毁。** 关窗口只 `hide()`。实现更省，冷启动最快，但常驻渲染进程占内存（Chromium 渲染进程通常几十到上百 MB，**未测**）。不推荐，收益只是不用验证冷启动恢复。

**3b. 薄 holder：每个 omp 配一个小进程握住伪终端，主进程通过命名管道接。** 只中继字节流，不碰任务逻辑，主进程重启后重连并按节点树快照重建状态。比方案 2 范围小（不拆 `TaskPool`、不改 `StudioApi`），但仍要处理 holder 的生命周期、Job Object、更新时的 holder、重连后丢失的帧（需要 holder 缓冲）。适合作为方案 1 之后的**增量**，用来解决"更新/主进程崩溃时任务也不断"。实测 C 证明这条路径的第一步成立（当时用的是 rpc-ui 的 stdin，现在任务进程改成伪终端里的 TSP，这一步要在 pty 上重新验证，未测）。

**3c. 不做后台：关窗口前提示"有任务在运行，退出会中止它们"。** 成本最低，是现状的 UX 补丁。实测 A 说明中止后那一轮会丢（B：悬空工具调用）。可以作为方案 1 的降级兜底（用户选了"退出"时）。

**3d. 云端 / 远端：** Codex 和 Claude 能"关机也继续"的都是这个。omp 没有远端托管（没有原生 attach）；超出本项目范围。

## 推荐：方案 1，收尾模式（drain）

**理由：** 对用户可见的需求是"关窗口别把正在跑的任务弄丢"。方案 1 用最小改动满足，现有三条规则一条不动（实测 A/B/C 说明方案 2 要的所有额外复杂度买到的是"更新和主进程崩溃时任务不断"，而这两件事连 Tern 在 Windows 上都没做到）。主流产品（Codex、Claude Code 桌面本地会话）也要求应用本身在运行，用户没有更高的预期。收尾模式额外避开两个问题：常驻进程的发现性问题；更新冲突（空闲后自动退出，安装正常）。

**行为定义：**

1. 点 ×（或 Alt+F4）：
   - 没有任务处于 `starting / running / needs_you`（且没有 `hasPendingAsyncWork`）→ 直接退出，和现在一样；
   - 否则 → 首次弹一次确认："还有 N 个任务在运行。留在后台运行直到它们完成（推荐） / 退出并中止"；可勾选"以后不再询问"，记在 omp-studio 自己的设置里（omp-studio 自己的设置，不是 omp 配置）。
2. 留在后台时：销毁窗口，托盘图标出现；任务继续，通知照发（等确认、完成、出错）。
3. 所有任务安静（无 `running / needs_you / starting`）后：发一条"已完成"汇总通知，并自动退出（会先 `finishShutdown()`，走现有流程）。若设置了"常驻托盘"则不退出。
4. 托盘菜单："打开"、"N 个任务运行中"（点击定位）、"退出"（等同今天的退出，中止所有任务）。再次启动应用（`second-instance` / 点通知 / 点托盘）：重建窗口。

**实现计划（按依赖顺序）：**

1. `TaskPool.hasBackgroundWork()` 和"后台工作清零"事件。纯函数 + 单测，不 import electron（沿用 `task-pool.ts` 的约定）。
2. `index.ts`：窗口 `close` 事件里决策（不能在 `window-all-closed` 里，因为那时窗口已关，无法弹确认）；`second-instance` / `activate` / 通知点击在无窗口时重建窗口。
3. `src/main/window/tray.ts`：托盘图标和菜单，i18n 走现有命名空间约定；图标素材需要设计提供。
4. 通知：`GateNotifier` 加"完成/出错"类通知（同样的"没焦点才发"规则，没窗口也算没焦点）；设置项复用已有的 `notifyOnGate` 还是新增，见决策。
5. 更新保护：`installUpdate` 在后台有任务时先确认；明确 `autoInstallOnAppQuit` 的行为并测掉托盘退出路径。
6. `sweep`：无窗口时停掉回收。
7. 文档：`task-model.md`（"进程上限和回收"、退出路径）、`AGENTS.md`（"窗口关闭 ≠ 退出"）。

**验证步骤：**

- 单测：`hasBackgroundWork` 覆盖每个状态；`GateNotifier` 无窗口时仍发通知；回收在无窗口时不触发。
- 集成（用 `test/fake-omp/fake-tsp-omp.ts`）：任务在跑时触发窗口关闭决策 → 进程仍存活、伪终端仍连着、任务跑完后进程自动退出且没有残留 omp 进程（沿用 `AGENTS.md` 的"检查有没有残留进程"）。
- e2e（Playwright，单个 spec）：开任务 → 关窗口 → 托盘/进程还在 → 重新打开窗口 → 状态和历史一致（`tspBatch` 序号对得上）。
- 手工：真实 omp，跑一个 30 秒的 bash 命令，关窗口，确认完成通知并自动退出；等确认的审批在窗口关闭状态下弹通知，点击后窗口出现并定位到该任务。
- 更新：用 `auto-update.md` 的本地验证流程，在后台有任务时点安装，确认弹确认，选"等待"后任务完成再安装成功。
- 系统注销 / 关机路径：手工验证 `before-quit` 是否触发；不触发时确认 Job Object 仍然收掉 omp，重启后任务能用 `omp --resume=<会话文件>` 恢复。
- 内存：任务在后台时主进程 + omp 的占用，记录一个基线。

## 需要仓库所有者决定的事

1. **选哪个方案。** 推荐方案 1 收尾模式；方案 2 / 3b 是否留到阶段 5 之后再评估。
2. **关闭 × 的默认行为：** 有任务在跑时默认"留在后台"（推荐，附一次性确认）还是默认"退出并中止"（保守，但就失去了这个功能的意义）。
3. **收尾后是否自动退出：** 自动退出（推荐）；或提供"常驻托盘"设置（常驻需要确认开机自启/托盘发现性/更新处理，工作量 +1 天以上）。
4. **新增通知的范围：** 任务完成、出错是否也通知？是否复用 `notifyOnGate` 开关，还是新增"任务完成通知"开关？（omp-studio 自己的设置，不涉及 omp 配置。）
5. **托盘图标素材**（需要设计提供，或先用应用图标）。
6. **更新时后台有任务：** 弹确认（推荐）还是自动等到任务完成再装。
7. **关机 / 注销时任务如何处理：** 接受"那一轮丢失，下次用户手动 resume"（实测 B 的现状，推荐）；还是要求下次启动自动 `switch_session` 并代发"继续"（需要先实测 omp 对悬空工具调用的处理，本次没覆盖，且可能产生用户没预期的执行）。
8. **等确认的任务在后台一直等：** 接受（omp 侧是否有超时未实测）；还是设置"等待超过 N 分钟自动中止"（会改变 omp 的行为语义，我们不应在没有确认的情况下替用户拒绝审批）。

## 未验证清单

- Tern 在 Windows 上关掉最后一个窗口后 daemon 是否继续存活；
- Windows 上关机/注销时无窗口 Electron 主进程的 `before-quit` 触发情况；
- 窗口销毁后重建的端到端恢复；
- 后台状态的内存占用；
- omp 对悬空工具调用后再收到"继续"的处理；
- omp 扩展 UI 请求（审批）无人答复时是否存在超时；
- electron-builder NSIS 对"同名可执行文件仍在运行"的具体处理，和 `electron-updater` 的 `autoInstallOnAppQuit` 在本项目配置下的实际值。
