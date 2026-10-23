# 从 rpc-ui 迁到 TSP

> 状态:**已完成**。仓库所有者 2026-10-20 定了方向"改成 TSP:伪终端里跑交互式 omp",第 6 节三项取舍按推荐答案确认;**rpc 任务引擎已在 0.3.26 删除(§11)**,所有任务都是 TSP。这份文档是迁移记录:正文里写到 rpc 任务、`TaskRunner`、`TaskRecord.engine`、`taskEngine`、"两种引擎"的地方,描述的是迁移期间的状态,现行行为以 §11 和 `docs/design/spec.md` 为准。`--mode rpc-ui` 只剩服务进程(登录、模型列表、斜杠命令列表、内置命令)和项目 rpc-ui 池。

## 1. TSP 是什么

Tern Surface Protocol(TSP,v1)是 Tern 终端和在它面板里运行的程序之间的协议。程序不再往终端画字符,而是把界面描述成一棵语义节点树(`card`、`tool`、`md`、`list`、`editor`、`picker`……),终端负责排版、绘制、动画。消息走伪终端本身的字节流,用 APC 串:`ESC _ tsp;<动词>;<JSON> ESC \`。

- 规范:Tern SDK 文档 <https://docs.stencil.so/tern/protocol/>(transport / handshake / surfaces / documents / input / theme / operations)和元素表 <https://docs.stencil.so/tern/elements/>;类型定义是 omp 仓库的 `packages/wire/src/tsp.ts`(MIT)。
- omp 18.12.3 内置了 TSP:环境变量 `TERM_PROGRAM=tern` 时启动会发 `hello` 查询,收到回复就整个界面改走 TSP,否则用原来的 ANSI 渲染。`PI_TUI_NATIVE=0` 强制关掉。

所以"像 Tern 里的 omp 一样"的做法就是:omp-studio 扮演 Tern。用伪终端启动交互式 omp(不再加 `--mode rpc-ui`),回 `hello`,接收节点树并用 React 画出来,把用户操作作为 TSP 事件写回伪终端。

## 2. 实测(2026-10-20,omp 18.12.3,deepseek-v4-flash)

脚本 `E:\tern-probe\tsp-probe.cjs`、`tsp-scenario.cjs`(仓库外的试验脚本):node-pty 起 omp,`TERM_PROGRAM=tern`,回 `hello`、每帧回 `ack`,按步骤发事件;omp 自带的 `PI_TUI_TSP_RECORD=<文件>` 把双向消息都录成 JSONL。

| 场景 | 结果 |
|---|---|
| 握手 | omp 发 `q hello`(features `edit`/`undo`/`send`),回复后发 `o`(开 inline surface `s:1`,role `omp.session`)、`t`(主题色板)、`f`(帧) |
| 一个真实任务(todo + 两个并行子代理 + bash + 编辑) | 150 秒 203 帧,全部是结构化节点:`tool`(bash 的命令、ANSI 输出、状态、用时)、`agent`(子代理名、状态、模型、任务说明)、`checklist`(todo)、`md`(回答,流式 `text append`)、`meter`(上下文)、`effort`(思考强度)、`seg`(git 分支) |
| 发消息 | `{"ev":"send","id":"j.line/input","text":…}` 直接提交,和在输入框里回车一样 |
| 审批(`--approval-mode=always-ask`) | 输入框区域出现 `col` role `omp.editor.ask.approval`:标题 "Allow tool: bash"、命令详情、三个选项的 `list`、Details/Deny/Approve 三个按钮(`actions.click`)。回 `{"ev":"action","id":"t.actions/approve","act":"approve"}` 后门消失、命令执行、输出回来 |
| 提问(ask 工具) | role `omp.editor.ask`:问题 `md` + 选项 `list`(每项有说明) + "其他"输入。回 `{"ev":"activate","id":"t.q0","item":"t.q0/option:1"}` 后工具卡片显示答案,模型继续 |
| 模型选择器(Alt+P) | `layer` 里出现 `picker`:分组、搜索、每行模型信息;按键输入搜索词时 omp 回 `set p {query, order}`;`activate` 某个模型后 toast "Session-only model…",选择器关闭 |
| 斜杠菜单 | 输入 `/` 后 `layer` 里出现 `overlay`(锚在输入框光标)+ `list`,继续输入会过滤 |
| 会话文件 | omp 用 `OSC 1337 SetUserVar=omp_session_file=<base64 路径>` 告诉终端当前会话文件;另有 OSC 0(标题)、7(cwd)、9/99(通知) |
| Windows 伪终端 | 系统自带的 ConPTY 会吞掉 APC,一帧都收不到;node-pty 自带的 `conpty.dll` + `OpenConsole.exe`(`useConptyDll: true`)正常。仓库已依赖 node-pty(内置终端在用),这两个文件在 `node_modules/node-pty/prebuilds/win32-x64/conpty/` |

结论:审批、提问、选择器、斜杠菜单、设置面板、待办、子代理、bash 输出、上下文用量、模型和思考强度在 TSP 里都有,而且都能用事件操作。

## 3. 和现在的架构比

| | 现在(rpc-ui) | TSP |
|---|---|---|
| 进程 | `omp --mode rpc-ui`,stdio NDJSON | 交互式 `omp`,跑在伪终端里 |
| 界面谁决定 | omp-studio:把事件拼成对话、工具卡片、门、选择器(`features/conversation`、`composer`、`dialogs`、`lanes`,约 1 万行) | omp:发什么节点就画什么;omp-studio 只决定每种节点长什么样(CSS) |
| omp 加了新界面 | 要等 omp-studio 跟进(例如扩展的 `setWidget`、`setStatus` 在 rpc-ui 里只写日志、不显示,`extension-ui.ts` 的 `logPresentationRequest`) | 自动出现;新的节点种类要在渲染器里补一种 |
| 操作 | 37 个 RPC 命令 | 少数几种事件(`send`、`action`、`select`、`activate`、`toggle`、`change`、`edit`、`focus`)+ 按键字节 |
| 协议稳定性 | wire 类型从 omp tag 拷贝,omp 内部协议 | TSP v1 是公开、带版本的协议;但节点上的 `role`(比如 `omp.editor.ask.approval`)是 omp 自己的命名,不在规范里 |

## 4. 要改什么

### 4.1 主进程

- 新的 `TspSession`(替代 `OmpConnection` + `session-init` + `translate` + `event-batcher` + `dialogs`):node-pty(`useConptyDll: true`)启动 `omp --model … [--thinking …] [--resume <会话文件>]`,环境变量 `TERM_PROGRAM=tern`;解析 APC/OSC;回 `hello`(声明我们画得出的节点种类和支持的特性);按信用值回 `ack`;维护每个 surface 的节点树(`add`/`set`/`del`/`text`/`splice`/`settle`……),批量转发给渲染进程。
- 任务状态(侧栏的点、托盘、系统通知)改为从树上推:输入框区域有 `omp.editor.ask*` = 等你;有停止按钮 / 运行中的 spinner = 运行中;否则空闲。会话文件来自 `omp_session_file`,标题来自 OSC 0。
- 保留:任务池、进程上限和回收、Job Object、worktree 的 cwd、历史会话列表(读 `.jsonl`)、git、终端、文件预览、设置存储、托盘。

### 4.2 渲染进程

- 新的 TSP 渲染器:一个节点种类一个组件,外观照 Tern 里的 omp,颜色仍用 `tokens.css`。规范列了 40 多种节点,omp 实际用到的(实测统计):`col`、`row`、`text`、`md`、`code`、`ansi`、`tool`、`agent`、`checklist`、`card`、`section`、`list`/`item`、`picker`、`prefs`、`overlay`、`toast`、`editor`、`meter`、`effort`、`seg`、`kbd`、`icon`、`spinner`、`elapsed`、`shimmer`、`badge`、`kv`、`image`、`spacer`、`status`。
- 输入框:omp 树里的 `editor` 节点。按 TSP 的"原生编辑"(`edit` 特性),文字选择和编辑在我们这边做,改动作为 `edit` 事件发回去;回车和其他快捷键编码成终端按键字节写进伪终端。
- 删掉:现在自己拼的对话区、工具卡片、门、提问框、模型选择器、斜杠菜单、待办面板、子代理表、队列条、运行状态行等,由 omp 的节点替代。
- 保留:侧栏、顶栏、命令面板(omp-studio 自己的命令)、历史、git / worktree / 评审、内置终端、文件预览、设置页。

### 4.3 测试

- 回放夹具从 `fixtures/rpc/*.ndjson` 换成 omp 自己录的 TSP JSONL(`PI_TUI_TSP_RECORD`);fake omp 改为往 stdout 写 APC、从 stdin 读事件,按录制顺序回放。
- 依赖 rpc-ui 的约 27 个单元测试和 11 个 e2e 文件要重写或删除(清单见附录)。

## 5. 风险

| 风险 | 说明 | 应对 |
|---|---|---|
| `role` 不是公开契约 | 侧栏状态要靠 `omp.editor.ask*` 这类名字判断,omp 改名就失效 | 判断逻辑集中在一个纯函数里,用录制的帧做测试;omp 升级时跑一遍真机录制 |
| 依赖打包的 ConPTY | 系统 ConPTY 吞 APC | 固定 `useConptyDll: true`,打包时确认 `conpty.dll`/`OpenConsole.exe` 在 asar 外 |
| 渲染器工作量 | 40 多种节点,`ansi` 要转 HTML,`picker`/`prefs` 交互复杂 | 先做实测用到的种类;未知种类按规范画成纯文本并记日志 |
| 失去自己定的界面 | 3.0/3.1 做的过程区、改动卡片、子代理表等都会被 omp 的节点替代,外观由我们的 CSS 决定,结构由 omp 决定 | 见第 6 节第 1 问 |
| 规范之外的行为 | omp 何时开、关 surface,`dock`/`layer` 的约定,只在实测里看到 | 每种交互先录一份夹具 |

## 6. 已定的取舍(仓库所有者 2026-10-20)

| 问题 | 决定 |
|---|---|
| 1. 改动卡片(本轮改了哪些文件 +N -M、打开评审) | **保留**,改为按 git 状态计算;2026-10-20 再定:过程区只放 omp 的内容,改动摘要移到输入框上方的一行"改动条";2026-10-21 撤销:有评审视图了,改动条删掉,TSP 任务不再有改动摘要,评审入口是顶栏评审按钮、提交对话框里的"评审改动"、`Ctrl Shift D`、命令面板 |
| 2. 设置页的登录、账号、默认模型,新任务草稿的模型下拉 | **保留后台 omp**:无会话的 rpc-ui 服务进程只给这两处用,界面不变;任务对话全走 TSP |
| 3. 切换方式 | ~~并存~~ **已删除 rpc 任务引擎**(仓库所有者 2026-10-21 批准,0.3.26):设置里的"新任务的引擎"和 `setTaskEngine` IPC 去掉,`TaskRecord.engine` / `TaskState.engine` 去掉;服务进程(`--mode rpc-ui`,登录/模型列表/斜杠命令列表/内置命令)和项目 rpc-ui 池保留。老记录迁移见 §11 |

## 7. 主进程实现(TSP 引擎)

代码:`src/main/tsp/{stream,tsp-session}.ts`、`src/shared/tsp/task-status.ts`、`src/main/tasks/tsp-runner.ts`,任务池按 `TaskRecord.engine` 建 `TaskRunner`(rpc)或 `TspRunner`(tsp)。测试:`test/tsp-*.test.ts`、`test/task-tsp.test.ts`,假 omp 是 `test/fake-omp/fake-tsp-omp.ts`(伪终端里回放 `fixtures/tsp/*.jsonl`)。

- **启动**:node-pty + `useConptyDll: true`,`encoding: null`(按字节解析:规范允许分块切在 UTF-8 字符中间)。环境 `TERM_PROGRAM=tern`、`TERM_PROGRAM_VERSION`、`TERM=xterm-256color`、`COLORTERM=truecolor`。参数:`--model`、`--thinking`、`--allow-home` 和 rpc 路径一致,恢复会话用 `--resume=<会话文件>`(`omp --help` 里 `-r, --resume=<value>`,按 ID 前缀或路径),去掉 `--mode rpc-ui`。`STUDIO_TEST_OMP` 同样替换整条命令。
- **hello 回复**:`kinds` = `TSP_KINDS` 全部,`apc` 65536,`credits` 2,`cols`、`dark`、`reduceMotion`、`hour12`。`features`(终端特性,不是 omp 在查询里声明的程序特性 `edit`/`undo`/`send`)只声明我们处理得了的:`blobs`、`settle`、`adopt`、`dock`、`program-palette`、`reduce-motion`(`scroll` 2026-10-23 去掉:文档里本来就是空操作,不声明 omp 就不发);不声明 `aside`(prefs 贴在面板旁)、`styles`(`s` 样式表,程序自带 CSS)、`flow`。omp 的 `edit`/`undo`/`send` 由渲染进程的输入框决定是否发对应事件;`send` 主进程自己用于草稿的第一句话。DA1 每收到一次就回 `ESC [ ? 62 ; 22 c`(omp 启动时会连发好几个,各带一个 DA1 哨兵)。
- **ack / error**:每个数据块处理完,对块内每个 surface 回一次最高帧号的 `ack`(规范:ack 覆盖此前所有帧);被拒的 op 回 `{"ev":"error","sf","s","op","msg"}`,整帧被丢没有 `op`;JSON 坏了回 `malformed <verb> body`;分块被打断回 `chunked … dropped: interrupted`。
- **批次**:消息应用到主进程的 `TspDocument` 后按 16ms 合批,序号 = 已应用消息数;`snapshot()` 先把待发批次推出去再取文档。进程换了(回收后再打开)序号接在上一个进程之后并空一位,渲染进程发现不连续就重取快照,不会把新进程的消息接在旧文档上。
- **状态推导**(2026-10-23 改:OSC 7501 为主信号,节点补判断;`shared/tsp/{run-status,task-status}.ts`,`test/tsp-run-status.test.ts`、`test/task-tsp-osc.test.ts`、`test/tsp-task-status.test.ts`):
  - **OSC 7501**(omp 18.12.6 `utils/run-status.ts`,设置 `terminal.programStatus` 默认开;`TERM_PROGRAM=tern` 且 stdout 是 TTY 时发;实测 node-pty `useConptyDll` 下收得到)。wire:`ESC ] 7501 ; state=<s>[:kind=question|permission]:app=omp[:msg=<base64 UTF-8>] ESC \\`。实测序列:启动 `state=idle`;发消息 `working`;一轮结束 `done`;Esc 中断 `idle`(没有 done);ask 工具 `blocked:kind=question:msg=<问题>`;要审批的工具 `blocked:kind=permission:msg=Allow tool: bash Command: …`;一轮以错误结束 `error:msg=<错误原文>`(无 key / 连接被拒);`state=clear` 是 omp 不再报告(关掉 programStatus 时整个会话一条 7501 都没有,只有 `9;4`)。源码里 `attention` 只用于终端标题,不在 7501 上。
  - 映射(`resolveTaskStatus`):working → running;blocked → needs_you(kind=question → 提问、permission → 审批,msg 第一行作合成门 `dialogs[0]` 的标题,门节点到了以节点的标题为准);done → 这一轮 `completed`;error → 这一轮 `error`,omp 的原文进 `TaskState.lastTurn.error.message`(侧栏悬停、系统通知用;GateNotifier 对"回到 idle 的 error 轮"也发出错通知);idle(working 之后没有 done)→ `aborted`(不再只看用户按没按停止;没收到过 7501 的运行,如交接,才退回 `stopRequested`)。**注意**:审批通过后 omp 不再发状态,`blocked` 一直保持到这个工具结束(实测批准后 14 秒仍是 blocked),所以 blocked 期间门节点出现过又消失就算已答,回到 running(`blockedOpen`/`observeGate`)。
  - **没收到过 7501 的会话退回节点推导**(`NO_RUN_SIGNAL`;收到 `clear` 也退回)。节点推导的依据是 `fixtures/tsp/{task,approval,ask}.jsonl` 逐帧:`dock` 里 role 以 `omp.editor.ask` 开头 = needs_you(提问 `omp.editor.ask`、审批 `omp.editor.ask.approval`);`omp.working` / `omp.working.stop` / `omp.composer.stop` = running。主区 spinner 和 `omp.hud.activity` 的待办面板不可靠,不用。
  - **running 取并集**:7501 working/blocked 或节点有运行状态行 / loader。原因:7501 只在 agent 一轮、工具开始 / 结束时发,压缩、交接这类运行靠节点;而一轮的开始靠 7501(比 `omp.working` 那一帧早)。结束要两边都说结束。
  - **7501 不覆盖的两类(节点补)**:(a) dock 里 `omp.hud.activity` 下的 `omp.loader`(交接、建 worktree、分支摘要、debug 报告;`session-tree-summarize.jsonl` 第 7–8 帧)→ running,文字去图标字形后放 `TaskState.loaderText`;(b) 模态弹窗 `omp.overlay.hook-select / hook-input / hook-editor / planReview / planSave / login*`(源码 `packages/tui/src/overlays/`;hook 系列在 **dock** 里,和 composer 同一块,不是 layer)→ needs_you,合成门 id `tsp-modal`,标题取 `head` 或第一段文字(`goal-budget` / `goal-drop` 录制里的 hook-editor)。studio 自己驱动打开的 `/jobs`(`omp.overlay.jobs`)、context 报告(`omp.overlay.report`)、Agent Hub、旁路提问(`btwHistory`)、会话树不在名单里,单测用对应录制保证不算 needs_you。输入框的提问 / 审批判断(`gate.ts`)和合成的 `tsp-ask` / `tsp-approval` 门仍然只看节点。
  - 回收判据另外要求没有 `pending`/`running` 的 `tool`/`agent` 卡片(转到后台的任务)。
- **待办**(`shared/tsp/todos.ts`,依据 `fixtures/tsp/task.jsonl`,`test/tsp-todos.test.ts`,omp 18.12.3):dock 里 `omp.hud.activity` 行中 role `omp.hud.todo` 的 `checklist`(`mode:"hud"`)就是当前待办:todo 工具第一次写入时出现(帧 27),之后每次调用整体更新 `p.phases`,回合结束的最后一帧(145)随 omp 的清理消失。阶段标题带罗马数字前缀(`I. Inspect`,工具卡片里的 `omp.tool.todo` 没有),状态 `pending/active/done/dropped/blocked`。`TspRunner#syncComposer` 每次文档变化时换算成 `TodoPhase[]` 放进 `TaskState.todoPhases`(变了才发布),输入框上方的 `ComposerTop`(`features/composer/ComposerTop.tsx`)在状态行右端画待办板,HUD 药丸不画。只认 HUD、不回退到工具卡片:否则 omp 清理之后会把旧待办复活。
- **输入框上方的 HUD 全部由 studio 自己画**(2026-10-21,omp 18.12.5 实测,`test/tsp-working.test.ts`):dock 里 `omp.hud`(`omp.hud.pill` 下的 `omp.hud.seg`:作业胶囊 `▷ N`、子代理胶囊 `👥 N`)和 `omp.hud.activity`(`omp.hud.status` 下的运行状态行 `omp.working` = spinner + `elapsed` + `omp.working.sep` + `omp.working.label` + 带 Stop 键帽的 `omp.working.stop`,偶发的 `omp.loader`;待办药丸 `omp.hud.todo`)不渲染(`HIDDEN_HUD_ROLES`)。取代它们的是 `ComposerTop`:药丸 `[👥 N | ⚡ N]`(子代理数 = `countActiveAgents`,作业数 = 运行中的 bash 作业)、状态行(用时取 `TaskState.runStartedAt`,活动文字取 `deriveWorkingLabel` = `omp.working.label` 的 spans,没有时取 `omp.loader` 的文字)、待办板。运行状态仍由 `deriveTaskStatus` 判断(`omp.working` 在文档里),与是否渲染无关。
- **会话文件**:`OSC 1337 SetUserVar=omp_session_file=<base64>` 在启动时就发了,这时文件还没落盘(第一条回复之后才写);所以只在文件存在时才记进任务,在回合结束、进程退出、关闭时重试。不带 `=` 的 `SetUserVar=omp_session_file`(omp 在没有会话文件时发)当作清空:`TspRunner.#sessionFile` 记为 null,`#currentSessionFile()` 不再退回任务记录里的旧文件。`/move` 之后 omp 把会话文件搬到新目录对应的会话夹里并重发这个变量(实测),所以记录里的会话文件自动跟着换。
- **当前目录(OSC 7,2026-10-23 实测 omp 18.12.6)**:`ESC ] 7 ; file://<主机名><pathToFileURL(cwd).pathname> BEL`,启动时发一次,`/move <目录>` 之后再发(实测目录名 `目录 two`、路径含空格 → `…/omp%20work%20a1%20UdOn6r/%E7%9B%AE%E5%BD%95%20two`;Windows 盘符前有一个 `/`)。`shared/tsp/osc7.ts` 换成本机路径(`C:\…\目录 two`),`TspRunner.#onCwd` 写进 `TaskRecord.cwd`(和默认目录相同时记 null)和 `TaskState.cwd`。`TspRunner.cwd` = `record.cwd ?? worktreePath ?? 项目目录`,文件面板 / 评审 / git / 新开终端 / 主进程允许访问的根(`taskCwd` → `rootDir`)都读它;下次 `--resume` 从新目录启动(`runtime.ts` buildLaunch;分叉任务也带 cwd)。记着的目录已被删就退回默认目录并清掉记录。worktree 任务的 `worktreePath` / 分支 / 基分支不动:合并、丢弃仍按它们(丢弃 worktree 时同时清 `cwd`)。已知局限:`/wt` 让 omp 搬进它自己建的 worktree 后,studio 的 worktree 记录仍是原来的(git 面板按新 cwd 读状态,合并按旧记录)。启动时的 OSC 7 如果是符号链接解析后的另一种写法会被当成换了目录(没碰到过)。
- **标题**:OSC 0/2 是 `<Nerd Font 图标> <标题>`,去掉私有区字符;`omp` 是没有标题时的占位。分支有 PR 时 omp 在标题后追加 ` · #12`(`omp · #12` = 没有标题只有 PR):`cleanOmpTitle` 去掉后缀,`ompTitlePullRequest` 取出号放 `TaskState.prNumber`,顶栏分支胶囊旁显示 `#12` 徽标,点击 IPC `openTaskPullRequest`:主进程用自己记的号和分支的 remote(`git/pull-request-url.ts`,`pushRemote` 选的那个)推出 `https://主机/owner/repo/pull/12`,经 `parseExternalUrl` 白名单用系统浏览器打开(GitHub 风格地址;不依赖 gh)。omp 的标题只在记录里的标题为空、是草稿第一句话临时取的、或是上一次采用的 omp 标题时才覆盖——用户改过名就不再动。**改名只改本地记录**:交互模式下没有从外部改会话名的入口(rpc 的 `set_session_name` 不存在),往输入框塞 `/rename` 会混进用户的草稿。
- **通知**:不解析 OSC 9/99(omp 回合结束就发一条 `omp: Complete`,而窗口可见时不该通知;解析器里原来的 `#kitty` / `onNotify` 路径没有任何调用方,已删);`needs_you` 和结束通知走 `GateNotifier` 的 TaskState 路径,等待中的任务有一个合成的 `dialogs[0]`(`kind: "confirm"`,标题取问题/审批标题的第一行)只为让它有内容可写。
- **任务栏进度**:不读 OSC 9;4(omp 每个进程各发各的),直接按任务状态:任一任务 `running` → `setProgressBar` 不定进度,否则清除(`window/taskbar-progress.ts`,`needs_you` 不算在跑)。
- **外观事件**:深浅主题(`nativeTheme` updated)和减少动效设置变化时 `TaskPool.setAppearance` → 每个运行中的会话 `TspSession.setAppearance` 发 `{ev:"theme",dark}` / `{ev:"motion",reduce}`(只发有变化的);新起的进程 hello 读最新值。
- **进程**:Job Object 用 `assignToOwnJob`(和内置终端一样,pty 里的子进程适合放进自己的 Job),关闭先 `taskkill /T /F` 再 `pty.kill()`;进程数上限、空闲回收、worktree cwd 与 rpc 任务共用任务池的逻辑。
- **终端 → 程序的帧**:用 APC(`ESC _ tsp;e;… ESC \`),实测 node-pty 自带的 ConPTY 下 omp 能收到;规范 transport 一节说 ConPTY 输入端会丢 APC、Windows 上应该用 `ESC ] 877 ; tsp ; … ESC \`(程序两种都收),如果以后 omp 或 conpty 升级后事件不再生效,改 `encodeTspEvent` 即可。U+0080–U+009F 在 JSON 里转义。

## 8. 渲染进程实现

代码在 `src/renderer/src/features/tsp/`(节点渲染)、`features/tsp/interactive/`(输入和弹层)。`App.tsx` 里 `engine === "tsp"` 的任务挂 `TspView`(过程区)加 studio 的 `Composer`(输入框),不挂 `ConversationView`、`BtwPanel`;omp 自己的输入框卡片(role `omp.editor`)和欢迎块(role `omp.welcome`,改由 inline surface 顶部的 studio `StudioHeader` 取代:像素标志 + 任务 cwd)不画,提问/审批(`omp.editor.ask*`)照常画在 dock 里。

- **文档同步**:`tsp-store.ts` / `tsp-sync.ts` 按任务保存一份 `TspDocument`(和主进程同一份 `shared/tsp/document.ts` 归约),`tspBatch` 序号连续就增量应用,不连续就 `getTspSnapshot` 重取,重取期间到的批次先攒着再回放。组件按节点 id 订阅(`useTspNode`),节点记录不可变,没变的节点不重画。
- **画面**:inline surface(`omp.session`)= 可滚动的 `main` + 贴底的 `dock`(输入框区域)+ 铺满的 `layer`(picker / overlay / toast 的容器);screen surface(如 `/settings`)盖住整个对话区。对话列宽按等宽字符数折成列数,变化时 `resizeTsp`。
- **节点**:规范的全部节点种类各有一个组件(`nodes/`、`interactive/`),未知种类按纯文本兜底并 `console.warn` 一次。颜色不用 omp 的程序调色板(`t` 消息只保存不画):tone、样式名、omp 主题 token 按规范映射表落到 `tokens.css` 的语义变量,深浅主题和对比度沿用现有定稿。Nerd Font 私有区图标不画(没有那套字体),键帽那几个换成 ⇪⌘⌃⌥⇧⏎⇥。工具"完成"用中性色(spec §2,完成态中性)。
- **过程区文字不汉化**(所有者 2026-10-21):节点组件里 studio 自己加的文字(`N more lines`、`No changes`、`N unchanged lines`、`Copy command`、状态名、子代理统计、待办……)都是 omp 原样的英文,集中在 `features/tsp/labels.ts`,不走 i18n;`i18n/*/tsp.ts` 只剩对话区的无障碍名称和载入提示。**main 的渲染**由 `MainFlow.tsx` 负责:omp 的子节点 + 留存的状态行(§10.1)+ 恢复补回的回顾。
- **输入**:输入框是 omp 的 `editor` 节点。没有选区时的按键按 xterm 序列写进伪终端(`keys.ts`,Shift/Ctrl+Enter 等用 CSI u),omp 自己回 `set` 更新文字;选区上的输入、粘贴、剪切、输入法提交发 `edit`,Ctrl+Z 发 `undo`。新任务草稿的第一句话由主进程等输入框 `sendable` 后用 `send` 事件提交(`TspRunner.sendPrompt`)。
- **操作**:`list` 单击 `select`、双击或再点已选中项 `activate`(审批门第一项默认已选中,不这样就得双击);节点自带 `actions` 的按 `actions.ts` 发 `action` / `select` / `activate`,`toggle` / `copy` / `open` / `zoom` 由我们自己做;picker、prefs 的事件见 `interactive/` 各组件。
- **滚动**:复用 `useStickToBottom`,但对话区关掉浏览器的滚动锚定(`overflow-anchor: none`)。omp 一直在改写视口上方的节点(折叠工具卡片、去掉"思考中"),锚定会把 `scrollTop` 往上推,`useStickToBottom` 分不出这和用户上滚,一轮跑完就停在半截、出现"回到最新"。
- **测试**:单元 `test/tsp-render.test.ts`、`tsp-keys.test.ts`、`tsp-interactive.test.ts`;e2e `test/e2e/tsp.e2e.ts` 用 `fake-tsp-omp` 回放 `task` / `approval` / `ask` 三份录制,假 omp 只在收到和录制完全一致的事件后才继续,所以界面能走到下一步本身就证明事件发对了。

## 9. 还没对齐的地方

取舍 3 的前提(功能和测试对齐)已满足,rpc 任务路径已在 0.3.26 删除(§11);下面是当时的对齐清单:

- ~~侧栏和标题栏用的上下文用量、费用、思考强度对 TSP 任务是空的~~ 已由 §10.2 解析(token 分项和请求数 omp 不给,仍是 0)。
- ~~旁路提问(`/btw`)面板没有 TSP 版本~~ 已做(2026-10-21,`docs/architecture/tsp-btw.md`):omp 在 TSP 下把 `/btw` 画成 modal 弹窗,studio 读它的问答、不画它;话题 id 和历史读会话旁边的 `btw-history/`。
- hello 没声明 `aside`、`styles`、`flow`:prefs 贴在面板旁、程序自带样式表、`flow` 模式的 surface 都不支持,omp 会退回不依赖它们的画法。
- 停止 = 发 Esc;这一轮是否 `aborted` 以 OSC 7501 的 `idle`(没有 `done`)为准,没收到 7501 的运行才看用户按没按过停止(§7 状态推导)。
- 2026-10-23 已补:`md.marks`(用户消息里 `@文件` / 技能 / 提及着色,`markdown/marks.ts` + `Markdown` 的 `marks` 属性)、diff 语法高亮(`lang` 优先、其次 `path` 扩展名,旧 / 新两侧源码各高亮一次,词级强调叠在 token 上,`diff-highlight.ts`)、`list.virtual`(子项 ≥ 100 才虚拟化,复用 picker 的 `visibleRange`,`interactive/list-virtual.ts` + `use-virtual-list.ts`;行高按实际渲染量,默认等高)、`tool.lang`(bash 或没给 lang 仍走 `shell-tokens.ts`:Shiki 的 bash 语法把选项和普通参数都标成 string、`$VAR` 不着色,比手写分词差;其它 lang 走 `highlight()`)、`tone` 在 tool / ansi / text / md 上生效、`tabs` 读 `actions.click`、list / tabs / editor / picker / prefs / overlay / toast 根元素套 `nodeDomProps`(`pointer:false`:容器上的 `actions` 不挂到根,各项自己发 select / activate)、picker 的 `item.role` 前导图标和 `badges` 的 `+N`、数字 extent 大于 1 按字符 / 行算(omp `find` 发 `max:{w:40}`)、meter ring / blocks 的 `marks[].tone/title`、`item.tone:"pending"`。
- 不做:`editor` 的 `decor` / `ghost` / `lang` / `placeholder`(omp 持有输入文字,studio 的输入框是自己的 textarea,文字不回灌 omp);`editor` 的 `gutter` / `virt` 属性在 18.12.6 的 `TspEditorProps` 里并不存在(旧说法已删),vim 只画 `mode` 标签。
- ~~依赖 rpc-ui 的现有 e2e 固定跑 rpc~~ 已在 0.3.26 全部改成 fake-tsp-omp 回放(`test/e2e/launch.ts` 的 `testOmp`),rpc 专有界面的 e2e(`conversation`、`jobs`、`subagent-lanes`)随界面删除。

## 10. 混合形态:TSP 过程区 + studio 输入框(2026-10-20)

仓库所有者的要求:输入框上方的对话过程用 TSP 渲染,输入框(模型、思考强度、上下文/用量、费用、发送/停止)、侧栏、顶栏仍是 studio 自己的;新老任务显示必须一致。渲染进程的分工见 `docs/design/spec.md`;主进程让 `engine === "tsp"` 的任务对 studio 的 Composer 和 rpc 任务一样可用。

### 10.1 实测的 omp 18.12.3 行为

录制在 `E:/tern-probe/out/scn-*/record.jsonl`(`PI_TUI_TSP_RECORD`),fixtures 里的 `picker.jsonl` 等是其中几份。

- `--resume=<会话文件>` 启动后,omp 把整段旧对话重新用 TSP 节点发出来(`omp.user`、工具卡片、`omp.job.tile`、`omp.assistant`),和 Tern 里显示一致。**18.12.4 实测不再带每轮末尾的 `omp.turn.usage` 用量行**(录制 `fixtures/tsp/resume.jsonl`:3 个 `omp.user`、14 个 `omp.assistant`、0 个 `omp.turn.usage`;`test/tsp-session-extras.test.ts` 钉住),也不会重放空闲回顾 `omp.recap`:
  - 用量行:实时的轮 omp 自己发(助手消息 `col` 里最后一个子节点 `row role=omp.turn.usage`,图标 `time` + 文字 `13.4s · 728 tok · <$0.01 this turn`);恢复出来的轮 studio 从会话文件补(`main/tsp/session-extras.ts` 的 `parseSession`,口径照抄 omp 的 `TurnUsageAggregator`;渲染在 `nodes/layout.tsx` 的 `AssistantCol`,只补文档里"没有用量行的轮的最后一个 `omp.assistant`",文档轮数和文件轮数对不上时不补)。
  - 空闲回顾：omp 在一轮结束后、`recap.idleSeconds`(默认 240,夹在 1–3600)秒内没有输入、有模型、输入框是空的时,跑一次临时对话生成回顾(`recap.enabled` 默认开),用 `omp.recap` 节点显示(`row`,`title` "Recap while you were away",子节点是 `icon name=history` + `text`;omp 终端里画成 `※ recap: …` 淡色斜体,`history` 只是 TSP 里没有 ※ 字形时的占位),同时 `SessionManager.recordRecap` 把原文写进 **agent 目录 `history.db` 的 `session_recaps` 表**(`session_id` = 会话文件头的 id,`created_at` 秒)——不写会话文件。omp 自己的做法:实时每条回顾都留在对话中间(每次空闲一条),`--resume` 一条也不重放。**studio 的做法(仓库所有者 2026-10-21 定:只显示最新的一条)**:实时——main 里有多个 `omp.recap` 时只画最后一个(`useIsLatestRecap`);恢复——读 `session_recaps` 最新一条(`readLatestRecap`,只读),按 `created_at` 算出它在第几轮之后(`turnsBeforeRecap`:回顾之前开始的非 agent 用户消息数,同一秒内开始的算在前面),放回那个位置(下一轮 `omp.user` 之前,`recapBefore` / `MainFlow`),**回顾之后又有新消息也照样显示**(不再按"已过时"丢掉);实时已经收到 `omp.recap` 时不补。会话压缩过时文档轮数少于文件轮数(omp 只重发保留下来的最后几轮),从末尾对齐;落在没重发的旧轮里的不画。
- **上下文压缩的分隔(`omp.compaction`)**(实测 18.12.5 用手造的压缩会话 `--resume`,`fixtures/tsp/compact.jsonl`;omp 内嵌源码 `packages/tui/src/chat/compaction-summary-message.ts`):终端(ANSI)里是整行 `["", "──── 📷 snap-compacted · 48K→6.1K · <展开键> ────", ""]`(`$Ko.render`:`tree.horizontal` 重复,文字 `muted`、提示 `dim`,放不下时只剩文字),方法名来自 `remote-compacted` / `soft-compacted` / `handed-off` / `snap-compacted` / `shaken`,展开键展开摘要。TSP 里没有"分隔"节点:发的是 `section`,`p.role = "omp.compaction"`、`collapsible: true, collapsed: true`,`head` 是 span 数组 `Snap-compacted`(muted) + ` · 48K`(muted mono) + ` → `(dim) + `6.1K tokens`(muted mono),body 是 `text role=omp.compaction.caption`("Summary of the earlier conversation",dim)+ `md`(摘要)。`omp.handoff`("Handed off")、`omp.branch`("Branch summarized")同款。恢复压缩过的会话时它出现在保留的最后一轮和压缩后第一条用户消息之间。studio 把它的头画成整行分隔(见 spec §4 TSP 混合形态)。
- **状态行(`omp.toast.status`)**(实测 18.12.5;源码 `chrome/status-notice.ts`):终端里 `showStatus(text)` 是对话末尾一行暗色文字、留在对话里(连续的状态行会就地替换上一行)。TSP 里同一个组件的 `describe()` 返回 `toast{text, ttl: 2400, role: "omp.toast.status"}`,加在 `main` 末尾,下一帧 `del` 后换成隐藏的 `col` 占位(同一个 id 反复 del/add)——所以**文档里留不住**。切模型(`/model` 选择器、`setModelTemporary`)发的是 `Session-only model: deepseek/deepseek-v4-pro. Use Alt+M or /model for roles.`,压缩过的会话 `--resume` 时发 `Session compacted 1 time`,启动时发 `xdev: xd://: mounted …`(`fixtures/tsp/picker.jsonl`、`compact.jsonl`)。之前 studio 只把它当窗口弹层 toast 显示 2.4 秒(收到了、画了,但一闪而过);现在在节点出现的那一帧记下文字和前一个兄弟节点的 id(`shared/tsp/status-notes.ts`),画成对话里的一行暗字,不再弹层。
  - 实现:文字和前一个兄弟节点的 id 记进文档(`DocSurface.statusNotes`,`applyFrame` 里调 `statusNotesIn`),主进程和渲染进程各应用同一批消息,跟着快照走(任务界面晚于 omp 启动才打开,启动那几条也在);`fixtures/tsp/compact.jsonl` 是手造压缩会话 `--resume` + 切模型的实录,录制里选择器打开 / 选择的几帧去掉了(假 omp 不用等输入)。用户名、路径不在帧里。
- 运行中再 `send`:omp 自己排队(dock 里的 `omp.queue` / `omp.queue.item`,带 Edit 按钮)再作为 steer 交给模型,不需要 studio 自己的队列。
- `send` 一条 `/model <id>`、`/thinking low` 是普通消息(发给模型),不是命令;单独的 `/model` 才打开模型选择器。
- 输入框编辑器节点的 id 每次不同(`j.line/input`、`3.line/input`…):只能按 `k === "editor" && p.sendable === true` 找。**选择器节点的 id 也每次不同**(同一个脚本里是 `p`、`t`),必须从文档里读,不能写死。
- 提问时 dock 里的 composer(role `omp.editor`)被 `omp.editor.ask` 换掉(`fixtures/tsp/ask.jsonl` 第 37 帧 `del j`);**审批时不换**:`omp.editor.ask.approval` 插在 composer 前面(`approval.jsonl` 第 33 帧 `add t … before j`),composer 的编辑器一直 `sendable`,之后只有占位文字变了、没有 `del j`。

### 10.2 TaskState 的字段从哪来

`src/shared/tsp/composer-state.ts`(纯函数,`test/tsp-composer-state.test.ts` 逐帧验证 `fixtures/tsp/*.jsonl`),`TspRunner` 每次文档变化调用,变了才 `publish`:

| TaskState | 来源 |
|---|---|
| `model` | dock 里 `omp.composer.model` 下的 text(显示名,如 "DeepSeek V4 Flash")→ 在模型目录(`PoolDeps.listModels` = 服务进程的 `get_available_models`,和草稿输入框同一份)里按 `name` 找(omp 显示时去掉名字开头的 `Claude `,目录里的 "Claude Opus 5.5" 卡片上是 "Opus 5.5";omp 18.12.6 `packages/tui/src/status-line/segments.ts` 的 `modelDisplayName`,`composer-state.ts` 的 `isShownModelName`;以前按原名比,Claude 模型落到占位上、没有思考强度档位);重名时先取刚选的、再取任务记录里的、再取第一个;目录里没有时用名字造一个只显示的占位(`provider: ""`);输入框还没出现时用任务记录里的模型 |
| `thinkingLevel` | `omp.composer.model.effort` 的 `p.level`;`auto`(omp 自选,不是 `ThinkingLevel`)为 null,退回记录里的值 |
| `thinkingLevels` | 模型目录里的 `thinkingEfforts` 加 `off`;目录里没有时为空 |
| `contextUsage` | `omp.composer.context`(meter):`p.value` × 100 = `percent`;`p.title` 的 "8.7K of 1M tokens" 给 `tokens` / `contextWindow`(K = 10³),没有时窗口取 `p.total`、再取目录里的 `contextWindow` |
| `sessionUsage` | `omp.composer.usage` 的文字取花费 = `cost`:按量计费是 "$0.00 (+0.02) ↓"(第一个美元数);订阅登录的模型 omp 不写 `$`,花费前面是订阅记号 "S0.44"(nerd 字形时是一个图标加空格),还没花费时只有 "(sub)"(算 0)——读的是 omp 18.12.6 源码 `formatBillingSummary`(2026-10-22),订阅账号下的真实帧没录;括号里的子代理增量、★ 高级请求数不取(`parseCost`)。token 分项和请求数 omp 不给,主进程在费用或上下文用量变了时从会话文件重读(`tsp-runner` 的 `#refreshTotals`) |

输入框被提问/审批替换的那几帧读不到,沿用上一次的值。`model` / `thinkingLevel`(模型目录里唯一匹配或明确选过的)也和 rpc 一样记进 `TaskRecord`,下次 `--resume` 带 `--model` / `--thinking`。

### 10.3 切模型和思考强度

都不往输入框塞文字,直接给 omp 的节点发 TSP 事件(实测过,包括 agent 正在跑工具的时候):

- `setTaskModel(key)`:对 `omp.composer.model` 发 `{"ev":"action","act":"status.model"}`(= Alt+P)→ 等 layer 里出现 `picker`(`p.items[].id` 是 `provider/model`,`p.current` 是当前项)→ 目录里没有该项就发 Esc 关掉并报错 → 否则 `activate` 那一项 → picker 被删并出现 toast "Session-only model: <id>. …"(或输入框的模型名变了)才算完成,5 秒没有确认就 reject。这是会话内切换,不改 omp 的角色模型配置。
- `setTaskThinkingLevel(level)`:反复对 `omp.composer.model.effort` 发 `{"ev":"action","act":"thinking.cycle"}`(= ⇧⇥),每次等 `p.level` 变化,直到显示目标级别;回到起点还没有就是这个模型不支持,报错。实测 deepseek-v4-pro 的循环是 `high → max → off → auto → low → high`,每一步 <10ms。
- 两者串行执行(共用 omp 的一个选择器/一个循环键),没有进程时先启动并等输入框。

### 10.4 发送

运行中 `sendPrompt` 也直接 `send`,omp 自己排队/steer,`whenBusy` 忽略。**发送目标由 `shared/tsp/gate.ts` 的 `findMessageTarget` 定**(`#awaitComposer`):提问把输入框换掉(没有 `sendable` 的编辑器)、或有全屏面板开着(见 §10.7),`sendPrompt` 立刻 reject;切模型、切思考强度、斜杠命令在**审批在等**时也立刻 reject(它们不该顺手拒绝掉审批)。reject 的消息分别以 `composer_unavailable:`(`TSP_COMPOSER_UNAVAILABLE`)和 `screen_open:`(`TSP_SCREEN_OPEN`)开头(IPC 只带得过 message,渲染进程按它识别并显示"先回答 omp 的提问/审批"/"先关掉 omp 的面板"),不等 30 秒超时。**审批在等时 `sendPrompt` 照发**,见 §10.7。

### 10.5 引擎统一(已被 §11 取代:引擎只剩 TSP,下面是过渡期做法)

`TaskRecord.engine` 不再"创建后不变":设置 `taskEngine === "tsp"` 时,**没有进程**的 `rpc` 任务在下次启动之前被改记成 `tsp`(持久化)再建 runner,于是用 `omp --resume=<sessionFile>` 起(没有会话文件就是新会话)。入口:应用启动时 `TaskPool.init`、已归档任务的恢复和历史会话 `resume`、分叉出的新任务、以及设置在运行期间被改后的 `openTask` / `restartTask` / `sendPrompt`(`#runnerForStart` 把没进程的 rpc runner 换成 tsp runner,同 id)。正在运行的 rpc 任务不动,结束或回收后下次启动才换。设置是 `rpc` 时一切照旧。

测试:`test/task-tsp.test.ts` 的"引擎统一"三条、`TSP 任务:输入框状态、切模型、提问时的发送`。

### 10.6 斜杠命令、快速/慢速、图片(实测 omp 18.12.3)

- **命令列表**:`listSlashCommands` = 服务进程的 `get_available_commands`(内置命令一致,项目目录里自定义的命令/技能没有)。列表和任务进程无关,任务 `starting`、还没有会话时照给(以前这时返回 `[]`,渲染进程又把 `[]` 缓存了,新建任务里斜杠菜单永远不出现,B1);草稿页用 `listSlashCommands(null)`(`TaskPool.listDraftSlashCommands`,同一份)。单独的 `/cmd` 经 `send` 在空闲和运行中都当命令执行(`/fast`、`/slow`、`/model` 实测),`/fast on` 这类带参数的也行;但 `/model <id>`、`/thinking low` 是普通消息。注意单独的 `/model` 打开的是**角色**选择器("Models",会改角色模型),不是会话内切换器——切模型用 §10.3;所以 studio 里 `/model`、`/effort` 开 studio 自己的模型选择器,不发给 omp。studio 接管哪些 `/命令`(`/new /resume /settings /hotkeys /git /rename /delete /model /switch /effort /usage /context /export /btw`;`/tree /fork /goal` 见各自文档)见 `docs/architecture/conversation.md` "studio 接管的斜杠命令"。`/btw <问题>` 经 TSP `send` 当命令执行(实测,2026-10-21),omp 把它画成 layer 里的 modal 弹窗,不碰主对话:见 `docs/architecture/tsp-btw.md`。导出:TSP 任务的 HTML 导出用 `omp --export <会话文件> <输出路径>`(见 conversation.md "TSP 任务的导出")。
- **`/fast`**:`setTaskFastMode` 发 `/fast on|off`,等 toast "Fast mode enabled." / "Fast mode disabled." 才算完成,出现别的新 toast(如 "…has no service-tier control for /fast to toggle.")就以它的原文 reject。真实状态在模型名后面的闪电图标 span(U+F0E7,样式含 `icon`)——`composer-state.ts` 读成 `TspComposerInfo.fast`,模型名取非图标 span,所以不受影响;`TaskState.fastMode.enabled/active` 取它。
- **`/slow`**:同上发 `/slow on|off`,toast "Slow mode on: …" / "Slow mode off: …";omp 界面上没有慢速状态节点,`TaskState.slowMode.enabled` 按最后一次 toast 记(起始为关),`supported` 恒为 true(不支持的模型 omp 的 toast "…has no slow mode…" 作为错误抛出)。
- **图片**:TSP 没有图片通道。`sendPrompt` 把图片写到 `os.tmpdir()/omp-studio-images/<任务 id>/`,在文字后面加 `@"<路径>"`(omp 的文件提及,带空格要引号),omp 读成图片附件(工具行 "Read <路径> (image)");任务移除时删目录。
- **提问对话框(omp.editor.ask)的实测、键盘和鼠标**(实测 omp 18.12.5,deepseek-v4-flash,真实模型录制 `fixtures/tsp/ask-multi.jsonl`:三题——单选 / 多选 / 单选,走到 Review 页提交;代码 `interactive/AskGate.tsx`、`src/shared/tsp/ask-gate.ts`,单测 `test/tsp-ask-gate.test.ts`,e2e `tsp.e2e.ts` "多题提问")。
  - **节点**:根 `col role=omp.editor.ask` = `row omp.ask.head`(`tabs role=omp.ask.questions`,`items` 是每题一个 `{id:"0".."n", label}` + `{id:"submit", label:"Review"}`,`actions.click:"select"`,点标签发 `select` item=标签 id,实测能切页;答过的标签前面加 `✓ `)+ `md omp.ask.question` + 当前题的 `list omp.ask.options`(每翻一页 omp `del` 旧 list、`add` 新 list)+ `row omp.actions`(Hide / Note / Skip / Next|Submit 四个 `omp.btn`,`actions.click` = `hide` / `note` / `cancel` / `submit`,`kbd` 子节点标键)。**单选题选项 role `omp.ask.option`,多选题选项 role `omp.ask.check`**(这是区分单选 / 多选的节点标记,对应 `ask` 工具的 `multi:true`),末项 `omp.ask.other`。推荐项在 `item.p.value` 里是 `Recommended`。
  - **单选**:`select` 事件(点任何一项,包括已高亮的)= 回答并跳到下一页(tabs 加 ✓);`activate` 同效;Space 什么也不做(没有任何帧)。最后一题答完 `active:"submit"` 进 Review 页。
  - **多选**:`select` = 勾选 / 取消勾选这一项并把高亮移过去(每次都切换,已高亮的也是),选中状态是 item 的 `icon:"check"` + `tone:"accent"`(取消时两者变 `null`);Space 切换当前高亮项;`activate` / Enter = 下一页(不管点的是哪项,也不会勾选)。底栏 Next 按钮的 title 多一段 `· Toggle  space`。不勾任何项直接 Enter 会让这题在 Review 页显示 `Unanswered`(warning),B6 就是这样来的:以前再点已高亮项发 `activate`。
  - **Review 页**:`omp.ask.question`、list、Note 按钮都被 `del`,新增 `text omp.ask.notice`("All answered · Submit sends them" 或 "1 unanswered · Submit still sends the rest")和 `kv omp.ask.answers`(`items:[{k:题名, v:答案 spans}]`),Submit 按钮 title "Submit answers  enter"、文字改成 "Submit"。**页里没有 list / editor,没有任何可聚焦节点**——所以 studio 以前没有 `data-tspi-keys` 元素接键盘(B3)。**Enter 提交**(实测:发 Enter 后 `ask` 工具卡变 done,带答案);点 Submit 的 `action submit` 事件同样提交(实测)。
  - **Esc**:在任意页(含 Review)Esc = 取消整个提问(`del` 提问节点,`ask` 工具卡 `status:error`,文字 "Ask tool was cancelled by the user"),omp 随后不再继续这一轮(没有新的助手输出,要用户再发消息)。也就是说"Esc 取消整个 ask 并结束这一轮"是 omp 自己的行为;studio 之前的 Esc 落在 body 上还会被输入框当成停止任务,现在对话框接 Esc(见下)。`Note`(`action note` 或键 `n`)打开 `omp.overlay.hook-editor`(一个带编辑器的 overlay,ask 根节点被 `del`),这里 Esc 是返回(ask 根节点重新 `add`,第一页的状态;从后面的页进 Note 再返回的状态没测);`Hide`(`action hide`,Alt+H)把根 role 改成 `omp.editor.ask.hidden`,留一条摘要 + Skip + `Show`(`action show`)按钮,Show 还原成 `omp.editor.ask`。
  - **studio 的做法**:① 对话框根(`AskGateCol`,`.tspi-ask-gate`、`data-tspi-keys`、`tabIndex=-1`)自己接键盘:按键用 `encodeKey` 写进伪终端(里面的 list / editor 已经处理过的键不重复发,Review 页没人拿键盘时由它接),Esc 同时 `stopPropagation`,不冒到 Composer 的 window 监听;焦点被换页拆掉(`del` 旧 list)后由 MutationObserver 拿回根节点。② `omp.btn`(`AskButtonRow`,含审批卡的 Details / Deny / Approve)画成真 `<button>`,点 = 节点自己的 `actions.click`(`action` 事件);点按钮不抢焦点。③ 点选项(`askItemClick`):`omp.ask.check` 永远发 `select`(= 勾选切换),双击也不 `activate`(会跳页);单选 / Other / 其它列表保持"点非高亮 = `select`,再点已高亮 = `activate`"(实测单选两者都是作答)。**未实测**:Ctrl+Enter 在提问里的作用(`encodeKey` 编成 CSI-u,没发给真实 omp 试过);Other 的自由输入页和 Note 的编辑器 overlay 在 studio 里的渲染没有逐帧测;`cancel` 按钮的 `action` 事件没发过(Esc 键实测会取消)。
- **omp 弹窗(`overlay`:`/jobs` `/session` `/usage` `/changelog` `/marketplace`…)的 Esc、高度、列宽**(`interactive/Overlay.tsx`、`src/shared/tsp/overlay-esc.ts`、`table-layout.ts`,`test/tsp-overlay-esc.test.ts`,e2e `tsp.e2e.ts` "后台作业弹窗"):
  - **Esc**:`TspOverlayProps` 没有关闭动作,关它就是把 Esc 键(`\x1b`)写给 omp;弹窗底栏的 `omp.btn`("Close  esc",`actions.click: "close"`)只是同一件事的按钮。焦点通常在 studio 输入框(不在 tsp-view 里),以前这一下 Esc 只落到 Composer 的 window 监听上被当成"停止任务"(空闲时什么都没发生)。现在每个可关闭的 overlay(不含锚在光标 / 节点上的补全菜单)在 window **捕获阶段**监听 Esc:焦点在输入框 / body / 弹窗卡片上、没人处理过(`defaultPrevented`)、没有修饰键和输入法组合、没有选择器、且自己是 tsp-view 里最上面一个可关闭 overlay 时,`ctx.keys("\x1b")` + `preventDefault` + `stopPropagation`(Composer 的 Esc 看 `defaultPrevented`,不会停止任务)。tsp-view 里自己发 Esc 的控件(`textarea` / `input` / `[data-tspi-keys]`:list、ask 对话框)不重复发。
  - **叠层不是 studio 文档的 bug**:`fixtures/tsp/jobs-chart.jsonl`(omp 18.12.5)里第一个 `/jobs` 的 `layer.ov-z` 由 omp 自己 `del`(`["del","layer.ov-z"],["focus","j.line/input"]`),之后才 `add` 第二个 `layer.ov-16`;文档里没有残留层。截图里叠几层是因为 Esc 到不了 omp,弹窗一直开着、用户又从 studio 输入框发了下一条斜杠命令。**未对真实 omp 复现**"弹窗开着时 `send` 仍写进 omp 的编辑器并再开一层",以上是按录制和截图的推断;Esc 能关之后正常使用不该再叠。
  - **高度**:`.tspi-ov-card { max-height: 100% }`(相对铺满 layer 的 overlay 根),`.tspi-ov-body` 本来就是 `flex: 1; min-height: 0; overflow-y: auto`,内容多(`/changelog` 9378px)时在卡片里滚动,头和底部 Close 行留在视口内。
  - **`/tools` 第一列被挤成一个字宽**(omp 18.12.5 实录 `local://tsp-slash-overlays-18.12.5.jsonl`,NativeUiPlan 提供):body 是 `md` 节点(role `omp.report.body`),文字是 markdown 管道表(`| Tool | Description |`),**不是 `table` 节点**。原因:`.md` 的 `overflow-wrap: anywhere` 让自动表格布局的最小内容宽度变成 1 个字。修法在 `markdown/markdown.css`:`.md-table th/td` 用 `overflow-wrap: break-word`(不影响最小内容宽度)。`table` 节点(`TspTableProps`)的列轨道也加了下限(`columnTrack`:最长单元格字数 × `--tsp-cw` + 14px;不撑开的列封顶 24 字、撑开的列封顶 12 字),是同类问题的预防,`/tools` 本身不依赖它。CSS 改动没有在真实页面验证。
  - **`/jobs` 布局**:`omp.jobs.split` 的 `row` 默认 `align-items: center` 让列表漂到详情中间,`tsp.css` 按 role 改成 `stretch`;列表 `flex: 0 0 33%`、详情 `flex: 1 1 0`。
- **studio 自己发的会话级斜杠命令(`runTaskCommand`,native-ui 计划 I1,2026-10-21,omp 18.12.5)**:渲染进程只传封闭联合 `TaskCommand`(`shared/omp-output/index.ts`:`toggle`/`pin`/`retry`/`compact`/`jobsKill`/`reloadPlugins`/`dirs`/`addDir`/`removeDir`/`modelPreset`/`browserMode`/`prewalk`,各功能追加自己的成员),主进程 `taskCommandText` 拼成 `/命令`,`TaskPool.runTaskCommand(id, cmd)` 分发:TSP 任务走 `TspRunner.runSessionCommand(text, success?)`(`#runSlash` 的公开版,串在 `#exclusive` 里:`send` 之后等 `omp.toast.status`;没给 `success` 时第一条**新** toast 就是结果并返回原文,给了而新 toast 不满足就以原文抛出;和发送前文字完全相同的 toast 认不出是新的,因为 omp 复用同一个 toast 节点只换文字);rpc 任务走 `TaskRunner.runSessionCommand`(`prompt` + 收集 `command_output`,`agentInvoked:true` 当失败)。成功时 omp 不出 toast 的命令(`/jobs kill`、`/retry` 实测如此)走 `runQuietCommand`(只观察出错 toast)。弹窗/main 里加文字的命令(`/jobs` `/memory` `/tools`…)等不到 toast,超时报 "omp did not confirm";这类走 `runBuiltin`(rpc-ui,见 `omp-rpc.md`「内置命令」)。单测:`test/task-tsp.test.ts` 用 `fixtures/tsp/slash-status.jsonl`(取自 omp 18.12.5 对 `/modelpreset list`、`/dirs` 的真实录制,路径脱敏为 `C:\work\project`;因为裁掉了前面创建 toast 的命令,`/modelpreset list` 那帧的 `set u` 改成了 `add u`)。
- **`/compact` 的结局(实测 omp 18.12.5,deepseek-v4-flash,fresh `PI_CODING_AGENT_DIR` 加 Esc 跳过首次设置向导;`compaction.keepRecentTokens: 100` 让两轮短对话也能压缩)**:**没有 toast**。压缩期间 dock 的 `omp.working` 行是 "Compacting context…"(约 4 秒);**成功** = main 里新增 `section role=omp.compaction`(头 "Soft-compacted · 12K → 9.1K tokens",折叠,里面是摘要),同一帧 `del` 掉 hud 活动行;**失败**(默认配置下小会话)= main 里新增 `text`,span 样式 `error`,文字 "Error: Compaction failed: Nothing to compact (session too small)"(不是 toast、不是 overlay)。判断在纯函数 `shared/tsp/compaction.ts`(`compactionMark` / `compactionOutcome`,只认发命令之后**新增**的节点),`TspRunner.compact()` 据此 resolve / 以错误原文 reject(上限 5 分钟),`TaskPool.compactTask` 两种引擎都走 `runner.compact()`。录制 `fixtures/tsp/compact-ok.jsonl`(两轮后 /compact,路径脱敏;去掉了首次设置向导的 `s:2` 会话)、`compact-error.jsonl`;测试 `test/tsp-compaction.test.ts`、`task-tsp.test.ts`。
- **`/add-dir <路径>`(实测 omp 18.12.5,TSP)**:整行剩余部分就是路径(带空格、中文都行,**不要加引号**——引号会成为路径的一部分),toast "Added <路径>.\nWorkspace directories:\n  <cwd> (working directory)\n  <路径>"(与 S7Dirs 在 rpc-ui 里的测量一致);`taskCommandText` 因此原样拼路径,只拒绝控制字符。

### 10.7 审批门与全屏面板(Agent Hub)时的输入框(2026-10-21)

纯函数在 `src/shared/tsp/gate.ts`(`test/tsp-gate.test.ts` 对 `approval` / `ask` / `slash` 三份录制逐帧验证),主进程 `TspRunner.#awaitComposer`、渲染进程 `Composer.tsx` 共用。

**审批:输入框里写的字 = 拒绝并说明理由,和 omp 的 TUI 一样。** omp 文档(`approval-mode.md`):审批停靠在输入框上方,输入框保留光标、接受输入;发消息(来自输入框、Tern 或协作访客)会拒绝所有待批的调用(以及同一批工具之后又要批的),再把这条消息作为插话交给模型,模型知道为什么被拒。录制里审批期间 composer 的编辑器一直 `sendable`(见 §10.1 最后一条),所以 studio 的做法就是把消息原样 `send` 给它(`sendPrompt`,`findMessageTarget` 返回 `ready` 且 `approval: true`),不另发 `deny`。**这条路径(审批期间 `send`)没有录制**:依据是 omp 文档加上"编辑器 sendable 且没被换掉",e2e 和单测里假 omp 只验证 studio 发出了 `send`(`test/task-tsp.test.ts`、`tsp.e2e.ts` "审批"),没有验证真实 omp 的拒绝行为。**2026-10-21 已在真实 omp 18.12.5 上确认**:always-ask 触发审批、输入框写理由回车,工具卡变 `Tool call denied by user: bash`,模型照理由回复(`tsp-real-omp-probes.md` §14)。

- 按键:Enter(有草稿)= 拒绝并发送;Ctrl+Enter = 批准(`app.approval.approve`,有没有草稿都一样);Ctrl+O = Details(`app.tools.expand`)。批准和 Details 是对审批卡上对应按钮(role `omp.btn`,`actions.click` = `approve` / `expand`;`findGateButton`)发 `action` 事件,和点按钮同一个事件(`approval.jsonl` 录到了 `approve`,`expand` / `deny` 的点击没录)。Esc = 拒绝(omp 自己的键,Composer 的 Esc 照旧发 Esc)。
- 门:主进程给审批合成的 `dialogs[0]` id 是 `tsp-approval`,提问是 `tsp-ask`(`TSP_APPROVAL_DIALOG_ID` / `TSP_ASK_DIALOG_ID`;`deriveTaskStatus().ask.approval` = 节点 role 是 `omp.editor.ask.approval`)。输入框按它区分:提问仍不能发送(placeholder "先在上面回答 omp 的提问…"),审批能发(placeholder "拒绝并告诉 omp 该怎么做…")。
- 切模型、思考强度、斜杠命令(`#runSlash`)在审批期间仍 reject(`composer_unavailable`),不然它们的 `send` 会顺手把审批拒掉。

**面板开着时输入框不发(B5)。** 面板 = 全屏 surface(`mode: "screen"`,`/settings` 的录制里是 `s:2`)或 **Agent Hub**:实测(omp 18.12.5,`fixtures/tsp/hub-steer.jsonl`)Hub 是 inline surface `layer` 里的 `picker`(`tabs` 含 `agents`;`hasAgentHub`),不是 screen surface。`findMessageTarget` 看到任一种就返回 `panel`,`sendPrompt` 立刻 reject(`screen_open:`),不再把消息当成对主代理的插话(旧行为:消息写进主会话的 composer)。输入框这时:发送按钮禁用、Enter 不发、placeholder 换成提示、工具行加一条 `composer-note`("面板开着,Esc 关掉后再发送");Esc(以及运行中的停止按钮)只把 Esc 键交给 omp 关面板,**不**当成停止主代理、也不记 `stopRequested`。**给子代理 steer 不用单独路由**:Hub 里 `activate` 一个子代理后 omp 进入聚焦模式(dock 里 `omp.composer.focus`),Hub 关掉,同一个编辑器的 `send` 就 steer 那个子代理(实测),`findMessageTarget` 此时是 `ready`,studio 照常发。聚焦模式下输入框还没有"正在给 X 发"的标识,Stop/Esc 也是回主会话,留给后面的原生子代理面板。

### 10.8 后台作业(2026-10-21,omp 18.12.5,S2Jobs)

纯函数 `src/shared/tsp/jobs.ts`(`test/tsp-jobs.test.ts`,录制 `jobs-chart` / `hub-steer` / `jobs-kill`),渲染进程 `features/composer/{tsp-jobs-store,StatusPills,jobs-slash}`(药丸 `⚡ N` 只数运行中的 bash 作业,点它直接打开 omp 的作业弹窗;子代理在子代理面板)。2026-10-23 起没有 studio 自己的作业看板(`JobsBoard` / `TspJobActions` 已删)。

- **作业在文档里的两处**(role 是 omp 自己的命名,不是规范):hud 作业胶囊 `omp.hud.seg`(`actions.click = "jobs.open"`),**只在有作业运行中时存在**,`title` = `"2 jobs running  /jobs\n<id>  <标题>\n…"`(第一行之后每行一个作业,id 和标题间两个空格;bash 的 id 是 `bg_N`,子代理作业的 id 就是子代理名,同名有 `agent` 节点);`/jobs` 弹窗 `omp.overlay.jobs` 里 `omp.jobs.master` 下的 `list`,每个 `item` 的 `title` 第二行是 `<Running|Done|Failed|Cancelled> · <bash|…> · <id>`,`value` 是时长(`43.9s`、`305ms`)。弹窗里状态最全,但只有它开着时在文档里;子代理自己起的 bash 作业(如 `bg_2`)也列在里面,`label` 的 span 带 `└─ ` 前缀,标题第一行是纯命令。
- **合并**:`mergeTspJobs` 把每次的快照并进已知作业:开始时间沿用第一次看到的;已知运行中而快照里没了 → 子代理按 `agent` 节点(`done` / `failed` / `aborted`),其余记为完成;弹窗里的状态覆盖推断。结束动作成功后 `markJobsCancelled`。
- **`/jobs kill <id>|all`(实测,真实 omp,`fixtures/tsp/jobs-kill.jsonl`)**:成功时**没有任何 toast**,只是对应的 `omp.tool.bash` 卡片变 `status: "cancelled"`(`note: "cancelled"`,输出 `[Command cancelled]`),之后 `/jobs` 弹窗里该作业是 `Cancelled · bash · bg_1`(失败的 `node -e "process.exit(3)"` 是 `Failed`,tone `error`)。出错发 toast:未知 id `No running background job with id "nope".`,缺参数 `Usage: /jobs kill <id>|all`。所以 `TspRunner.runQuietCommand`(`TaskPool.runTaskCommand` 对 TSP 的 `jobsKill` 用它)发出后观察 1.5 秒:出现新 toast 就以原文 reject,没有就算成功。子代理作业的 `/jobs kill <name>` 没实测,界面不提供(子代理的结束在子代理面板里)。
- **打开 omp 的作业弹窗**:输出文本只在 `/jobs` 弹窗选中项的详情(`omp.jobs.output`,ansi)里,没有别的通道,所以药丸和 `/jobs` 都直接打开它:`openTspJobs(taskId, jobId)` 弹窗已开着就只发 `select`;没开就点 hud 胶囊(`jobs.open`),没有胶囊就 `sendPrompt("/jobs")`,弹窗出现后再 `select`。`select` 的 `id` 是作业列表(`<n>.split/master/jobs`)、`item` 是列表项(`<列表>/bg_1`)(`findJobsOverlayItem`):omp 18.12.6 的 `packages/tui/src/native/backend.ts` 按 `id` 找组件,把以 `<id>/` 开头的 `item` 换回列表 key。**实测(2026-10-23,omp 18.12.6,deepseek-v4-flash,两个 60 秒的后台 `node count.js`)**:点药丸弹窗打开、默认选中 bg_1;发旧形状 `id = item = 列表项`(2026-10-23 前的写法)选中**不变**,新形状选中切到 bg_2;Esc 关掉后 `/jobs` 重新打开。弹窗详情里有 omp 作业小部件的进度条(`omp.job.widget.meter`,"steps passed 25/60");hud 悬停卡片里的磁贴进度条(`omp.job.tile.meter`)也在录制里,studio 把它画在药丸作业那一段的悬停卡片里(见下一条)。当时有截图,已删。
- **hud 作业胶囊的悬停卡片**(omp 18.12.5 录制 `fixtures/tsp/jobs-chart.jsonl`;2026-10-23 omp 18.12.6 + deepseek-v4-flash 实测一个 60 秒的后台 `node count.js`,开始约 15 秒后卡片里出现进度条,标题换成小部件写的 `count.js A · steps passed`,数字是 `19 ▲ 1800%`,当时有截图,已删):胶囊节点的 `hovercard` 属性是一棵不带 id 的节点树(`TspPropNode`),`omp.jobs.hovercard` > `omp.job.tiles` > 每个作业一个 `omp.job.tile`:头一行 `omp.job.tile.head`(`.dot`、`.title` 命令、`.id`);omp 的作业小部件(`widget` 角色的模型读输出写出规则,没配 `widget` 时用 `smol`)有进度后是 `.figure`(`done 21`)、`meter`(`.meter`,`value` 0-1)、`.stats`(`passed 21 · failed 0`)、`.stage`(当前阶段),在那之前是一行 `.lead`(最近的输出)。studio 不画 hud,药丸作业那一段的悬停卡片照它画(`deriveJobTiles`):进度条复用 `meter` 的 `MeterView`,数字放在进度条右边,其余文字按顺序一行一条。胶囊只在有作业运行中时存在,所以卡片也只在那时有内容。
- **`/jobs`** 是 `tsp: "studio"` 命令:不带参数打开 omp 的作业弹窗并选中第一个运行中的 bash 作业(没有运行中的选最近的那个,没有 bash 作业只提示),`kill` 由主进程拼命令(渲染进程不发自由文本)。

### 目标模式(TSP,2026-10-21,omp 18.12.5,R3Goal)

`/goal` 在 TSP 任务里也是 studio 的命令(`tsp: "studio"`),目标条(`features/goal/GoalStrip`)挂在 `TspView` 顶部,数据和 rpc 任务一样是 `TaskState.goal`。实测用真实 omp 18.12.5 + 临时 agent 目录(`startup.setupWizard=false`)录了四份:`fixtures/tsp/goal-{pause-resume,drop,budget,flow}.jsonl`。

- **状态在 omp 输入框卡片上**:role `omp.composer.fact` 的 `seg`(现在 id 是 `j.bar/extras/mode`)文字 `Goal <已用>` / 有预算时 `Goal <已用>/<预算>`(数字是 omp 缩写的 K/M/B:`Goal 1.2K`、`Goal 2.1K/1.5K`),图标 `goal` = 进行中、`pause`(tone warning)= 已暂停、`warning` = 预算用尽;没有目标没有这个节点。完成和放弃都是节点消失。omp 的输入框卡片 studio 不画(`TspChildren`),所以不存在"omp 自己又画一条目标"的重复,不需要隐藏。
- **选择器 / 弹窗开着时整个输入框卡片从文档里拿掉**(`del j`),卡片回来才重新出现:卡片不在 = 不知道,沿用上一次;卡片在而没有事实行 = 没有目标(`deriveGoalFact` 的 `composer` 字段)。
- **目标文字不在文档里**(只在 `/goal` 选择器标题里被截成 40 字):读会话文件。每次目标变化 omp 追加 `{"type":"mode_change","mode":"goal"|"goal_paused","data":{"goal":{id,objective,status,tokensUsed,tokenBudget?,timeUsedSeconds,…}}}`;完成时先一条 `status:"complete"`,约 1 秒后 `{"mode":"none"}`;`/goal drop` 只有 `none`,没有 dropped 记录。`omp-output/goal.ts` 的 `parseGoalSession` 读尾部 256 KB;读不到就先用 studio 创建时发出去的文字(`expectObjective`),之后每次用量变化再试。
- **命令**:`/goal` 无参数 → 打开选择器(进行中:Show details / Adjust budget… / Pause / Drop;已暂停:Resume / Show details / Adjust budget… / Drop;没有目标:"Goal objective" 编辑弹窗)——studio 不发无参数的 `/goal`;`/goal <文字>` 创建,成功**没有 toast**(事实行出现就是成功),已有目标时 toast `Goal mode is already active. Use /goal to manage it, or /goal drop to start over.`;`/goal pause` → toast `Goal mode paused.`;`/goal resume` → `Goal mode resumed.`;`/goal drop` → 选择器 `Drop goal?`(Yes id `0` / No id `1`),`activate` Yes → toast `Goal dropped.`。agent 在轮次中途 `/goal pause` 也立即生效(toast + 图标同一帧)。
- **主进程**:`TspRunner.goal(op, objective?)`(`task-pool.taskGoal` 按引擎分派,IPC `taskGoal` 和校验不变)在 `#exclusive` 里做;状态由 `tasks/tsp-goal.ts` 的 `TspGoalTracker` 在每次文档变化时读事实行(`shared/tsp/goal.ts`,纯函数,逐帧测试 `test/tsp-goal.test.ts`),变了才发布;进程换 / 退出清空。事实行消失且会话文件里最后一条是 `complete` 时发一次 `TaskNotice goal_complete`(`TspRunnerHost.onNotice`)。
- **没做 / 局限**:`/goal` 的预算(`token_budget` / "Adjust budget…")studio 没有入口(同 rpc);预算用尽的记录文件状态是 `budget-limited`、事实行图标 `warning`,都实测过。`goal.enabled=false` 时 `/goal x` 的行为没测(omp 默认开)。`/goal resume` 在没有已暂停目标时 omp 在 main 里加一段 `Warning: No paused goal to resume.` 文字而不是 toast——界面只在已暂停时给"继续",所以 studio 不会发出这条;发出了也只会超时报"omp did not confirm"。`/guided-goal`(无参数)是一条给模型的提示模板(模型会反问目标),不是 omp 本地命令,保持直通。
- 测试:`test/tsp-goal.test.ts`(事实行、选择器、预算、会话文件解析、tracker)、`test/task-tsp.test.ts` 的"目标模式"(fake-tsp-omp 严格匹配事件序列 create / pause / resume / drop+activate)、`test/e2e/tsp.e2e.ts` 的"目标条(TSP…)"。
- **"Goal complete complete"(2026-10-21 查)**:这个重复词是 omp 自己的:agent 调 goal 工具标记完成时,omp 在对话里画一张工具卡,标题 `title` 的 span 是 `Goal`(toolTitle)+ `complete`(muted,工具的 op 参数)+ `complete`(success,结果状态),见 `fixtures/tsp/goal-budget.jsonl` 里 `["set","12",{"title":[{"t":"Goal",…},{"t":"complete","s":"muted"},{"t":"complete","s":"success strong"}]…`。studio 没有往 omp 的文字后拼状态词:`shared/tsp/goal.ts` 只读事实行,`TspNode` 原样画 span,完成的 toast 是 studio 自己的 `goal.completed`(zh `目标已完成` / en `Goal complete`,不拼状态)。omp 的工具卡文字属于"过程区文字不汉化",不改。

## 附录:依赖 rpc-ui 的代码

完整清单(文件、符号、命令、帧、测试)由只读盘点生成,要点:

- 进程层:`src/main/omp/{launch-args,omp-connection,frame-decoder,session-init}.ts`,`src/main/tasks/{task-runner,task-machine,translate,event-batcher,dialogs,subagent-tracker,subagent-record,session-extras,goal-state,session-tree,convert}.ts`,`src/shared/omp-wire/rpc-wire.generated.ts`。
- 服务进程:`src/main/service/{service-omp,default-model,login}.ts`,`src/main/ipc/account-handlers.ts`。
- 渲染:`features/{conversation,composer,dialogs,lanes,btw,goal}`,`store/{transcript,lanes,btw}-store.ts`,`shared/{transcript,subagents,btw}.ts`。
- 测试:`fixtures/rpc/`、`test/fake-omp/`、`scripts/{record-rpc,update-rpc-wire}.ts`,约 27 个 vitest 文件,e2e 的 `conversation`、`subagent-lanes`、`jobs`、`main-ui`、`clipboard`、`review`、`tray`、`terminal`、`file-preview`、`git-worktree`、`model-picker`、`custom-models`。

## 11. rpc 任务引擎已删除(0.3.26,仓库所有者 2026-10-21 批准)

- **删掉的**:`tasks/{task-runner,translate,event-batcher,dialogs,subagent-tracker,subagent-record,session-extras,goal-state}.ts`、`omp/session-init.ts`、`ipc/subagent-handlers.ts`、`scripts/record-rpc.ts`(`npm run rpc:record`)、`fixtures/rpc/`(只留 `bash-tool.ndjson`,给 `OmpConnection` 的单测)、渲染进程的 `ConversationView` 及其过程行 / 门(`Gate*`)/ 泳道(`lanes`)/ 队列条 / 状态栏、`store/{transcript,lanes}-store`、设置里的"新任务的引擎"、IPC `getTranscript / removeQueuedMessage / promoteQueuedMessage / respondDialog / runBash / abortBash / getSubagents / getSubagentDetail / steerSubagent / cancelSubagent / setTaskEngine` 和事件 `transcript / slashCommands / subagents`。`TaskState` 去掉 `engine / queue / runningSubagents / usageLimit / tokensPerSecond / contextParts`,`DialogRequest` 只剩 TSP 合成的 `confirm`,`TaskNotice` 只剩 `goal_complete`。评审的"改动说明"页签(读 rpc 对话流)一并删除。
- **保留的**:`serviceOmp`、`service/project-omp.ts`、`omp/omp-connection.ts`(rpc-ui 客户端)、`rpc-wire.generated.ts` 和 `npm run rpc:update-wire`、`test/fake-omp/fake-omp.ts`(只给连接 / 服务进程的单测)。子代理面板(`features/agents`)的记录视图还用 `conversation/{ProcessDetails,ToolViews,model,tool-view}` 渲染子代理的会话记录。
- **老任务迁移**:`TaskRegistry.load` 把每条记录的 `engine` 字段(`rpc` / `tsp` / 没有)丢掉,其余原样保留(会话文件、标题、模型、归档状态、`updatedAt`);下次保存时落盘。所有任务打开时都是 `omp --resume=<sessionFile>`(没有会话文件就是新会话)。测试:`test/task-registry.test.ts`(迁移)、`test/task-tsp.test.ts`"rpc 引擎时代的老任务"。设置文件里残留的 `taskEngine` 会在下次写设置时被丢掉(`sanitize` 只认已知字段)。

### 10.1 补充（2026-10-23）：每轮用量合一

每轮用量只剩 `session-extras.ts` 的 `parseSession` 一份（turn 里直接带 cost，另加合成 developer 消息清零，同 omp `l7e`）；删了 `turn-costs.ts`、`getTspTurnCosts`、`turn-cost-store` 和渲染端"从末尾对齐"。费用写法照 omp `tLo`：不到 0.005 写 `<$0.01`，否则两位小数，恢复的行和实时的行一致（取代之前"用准确值"的做法）。

