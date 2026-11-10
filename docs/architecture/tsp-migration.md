# TSP:伪终端里的交互式 omp

> 所有任务都是 TSP:omp-studio 扮演 Tern 终端,伪终端里跑交互式 omp,把它发来的节点树画出来(仓库所有者 2026-10-20 定方向;rpc 任务引擎 0.3.26 删除,§11)。`--mode rpc-ui` 只剩服务进程(登录、模型列表、内置命令)和项目 rpc-ui 池(斜杠命令列表)。界面规格以 `docs/design/spec.md` 为准。

## 1. TSP 是什么

Tern Surface Protocol(TSP,v1)是 Tern 终端和面板里程序之间的协议:程序把界面描述成一棵语义节点树(`card`、`tool`、`md`、`list`、`editor`、`picker`……),终端负责排版、绘制、动画。消息走伪终端字节流里的 APC 串:`ESC _ tsp;<动词>;<JSON> ESC \`。

- 规范:<https://docs.stencil.so/tern/protocol/>(transport / handshake / surfaces / documents / input / theme / operations)、元素表 <https://docs.stencil.so/tern/elements/>;类型定义是 omp 仓库的 `packages/wire/src/tsp.ts`(MIT)。
- omp(18.12.3 起)在 `TERM_PROGRAM=tern` 时启动发 `hello` 查询,收到回复就整个界面改走 TSP,否则用 ANSI 渲染;`PI_TUI_NATIVE=0` 强制关掉。`PI_TUI_TSP_RECORD=<文件>` 把双向消息录成 JSONL(`fixtures/tsp/*.jsonl` 都是这样录的)。

## 2. 实测(2026-10-20,omp 18.12.3,deepseek-v4-flash)

试验脚本在仓库外(`E:\tern-probe\`):node-pty 起 omp、回 `hello`、每帧回 `ack`、按步骤发事件。

| 场景 | 结果 |
|---|---|
| 握手 | omp 发 `q hello`(features `edit`/`undo`/`send`),回复后发 `o`(开 inline surface `s:1`,role `omp.session`)、`t`(主题色板)、`f`(帧) |
| 真实任务(todo + 两个并行子代理 + bash + 编辑) | 全部是结构化节点:`tool`、`agent`、`checklist`、`md`(流式 `text append`)、`meter`、`effort`、`seg` |
| 发消息 | `{"ev":"send","id":"j.line/input","text":…}` = 输入框里回车 |
| 审批(`--approval-mode=always-ask`) | 输入框区域出现 `col` role `omp.editor.ask.approval`;回 `{"ev":"action","id":"t.actions/approve","act":"approve"}` 后执行 |
| 提问(ask 工具) | role `omp.editor.ask`;回 `{"ev":"activate","id":"t.q0","item":"t.q0/option:1"}` 后模型继续 |
| 模型选择器(Alt+P) | `layer` 里出现 `picker`;搜索时 omp 回 `set p {query, order}`;`activate` 后 toast "Session-only model…" |
| 斜杠菜单 | 输入 `/` 后 `layer` 里出现锚在光标的 `overlay` + `list` |
| 会话文件 | `OSC 1337 SetUserVar=omp_session_file=<base64 路径>`;另有 OSC 0(标题)、7(cwd)、9/99(通知) |
| Windows 伪终端 | **系统 ConPTY 吞掉 APC,一帧都收不到**;node-pty 自带的 `conpty.dll` + `OpenConsole.exe`(`useConptyDll: true`,在 `node_modules/node-pty/prebuilds/win32-x64/conpty/`)正常 |

## 3. 分工

| | TSP |
|---|---|
| 进程 | 交互式 `omp`,跑在伪终端里 |
| 界面谁决定 | 结构由 omp 决定(发什么节点就画什么),外观由 studio 的 CSS 决定 |
| omp 加了新界面 | 自动出现;新的节点种类要在渲染器里补一种 |
| 操作 | 少数几种事件(`send`、`action`、`select`、`activate`、`toggle`、`change`、`edit`、`focus`)+ 按键字节 |
| 协议稳定性 | TSP v1 是公开、带版本的协议;**节点上的 `role`(如 `omp.editor.ask.approval`)是 omp 自己的命名,不在规范里** |

## 4. 结构

### 4.1 主进程

`TspSession`(`src/main/tsp/`)起 pty、回 `hello`、解析 APC/OSC、按信用值回 `ack`、维护每个 surface 的节点树并合批推给渲染进程;`TspRunner`(`src/main/tasks/tsp-runner.ts`)从树上推任务状态(侧栏点、托盘、通知)。任务池、进程上限和回收、Job Object、worktree cwd、历史会话、git、终端、文件预览、设置存储、托盘不依赖 TSP。细节 §7。

### 4.2 渲染进程

一个节点种类一个组件(`features/tsp/nodes/`、`interactive/`,签名统一是 `NodeProps`),外观照 Tern 里的 omp,颜色用 `tokens.css`。过程区(对话、工具卡片、门、提问框、选择器、斜杠菜单、待办、子代理、排队)都是 omp 的节点;侧栏、顶栏、命令面板、历史、git / worktree / 评审、内置终端、文件预览、设置页、输入框是 studio 自己的(§10)。细节 §8。

### 4.3 测试

回放夹具是 omp 录的 TSP JSONL(`fixtures/tsp/`);假 omp `test/fake-omp/fake-tsp-omp.ts` 在伪终端里写 APC、从 stdin 读事件,按录制顺序回放。

## 5. 风险

| 风险 | 应对 |
|---|---|
| `role` 不是公开契约,omp 改名就失效 | 判断逻辑集中在 `src/shared/tsp/` 的纯函数里,用录制的帧测;omp 升级时跑一遍真机录制 |
| 系统 ConPTY 吞 APC | 固定 `useConptyDll: true`,打包时确认 `conpty.dll`/`OpenConsole.exe` 在 asar 外 |
| 节点种类多,`ansi` / `picker` / `prefs` 复杂 | 未知种类按纯文本画并记日志 |
| 规范之外的行为(何时开关 surface,`dock`/`layer` 的约定)只能实测 | 每种交互先录一份夹具 |

## 6. 已定的取舍(仓库所有者 2026-10-20)

| 问题 | 决定 |
|---|---|
| 1. 改动卡片 | **没有改动卡片和改动条**(所有者 2026-10-21 定:评审视图已能看全部改动);评审入口是顶栏评审按钮、提交对话框的"评审改动"、`Ctrl Shift D`、命令面板 |
| 2. 设置页的登录、账号、默认模型,新任务草稿的模型下拉 | **保留后台 omp**:无会话的 rpc-ui 服务进程只给这些用;任务对话全走 TSP |
| 3. 切换方式 | **只有 TSP**(所有者 2026-10-21 批准删除 rpc 任务引擎,0.3.26),见 §11 |

## 7. 主进程实现

代码:`src/main/tsp/{stream,tsp-session}.ts`、`src/shared/tsp/task-status.ts`、`src/main/tasks/tsp-runner.ts`。测试:`test/tsp-*.test.ts`、`test/task-tsp.test.ts`,假 omp 回放 `fixtures/tsp/*.jsonl`。

- **启动**:node-pty + `useConptyDll: true`,`encoding: null`(按字节解析:规范允许分块切在 UTF-8 字符中间)。环境 `TERM_PROGRAM=tern` 等(`buildLaunch`)。参数 `--model`、`--thinking`、`--allow-home`;恢复会话用 `--resume=<会话文件>`(按 ID 前缀或路径)。`STUDIO_TEST_OMP` 替换整条命令。
- **hello 回复**(`tsp-session.ts`):`kinds` 声明 `TSP_KINDS` 里除 `UNSUPPORTED_KINDS` 外的全部。`json`(omp 18.14 的可折叠 JSON 树)不声明:没有组件,omp 退回 tree / 文字行(源码 `tool-execution.ts` 的 `cx.supports("json")`)。`button`、`shell` 出问题时加回 `UNSUPPORTED_KINDS`,omp 就退回 `omp.btn` 行和 `code` 节点,两套组件都留着。`features`(终端特性,不是 omp 查询里的程序特性 `edit`/`undo`/`send`)只声明处理得了的:`blobs`、`settle`、`adopt`、`dock`、`reduce-motion`。不声明的:`scroll`(规范里是空操作)、`program-palette`(`t` 调色板消息 omp 18.14 已删;18.13 及更早不看这个特性照发 `t`,按未知动词忽略)、`aside`、`styles`、`flow`(omp 会退回不依赖它们的画法)。omp 的 `edit`/`undo`/`send` 由输入框决定是否发;`send` 主进程用于草稿的第一句话。DA1 每次都回(omp 启动时连发好几个 DA1 哨兵)。生成类型 `rpc-wire.generated.ts`、`tsp.generated.ts` 取自 omp v18.14.0。
- **button 和 shell 节点**(hello 声明了这两种;实测 omp 18.18.6,录制 `fixtures/tsp/shell-bash.jsonl`、`button-approval.jsonl`、`button-ask.jsonl`,`test/tsp-shell-view.test.ts` 逐帧验证):
  - **button**(omp ≥18.14.2):提问 / 审批 / 弹窗的按钮发成 `button` 节点,role 仍是 `omp.btn`,`text`、`keys`、`variant`、`tone`、`title`、`actions.click` 都在 props 里,没有子节点(审批 Details 点开后 `text` 变成 `Less`)。`interactive/Button.tsx` 同时画 `button` 和旧的 `row omp.btn`(子节点是文字和 `kbd`):点 = `actions.click`(没有就是 `click`,规范),`disabled` / `busy` 不发,带 `href` 的走 `runAction`。`gate.ts`、`btw.ts`、`context-report.ts` 只看 role 和 `actions.click`,新旧都认(`test/tsp-gate.test.ts`、`test/context-report.test.ts`)。`tabs` 的 `variant:"segmented"`(omp 只在声明了 button 时加,如 `/git`)画成分段控件,事件不变;这一项没有录制,只按规范写。
  - **shell**(omp ≥18.17):bash 卡片的命令区(role `omp.tool.bash.command`)是 `shell` 节点(`presentation`、`replayEpoch`、`liveOrigin`、`preview`),运行中每个 trace 事件整份 `set` 一次 presentation。PTY、`!` 命令这类没有 trace 的仍发 `code`,所以 `Code` 组件照留。`nodes/shell.tsx` + `shell-view.ts` 照 omp ANSI 渲染器(`tui/src/tools/shell-viz-render.ts`)的规则画 omp 算好的行,不自己解析 shell;`presentation.output` 不画(输出另有 ansi 节点)。实测形状(`&&` 链拆行、失败片段 ×、`for` 循环头、内嵌脚本 chip)见录制和单测。
  - **事件**:第一行右端常显 `Pseudo | Raw` 分段(仓库所有者 2026-11-10 定;omp 规范 "The Raw/Pseudo switch and menu stay on the first line"),点了发 `{ev:"action", id:<shell 节点>, act:"shell-viz", value:"view:raw"|"view:pseudo"}`,实测下一帧 `preferences.view` 就变;当前态只看 omp 回来的 `preferences.view`。片段带 `expanded` 的是折叠块,点了发 `value:"expand:<片段的 node>"`(omp 那边是开关,回来 `expandedNodes` 带上它)。图层菜单、split、inspector 回放、`select`、完成后的高亮余迹不做。
- **ack / error**:每个数据块处理完,对块内每个 surface 回一次最高帧号的 `ack`(规范:ack 覆盖此前所有帧);被拒的 op 回 `error` 事件(整帧被丢没有 `op`),JSON 坏了、分块被打断也回 error。
- **批次**:消息应用到主进程的 `TspDocument` 后合批推给渲染进程,序号 = 已应用消息数;`snapshot()` 先把待发批次推出去再取文档。进程换了(回收后再打开)序号接在上一个进程之后并空一位,渲染进程发现不连续就重取快照,不会把新进程的消息接在旧文档上。
  - **时机**(`src/main/platform/batch-timer.ts`):距上一批已满一个间隔就在下一轮事件循环发(同一次 pty 读到的消息仍是一批),刚发过才等。不用"第一条到了就 `setTimeout`":Windows 上 Node 的计时器按系统时钟格对齐,实测要等约 31ms,而真实节奏下一批几乎总是只有 1 条。实测(2026-10-25,`task` 录制原速回放)主进程收到 → 渲染进程画完下一帧中位 13.4ms,渲染进程这边不到 1ms,大头是等显示器的下一帧。
- **状态推导**(OSC 7501 为主信号,节点补判断;`shared/tsp/{run-status,task-status}.ts`,`test/tsp-run-status.test.ts`、`test/task-tsp-osc.test.ts`、`test/tsp-task-status.test.ts`):
  - **OSC 7501**(omp 18.12.6 `utils/run-status.ts`,设置 `terminal.programStatus` 默认开;`TERM_PROGRAM=tern` 且 stdout 是 TTY 时发;实测 `useConptyDll` 下收得到)。wire:`ESC ] 7501 ; state=<s>[:kind=question|permission]:app=omp[:msg=<base64 UTF-8>] ESC \\`。实测序列:启动 `idle`;发消息 `working`;一轮结束 `done`;Esc 中断 `idle`(没有 done);ask `blocked:kind=question`;审批 `blocked:kind=permission:msg=Allow tool: bash Command: …`;一轮以错误结束 `error:msg=<错误原文>`;`clear` = omp 不再报告(关掉 programStatus 时一条 7501 都没有)。`attention` 只用于终端标题,不在 7501 上。
  - 映射(`resolveTaskStatus`):working → running;blocked → needs_you(question → 提问、permission → 审批,msg 第一行作合成门 `dialogs[0]` 的标题,门节点到了以节点为准);done → 这一轮 `completed`;error → 这一轮 `error`,原文进 `TaskState.lastTurn.error.message`(侧栏悬停、通知用);working 之后 idle 没有 done → `aborted`(没收到过 7501 的运行,如交接,才看 `stopRequested`)。**注意**:审批通过后 omp 不再发状态,`blocked` 一直保持到工具结束(实测批准后 14 秒仍是 blocked),所以 blocked 期间门节点出现过又消失就算已答,回到 running(`blockedOpen`/`observeGate`)。
  - **没收到过 7501(或收到 `clear`)退回节点推导**(`NO_RUN_SIGNAL`,依据 `fixtures/tsp/{task,approval,ask}.jsonl` 逐帧):`dock` 里 role 以 `omp.editor.ask` 开头 = needs_you;`omp.working` / `omp.working.stop` / `omp.composer.stop` = running。主区 spinner 和 `omp.hud.activity` 的待办面板不可靠,不用。
  - **running 取并集**:7501 working/blocked 或节点有运行状态行 / loader。7501 只在 agent 一轮、工具开始 / 结束时发,压缩、交接这类运行靠节点;一轮的开始靠 7501(比 `omp.working` 那一帧早)。结束要两边都说结束。
  - **7501 不覆盖的两类(节点补)**:(a) dock 里 `omp.hud.activity` 下的 `omp.loader`(交接、建 worktree、分支摘要、debug 报告)→ running,文字放 `TaskState.loaderText`;(b) 模态弹窗 `omp.overlay.hook-select / hook-input / hook-editor / planReview / planSave / login*`(hook 系列在 **dock** 里,不是 layer)→ needs_you,合成门 id `tsp-modal`。studio 自己驱动打开的 `/jobs`、context 报告、Agent Hub、旁路提问、会话树不在名单里(单测用对应录制保证)。输入框的提问 / 审批判断(`gate.ts`)和合成的 `tsp-ask` / `tsp-approval` 门只看节点。
  - 回收判据另外要求没有 `pending`/`running` 的 `tool`/`agent` 卡片(转到后台的任务)。
- **整篇扫描的缓存**(`main/tasks/tsp-doc-scans.ts`,`test/tsp-doc-scans.test.ts` 用全部录制对照整篇重扫):待办 HUD、状态 toast、旁路提问弹窗、还在跑的 `tool`/`agent` 卡片要扫全部活节点,只在相关 kind 的节点出现在 `changed` 里时重扫(o / x / move 整份重扫),流式正文不触发。回收判据和回溯 / 分叉的"这一轮已结束"读同一份缓存。
- **待办**(`shared/tsp/todos.ts`,`fixtures/tsp/task.jsonl`,`test/tsp-todos.test.ts`,omp 18.12.3):dock 里 role `omp.hud.todo` 的 `checklist`(`mode:"hud"`)就是当前待办:todo 工具第一次写入时出现,之后整体更新 `p.phases`,回合结束随 omp 的清理消失。阶段标题带罗马数字前缀(`I. Inspect`)。`TspComposerObserver`(`main/tasks/tsp-composer-observer.ts`)换算成 `TaskState.todoPhases`,`ComposerTop` 画待办板。**只认 HUD、不回退到工具卡片**:否则 omp 清理之后会把旧待办复活。
- **输入框上方的 HUD 由 studio 自己画**(omp 18.12.5 实测,`test/tsp-working.test.ts`):dock 里 `omp.hud`(作业 / 子代理胶囊)和 `omp.hud.activity`(运行状态行 `omp.working`、`omp.loader`、待办药丸)不渲染(`HIDDEN_HUD_ROLES`),由 `ComposerTop` 取代:药丸(子代理数 `countActiveAgents`、运行中的 bash 作业数)、状态行(用时 `TaskState.runStartedAt`,活动文字 `deriveWorkingLabel` = `omp.working.label`,没有时取 `omp.loader`)、待办板。运行状态仍由文档里的 `omp.working` 判断,与是否渲染无关。
- **会话文件**:`SetUserVar=omp_session_file` 启动时就发了,这时文件还没落盘(第一条回复之后才写),所以只在文件存在时才记进任务,在回合结束、进程退出、关闭时重试。不带 `=` 的(omp 没有会话文件时发)当作清空,不退回记录里的旧文件。`/move` 之后 omp 搬会话文件并重发这个变量(实测),记录自动跟着换。
- **当前目录(OSC 7,实测 omp 18.12.6)**:`ESC ] 7 ; file://<主机名><pathToFileURL(cwd).pathname> BEL`,启动时和 `/move` 之后发(Windows 盘符前有一个 `/`,路径百分号编码)。`shared/tsp/osc7.ts` 换成本机路径,`TspRunner.#onCwd` 写进 `TaskRecord.cwd`(和默认目录相同时记 null)和 `TaskState.cwd`。`TspRunner.cwd` = `record.cwd ?? worktreePath ?? 项目目录`,文件面板 / 评审 / git / 新开终端 / 主进程允许访问的根都读它,下次 `--resume` 从这里启动(分叉也带)。记着的目录已被删就退回默认目录并清掉记录。worktree 任务的 `worktreePath` / 分支 / 基分支不动,合并、丢弃仍按它们(丢弃时同时清 `cwd`)。已知局限:`/wt` 让 omp 搬进它自己建的 worktree 后,studio 的 worktree 记录仍是原来的;启动时的 OSC 7 若是符号链接解析后的写法会被当成换了目录(没碰到过)。
- **标题**:OSC 0/2 是 `<Nerd Font 图标> <标题>`,去掉私有区字符;`omp` 是没有标题时的占位。分支有 PR 时 omp 追加 ` · #12`:`cleanOmpTitle` 去掉后缀,`ompTitlePullRequest` 取号放 `TaskState.prNumber`,顶栏显示徽标,点击 `openTaskPullRequest` 由主进程按分支的 remote 推出 PR 地址(`git/pull-request-url.ts`,不依赖 gh),经 `parseExternalUrl` 白名单打开。omp 的标题只在记录里的标题为空、是草稿第一句话临时取的、或是上一次采用的 omp 标题时才覆盖——用户改过名就不再动。**改名只改本地记录**:交互模式没有从外部改会话名的入口,往输入框塞 `/rename` 会混进用户的草稿。
- **通知**:不解析 OSC 9/99(omp 回合结束就发 `omp: Complete`,窗口可见时不该通知);`needs_you` 和结束通知走 `GateNotifier` 的 TaskState 路径,等待中的任务有一个合成的 `dialogs[0]`(`kind: "confirm"`)只为让通知有内容可写。
- **任务栏进度**:不读 OSC 9;4(每个 omp 进程各发各的),任一任务 `running` → 不定进度,否则清除(`window/taskbar-progress.ts`)。
- **外观事件**:深浅主题和减少动效变化时 `TaskPool.setAppearance` → 每个会话只发有变化的 `{ev:"theme",dark}` / `{ev:"motion",reduce}`;新进程的 hello 读最新值。
- **进程**:Job Object 用 `assignToOwnJob`(和内置终端一样),关闭先 `taskkill /T /F` 再 `pty.kill()`。
- **终端 → 程序的帧**:用 APC(`ESC _ tsp;e;… ESC \`),实测 node-pty 自带的 ConPTY 下 omp 能收到。规范 transport 一节说 ConPTY 输入端会丢 APC、Windows 上应该用 `ESC ] 877 ; tsp ; … ESC \`(程序两种都收);以后 omp 或 conpty 升级后事件不再生效,改 `encodeTspEvent`。U+0080–U+009F 在 JSON 里转义。

## 8. 渲染进程实现

代码在 `src/renderer/src/features/tsp/`(节点渲染)、`features/tsp/interactive/`(输入和弹层)。任务挂 `TspView`(过程区)加 studio 的 `Composer`;omp 自己的输入框卡片(`omp.editor`)和欢迎块(`omp.welcome`)不画,inline surface 顶部是 studio 的 `StudioHeader`(不写任务 cwd,工具行的文件夹标签已经写着;所有者定,2026-10-29);提问/审批(`omp.editor.ask*`)照常画在 dock 里。

- **文档同步**:`tsp-store.ts` / `tsp-sync.ts` 按任务保存一份 `TspDocument`(和主进程同一份 `shared/tsp/document.ts` 归约),`tspBatch` 序号连续就增量应用,不连续就 `getTspSnapshot` 重取,重取期间的批次攒着再回放。组件按节点 id 订阅(`useTspNode`),节点记录不可变,没变的节点不重画。
- **按序号等镜像**:渲染进程根据 IPC 回复做的事要依赖之前 `tspBatch` 推来的批次时,按序号等镜像追上(`getTspSeq` + `tsp-store.ts` 的 `endTspDrive`),不要假设回复晚于事件到达;主进程回复前先推批次也不够(负载高时回复仍早到 30–50ms)。例:聚焦子代理后放开遮挡,omp 已关掉的 Hub 被画出一帧(`tsp.e2e.ts`"点行进入子代理")。
- **只给留着的对话区建镜像、只推有镜像的任务**:镜像只在对话区挂着时存在(`App.tsx` 的 `KEPT_VIEWS`,见 spec §5.4 第 6 条);卸载时 `releaseTspDocument` 放掉文档、推导缓存和图片 URL,界面状态留着(`dropTspDocument` 只在任务被移除、登录窗重开时用,连界面状态一起清),切回来 `ensureTspDocument` 重拉快照。主进程 `TspFeed`(`main/tasks/tsp-feed.ts`)在 `getTspSnapshot` 时登记、`releaseTspDocument` 时注销,只推登记了的任务;被移除的任务由 `runtime.ts` 的 `taskRemoved` 注销。主窗口重建、主框架 `did-navigate` 时清空登记——**不用 `did-start-navigation`**:它在 `will-navigate` 拦截之前就发,被拦下的导航(往非拖放区拖文件)会把登记清掉、对话停住。快照回来之前镜像被释放的,那份快照丢掉。
- **窗口藏着时不推批次**:主窗口隐藏或最小化时 `TspFeed` 一条也不发,只记压下的序号;窗口 `show` / `restore`(有的窗口管理器不发 `restore`,`focus` / `maximize` / `unmaximize` 时也判断)时给每个压下过的任务发一个空批次,渲染进程看到空档(`planTspBatch` 的 `resync`)重拉快照,不回放中间的帧。新快照里没变的节点沿用旧记录(`reuseUnchangedNodes`),组件不重画;所有丢帧重拉都走这里。`getTspSeq` 在压着时返回已推出去的最后一条(`TspFeed.delivered`),`endTspDrive` 不会一直等到窗口出来。渲染进程不看 `visibilityState`。测试:`test/tsp-feed.test.ts`;镜像那一侧靠 e2e(`tsp.e2e.ts` 图片用例、隐藏再还原窗口),单测不 import 带 DOM 的 `tsp-store.ts`。
- **图片字节不走快照也不走批次**:快照只列 blob 的 id,推给渲染进程的 `b` 消息也只剩 id(`TspFeed.push` 去掉 `data`;主进程自己的文档仍带 base64,任务池、`editorDraft` 照旧读)。渲染进程订阅时才用 `getTspBlob(taskId, blobId)` 取原始字节(主进程校验 id 和任务;登录会话按 `TERMINAL_LOGIN_ID` 路由),每个 blob id 一个 object URL,镜像释放、重拉的快照里没有这个 id 时 revoke;重拉时已有的按 id 沿用(内容寻址)。**SVG 例外**:不建 URL,只存源码,图片节点按当前主题过 `prepareSvg` 再给 `<img>`(`markdown/figure-palette.ts` 的 `themedSvgUrl`)——omp 让模型画的 SVG 颜色写的是 `var(--surface)` 这类主题变量,`<img>` 里读不到,直接用 blob URL 整块变黑;`npm run check` 的 `unthemed-svg` 扫描拦这种写法。进程退出后最后一份快照旁留着那个进程的 blob 表,停止的任务照样能取到图,所以它不能去掉。测试:`tsp.e2e.ts`「omp 发来的 SVG 图片按当前主题换好颜色再显示」、`test/task-tsp.test.ts`「排队的带图片插话点 Edit」、`test/tsp-feed.test.ts`。
- **画面**:inline surface(`omp.session`)= 可滚动的 `main` + 紧跟在对话后面的 `dock`(输入框区域;对话短时在最后一项下面,长过视口时停在底部)+ 铺满的 `layer`(picker / overlay / toast);screen surface(如 `/settings`)盖住整个对话区。对话列宽折成列数,变化时 `resizeTsp`。**hello 回复之前的列宽、主题、动效变化只记下、由 hello 回复带过去,不发事件**(`TspSession.resize` / `setAppearance`):进程刚起时写进 pty 的 APC 会被拆掉,假 omp 实测只收到末尾的 `ESC \`、记成一次按键(真实 omp 会当成输入框里的按键,推测)。测试 `test/tsp-session.test.ts`「hello 回复之前」。
- **节点**:声明出去的每种节点各有一个组件,未知种类按纯文本兜底并 `console.warn` 一次。不用 omp 的程序调色板:tone、样式名、omp 主题 token 按规范映射表落到 `tokens.css` 的语义变量。Nerd Font 私有区图标不画(没有那套字体),键帽换成 ⇪⌘⌃⌥⇧⏎⇥。工具"完成"用中性色(spec §2)。
- **过程区文字不汉化**(所有者 2026-10-21):节点组件里 studio 自己加的文字照 omp 用英文,集中在 `features/tsp/labels.ts`,不走 i18n;`i18n/*/tsp.ts` 只有对话区的无障碍名称和载入提示。**main 的渲染**由 `MainFlow.tsx` 负责:omp 的子节点 + 留存的状态行(§10.1)。
- **输入**:omp 的 `editor` 节点(picker / prefs 的 `TerminalInput` 同理)。打字的文字(`keys.ts` 的 `isTextKey`)keydown 不发,只由 `beforeinput` 写进伪终端(有选区时发 `edit`):Windows 输入法英文模式下 keydown 是真实字母(不是 229)、文字又由输入法提交一遍,两边都发会每个字母重复(issue #10);只读的编辑器没有 `beforeinput`,仍在 keydown 发。其余按键按 xterm 序列写进伪终端(Shift/Ctrl+Enter 等用 CSI u),omp 回 `set` 更新文字;选区上的删除、粘贴、剪切、输入法提交发 `edit`,Ctrl+Z 发 `undo`。草稿的第一句话由主进程等输入框 `sendable` 后用 `send` 提交(`TspRunner.sendPrompt`)。
- **操作**:`list` 单击 `select`、双击或再点已选中项 `activate`(审批门第一项默认已选中,不这样就得双击);节点自带 `actions` 的按 `actions.ts` 发,`toggle` / `copy` / `open` / `zoom` 由我们自己做;picker、prefs 见 `interactive/` 各组件。
- **滚动**:复用 `useStickToBottom`,对话区关掉浏览器的滚动锚定(`overflow-anchor: none`):omp 一直在改写视口上方的节点,锚定会把 `scrollTop` 往上推,被误认成用户上滚,一轮跑完停在半截。
- **测试**:单元 `test/tsp-render.test.ts`、`tsp-keys.test.ts`、`tsp-interactive.test.ts`;e2e `test/e2e/tsp.e2e.ts` 用 `fake-tsp-omp` 回放录制,假 omp 只在收到和录制完全一致的事件后才继续,所以界面能走到下一步本身就证明事件发对了。

## 9. 不支持 / 不做

- hello 不声明 `aside`、`styles`、`flow`:prefs 贴在面板旁、程序自带样式表、`flow` 模式的 surface 都不支持,omp 退回不依赖它们的画法。
- 停止 = 发 Esc;这一轮是否 `aborted` 以 OSC 7501 为准(§7 状态推导)。
- `editor` 的 `decor` / `ghost` / `lang` / `placeholder` 不做(studio 的输入框是自己的 textarea,文字不回灌 omp);vim 只画 `mode` 标签。
- token 分项和请求数 omp 不给,从会话文件补(§10.2)。旁路提问见 `docs/architecture/tsp-btw.md`。
- 规范细节(`md.marks`、diff 语法高亮、`list.virtual`、`tool.lang`、`tone`、`nodeDomProps` 等)按规范实现,bash 或没给 lang 的 `tool` 走 `shell-tokens.ts`(Shiki 的 bash 语法把选项和参数都标成 string,比手写分词差)。

## 10. 混合形态:TSP 过程区 + studio 输入框

仓库所有者要求(2026-10-20):输入框上方的对话过程用 TSP 渲染,输入框(模型、思考强度、上下文/用量、费用、发送/停止)、侧栏、顶栏是 studio 自己的;新老任务显示必须一致。渲染进程的分工见 `docs/design/spec.md`。

### 10.1 实测的 omp 行为

- `--resume=<会话文件>` 启动后,omp 把整段旧对话重新用节点发出来,和 Tern 一致;但**不带每轮末尾的 `omp.turn.usage` 用量行**(18.12.4 实测,`fixtures/tsp/resume.jsonl`,`test/tsp-session-extras.test.ts` 钉住),也不重放空闲回顾 `omp.recap`:
  - 用量行:实时的轮 omp 自己发(助手 `col` 最后一个子节点 `row role=omp.turn.usage`);恢复出来的轮 studio 从会话文件补(`main/tsp/session-extras.ts` 的 `parseSession` 是唯一一份每轮用量,口径照 omp 的 `TurnUsageAggregator`,合成 developer 消息清零;费用写法照 omp:不到 0.005 写 `<$0.01`,否则两位小数,恢复的行和实时的行一致)。渲染在 `nodes/layout.tsx` 的 `AssistantCol`,只补"没有用量行的轮的最后一个 `omp.assistant`",文档轮数和文件轮数对不上时不补。
  - 空闲回顾:omp 在一轮结束后空闲 `recap.idleSeconds` 秒、有模型、输入框为空时生成回顾,用 `omp.recap` 节点显示,原文写进 agent 目录 `history.db` 的 `session_recaps` 表(不写会话文件)。omp 18.12.6 实测:每轮结束后各来一条、在 main 里累积,打字和新一轮不删;成功的 `/compact` 同帧删掉它;`--resume` 不重放;新一轮开始时还没出现的被取消。**studio 只画最新的一条**(`useIsLatestRecap`;所有者 2026-10-21 定),**恢复会话不从 `history.db` 补**(所有者 2026-10-25 定:补回会在每次打开老任务、压缩删掉后又冒出来,与 omp 不一致)。
- **上下文压缩的分隔(`omp.compaction`)**(18.12.5 实测,`fixtures/tsp/compact.jsonl`):终端里是整行分隔,TSP 里是折叠的 `section`(`p.role = "omp.compaction"`,`head` 是方法名 + 压缩前后 token 的 span 数组,body 是 `omp.compaction.caption` + 摘要 `md`)。`omp.handoff`、`omp.branch` 同款。恢复压缩过的会话时它在保留的最后一轮和压缩后第一条用户消息之间。studio 把头画成整行分隔(spec §4.14)。
- **状态行(`omp.toast.status`)**(18.12.5 实测;源码 `chrome/status-notice.ts`):终端里 `showStatus` 是对话末尾一行暗色文字、留在对话里;TSP 里是 `main` 末尾的 `toast`(ttl 2400),下一帧就 `del` 成隐藏占位——**文档里留不住**。例:切模型的 `Session-only model: … Use Alt+M or /model for roles.`、`--resume` 压缩过的会话时 `Session compacted 1 time`。studio 在节点出现的那一帧记下文字和前一个兄弟节点的 id(`shared/tsp/status-notes.ts` → `DocSurface.statusNotes`,主进程和渲染进程各应用同一批消息、跟着快照走),画成对话里的一行暗字。
  - 锚点没了就不画:omp 重画整段对话(压缩、`/tree` 回溯、恢复会话)时删掉全部旧节点、换新 id,旧状态行没有位置,和终端一致(`fixtures/tsp/session-tree-compacted.jsonl`)。
  - 连着出的只留最后一条:终端里连续的状态行原地替换,TSP 里是同一个 toast 节点 id 换文字,所以同 id 的新状态行替换旧的(`mergeStatusNotes`)。`TspRunner.#syncToggles` 按对象认新状态行。
- 运行中再 `send`:omp 自己排队(dock 里的 `omp.queue`)再作为 steer 交给模型,不需要 studio 自己的队列。
- `send` 一条 `/model <id>`、`/thinking low` 是普通消息(发给模型);单独的 `/model` 才打开模型选择器。
- **编辑器节点和选择器节点的 id 每次不同**(`j.line/input`、`3.line/input`…):编辑器按 `k === "editor" && p.sendable === true` 找,选择器从文档里读,不能写死。
- 提问时 dock 里的 composer(`omp.editor`)被 `omp.editor.ask` 换掉(`ask.jsonl` 第 37 帧 `del j`);**审批时不换**:`omp.editor.ask.approval` 插在 composer 前面(`approval.jsonl` 第 33 帧),composer 的编辑器一直 `sendable`。

### 10.2 TaskState 的字段从哪来

`src/shared/tsp/composer-state.ts`(纯函数,`test/tsp-composer-state.test.ts` 逐帧验证),`TspRunner` 每次文档变化调用,变了才 `publish`:

| TaskState | 来源 |
|---|---|
| `model` | dock 里 `omp.composer.model` 下的显示名 → 在模型目录(`PoolDeps.listModels` = 服务进程的 `get_available_models`,和草稿同一份)里按 `name` 找;**omp 显示时去掉名字开头的 `Claude `**(omp 18.12.6 `status-line/segments.ts` 的 `modelDisplayName`,`isShownModelName`)。重名时依次取刚选的、会话文件里 omp 会选的(`SessionUsageAccumulator.currentModel`,规则照 omp 18.13.1 恢复会话:`temporary` 算数、`fallback` 不算)、任务记录里的、第一个;会话文件佐证的也记进任务记录。目录里没有时造一个只显示的占位(`provider: ""`);输入框还没出现时用任务记录里的。服务进程的目录还没读到时先按启动缓存(`PoolDeps.knownModels`)认,读到后重认(`#refreshCatalog`) |
| `thinkingLevel` | `omp.composer.model.effort` 的 `p.level`(含 `auto`) |
| `thinkingLevels` | 模型目录里的 `thinkingEfforts` 加 `off`;目录里没有时为空 |
| `contextUsage` | `omp.composer.context`(meter):`p.value` × 100 = `percent`;`p.title` 的 "8.7K of 1M tokens" 给 `tokens` / `contextWindow`(K = 10³),没有时取 `p.total`、再取目录 |
| `sessionUsage` | `omp.composer.usage` 的文字(`parseCost`):按量计费 "$0.00 (+0.02) ↓" 取第一个美元数;订阅模型没有 `$`,是订阅记号加数字,没花费时只有 "(sub)"(算 0)——读的是 omp 18.12.6 源码 `formatBillingSummary`,订阅账号的真实帧没录;★ 高级请求数不取。括号里是整棵子代理树的花费,第一个数不含它,取进 `subagentCost`(`parseSubagentCost`)。token 分项和请求数从会话文件增量读(`tsp-composer-observer.ts` 的 `#refreshTotals`,见 [session-history.md](session-history.md)「TSP 任务的 `sessionUsage`」) |

输入框被提问/审批替换的那几帧读不到,沿用上一次的值。`model` / `thinkingLevel`(目录里唯一匹配或明确选过的)记进 `TaskRecord`,下次 `--resume` 带 `--model` / `--thinking`。

### 10.3 切模型和思考强度

都不往输入框塞文字,直接给 omp 的节点发事件(实测过,包括 agent 正在跑工具时):

- `setTaskModel(key)`:对 `omp.composer.model` 发 `{"ev":"action","act":"status.model"}`(= Alt+P)→ 等 layer 里的 `picker`(`p.items[].id` 是 `provider/model`)→ 没有该项就发 Esc 并报错 → 否则 `activate` → picker 被删并出现 toast "Session-only model: <id>. …"(或输入框模型名变了)才算完成,超时 reject。这是会话内切换,不改 omp 的角色模型配置。
  - **会话比目标模型的窗口大**(omp 18.14.0 实测):omp 先用当前模型压缩再切。`activate` 后选择器**当场关掉**、dock 的 `omp.working` 变成 "Compacting context…",压缩结束的同一帧换模型名,再出 toast;失败时模型不换,main 里新增 `row role=omp.notice.error`(文字不带 "Error: ")。所以 `setModel` 看到选择器关了、压缩行出现就改按压缩的上限等,新增的错误行(`error-lines.ts` 认两种写法)以原文 reject——只按普通确认时限等,压缩慢一点就误报 "omp did not confirm switching",而 omp 稍后照样切了。录制 `fixtures/tsp/switch-compact.jsonl`、`switch-compact-error.jsonl`(真实 omp + 本地假 OpenAI 服务),测试 `task-tsp.test.ts` 半速回放。
- `setTaskThinkingLevel(level)`:反复对 `omp.composer.model.effort` 发 `{"ev":"action","act":"thinking.cycle"}`(= ⇧⇥),每次等 `p.level` 变化,直到目标级别(含 `auto`);转一圈还没有就报错,并把这一圈看到的档位交给宿主(`setObservedThinkingLevels`)记成这个模型的 `thinkingLevels`,错误里列出 omp 给的档位。实测 deepseek-v4-pro 循环 `high → max → off → auto → low → high`,每步 <10ms;omp 18.18.1 实测 `--thinking auto` 起进程、切到 `high` 再切回 `auto`、切不存在的 `xhigh` 报错后档位列表更正,之后一轮照常完成。
- 两者串行执行(共用一个选择器/一个循环键),没有进程时先启动并等输入框。

### 10.4 发送

运行中 `sendPrompt` 也直接 `send`,omp 自己排队/steer,`whenBusy` 忽略。**发送目标由 `shared/tsp/gate.ts` 的 `findMessageTarget` 定**(`#awaitComposer`):提问把输入框换掉(没有 `sendable` 的编辑器)、或有全屏面板开着(§10.7),`sendPrompt` 立刻 reject;切模型、切思考强度、斜杠命令在**审批在等**时也立刻 reject(它们的 `send` 会顺手拒掉审批)。reject 的消息以 `composer_unavailable:`(`TSP_COMPOSER_UNAVAILABLE`)或 `screen_open:`(`TSP_SCREEN_OPEN`)开头(IPC 只带得过 message,渲染进程按前缀显示提示),不等超时。**审批在等时 `sendPrompt` 照发**,见 §10.7。

### 10.5 老任务的打开方式

所有任务打开都是 `omp --resume=<会话文件>`(没有会话文件就是新会话),记录里不再有引擎字段,见 §11。

### 10.6 斜杠命令、快速/慢速、图片

- **命令列表**:`listSlashCommands` = 任务目录(`TspRunner.cwd`,含 `/move`、worktree)的项目 rpc-ui 的 `get_available_commands`(含项目 skill、自定义命令、扩展命令);任务还没起进程时照给。草稿页用 `listSlashCommands(null)`(服务进程)。单独的 `/cmd` 经 `send` 在空闲和运行中都当命令执行,带参数的(`/fast on`)也行;但 `/model <id>`、`/thinking low` 是普通消息。**单独的 `/model` 打开的是角色选择器**(会改角色模型),不是会话内切换器,所以 studio 里 `/model`、`/effort` 开 studio 自己的模型选择器。studio 接管哪些 `/命令` 见 `docs/architecture/conversation.md`"studio 接管的斜杠命令";`/btw` 见 `docs/architecture/tsp-btw.md`;HTML 导出用 `omp --export`(conversation.md"TSP 任务的导出")。
- **`/fast`**:`setTaskFastMode` 发 `/fast on|off`,等 toast "Fast mode enabled." / "Fast mode disabled.",出现别的新 toast 就以原文 reject。真实状态在模型名后面的闪电图标 span(`composer-state.ts` 读成 `TspComposerInfo.fast` → `TaskState.fastMode`)。
- **`/slow`**:发 `/slow on|off`,等 toast "Slow mode on: …" / "Slow mode off: …";omp 界面上没有慢速状态节点,`TaskState.slowMode.enabled` 按最后一次 toast 记(起始为关);不支持的模型 omp 的 toast 作为错误抛出。
- **图片**:TSP 没有传图片的事件。走 omp 自己的图片附件:图片写成临时文件,文字用 `edit` 填进输入框,往 pty 括号粘贴路径,omp 挂上图片后 `action submit`(`send` 会丢图)。见 composer-attachments.md「发图片」。
- **提问对话框(omp.editor.ask)的实测、键盘和鼠标**(omp 18.12.5 真实录制 `fixtures/tsp/ask-multi.jsonl`,三题单选 / 多选 / 单选走到 Review 提交;代码 `interactive/AskGate.tsx`、`src/shared/tsp/ask-gate.ts`,单测 `test/tsp-ask-gate.test.ts`,e2e `tsp.e2e.ts`"多题提问"):
  - **节点**:根 `col role=omp.editor.ask` = 头部 `tabs role=omp.ask.questions`(每题一项 + `submit` 即 Review;点标签发 `select` 能切页,答过的加 `✓ `)+ `md omp.ask.question` + 当前题的 `list omp.ask.options`(翻页时 omp `del` 旧 list、`add` 新 list)+ 底栏 Hide / Note / Skip / Next|Submit 按钮(`actions.click` = `hide` / `note` / `cancel` / `submit`)。**单选题选项 role `omp.ask.option`,多选题 `omp.ask.check`**(区分单选 / 多选的唯一标记)。
  - **单选**:`select`(包括已高亮项)或 `activate` = 回答并跳下一页;Space 无效。最后一题答完进 Review 页。
  - **多选**:`select` = 切换勾选并移高亮(已高亮的也切换),选中是 item 的 `icon:"check"` + `tone:"accent"`;Space 切换当前项;`activate` / Enter = 下一页(不勾选)。所以点已高亮项不能发 `activate`,否则这题在 Review 页显示 `Unanswered`。
  - **Review 页**:题目、list、Note 按钮被 `del`,新增 `text omp.ask.notice` 和 `kv omp.ask.answers`。**页里没有任何可聚焦节点**,键盘要由对话框根接。Enter 和点 Submit 都提交(实测)。
  - **Esc**:任意页 Esc = 取消整个提问(`ask` 工具卡 `status:error`),omp 不再继续这一轮——omp 自己的行为。`Note` 打开 `omp.overlay.hook-editor`(ask 根被 `del`),Esc 返回;`Hide`(Alt+H)把根 role 改成 `omp.editor.ask.hidden`,`Show` 还原。
  - **studio 的做法**:① 对话框根(`AskGateCol`,`data-tspi-keys`)自己接键盘,按键 `encodeKey` 写进伪终端(list / editor 已处理的不重复发),Esc `stopPropagation`,不冒到 Composer 当停止;换页拆掉焦点后由 MutationObserver 拿回根。② 按钮见 §7「button 和 shell 节点」,点按钮不抢焦点。③ 点选项(`askItemClick`):`omp.ask.check` 永远发 `select`,双击也不 `activate`;单选和其它列表"点非高亮 = `select`,再点已高亮 = `activate`"。**未实测**:Ctrl+Enter 在提问里的作用;Other 输入页和 Note 编辑器在 studio 里的渲染没有逐帧测;`cancel` 按钮的 `action` 事件没发过。
  - **omp 18.18.3 实测**(2026-11-09,`fixtures/tsp/ask-other.jsonl`):题目包在 `omp.ask.form` / `section` / `field` 里,"Other…" 也是 `omp.ask.option`(id 以 `/other` 结尾)。① omp 不认数字键,所以 studio 把无修饰的 `1–9` 换成对第 N 项的点击(`askDigitPick`,规则同 ③;焦点在 list 上由 `List` 处理,在对话框根上且正好一组选项时由 `AskGateCol` 处理,`askDigitInGate`),选项前画序号。② Other:`select` 后 omp 同一帧加一个 `input` 并 `focus`,studio 的 Editor 跟着拿键盘,打字作为按键写给 omp;Enter 后删掉 input,对话框还在(单题也要再点 Submit)。e2e `tsp.e2e.ts`"提问(omp 18.18.3 录制)"。
  - **提问卡头上不重复题目**(仓库所有者 2026-10-29):`omp.tool.ask` 卡片头的 `target` 是第一道题,对话框开着时不写它(`nodes/work.tsx` 的 `AskTarget`;哪张卡片由 `ask-gate.ts` 的 `openAskTool` 判断),隐藏或答完后照常写。
- **omp 弹窗(`overlay`:`/jobs` `/session` `/usage` `/changelog`…)的 Esc、高度、列宽**(`interactive/Overlay.tsx`、`src/shared/tsp/overlay-esc.ts`、`table-layout.ts`,`test/tsp-overlay-esc.test.ts`,e2e `tsp.e2e.ts`"后台作业弹窗"):
  - **Esc**:overlay 没有关闭动作,关它就是把 Esc 写给 omp(底栏 Close 按钮是同一件事)。焦点通常在 studio 输入框,不在 tsp-view 里,所以每个可关闭的 overlay(不含锚在光标 / 节点上的补全菜单)在 window **捕获阶段**监听 Esc:没人处理过、无修饰键和输入法组合、没有选择器、且自己是最上面一个可关闭 overlay 时写 Esc 并 `preventDefault` + `stopPropagation`(Composer 的 Esc 看 `defaultPrevented`,不会停止任务)。tsp-view 里自己发 Esc 的控件(`textarea` / `input` / `[data-tspi-keys]`)不重复发。
  - **叠层不是 studio 文档的 bug**:`fixtures/tsp/jobs-chart.jsonl` 里 omp 自己先 `del` 旧层再 `add` 新层;叠几层是因为 Esc 到不了 omp、用户又发了下一条斜杠命令(按录制和截图推断,未对真实 omp 复现)。
  - **高度**:卡片最高到 overlay 根的高度,内容多时在卡片里滚动,头和底部 Close 行留在视口内。
  - **`/tools` 第一列被挤成一个字宽**(omp 18.12.5):body 是 markdown 管道表(`md`,role `omp.report.body`),不是 `table` 节点;`.md` 的 `overflow-wrap: anywhere` 让自动表格布局的最小内容宽度变成 1 个字,所以 `markdown.css` 的表格单元格用 `break-word`。`table` 节点的列轨道也有字数下限(`columnTrack`),是同类问题的预防。
  - **`table` 节点**(omp 18.15.0 实测):eval 打印 pandas 表时工具卡里是 `table`(role `omp.tool.eval.table`)。`nodes/data.tsx` 的 `Table` 里量列宽的 effect 依赖 `cols` / `rows`,**这两个数组必须按 `node.p.*` `useMemo`**,否则每次渲染新建、effect 重跑、无限渲染(React #185)把整个界面卸掉。e2e `tsp.e2e.ts`"eval 的表格节点"。渲染进程没有错误边界,也不把渲染错误写进日志。
  - **`/jobs` 布局**:`omp.jobs.split` 的 `row` 按 role 改成 `stretch`(默认 center 让列表漂到详情中间),见 `tsp.css`。
- **studio 自己发的会话级斜杠命令(`runTaskCommand`)**:渲染进程只传封闭联合 `TaskCommand`(`shared/omp-output/index.ts`),主进程 `taskCommandText` 拼成 `/命令`,`TspRunner.runSessionCommand(text, success?)`(`tsp-commands.ts`,串在任务的 `#exclusive` 里)`send` 之后等 `omp.toast.status`:没给 `success` 时第一条**新** toast 就是结果,给了而不满足就以原文抛出;和发送前文字完全相同的 toast 认不出是新的(omp 复用同一个节点只换文字)。成功时不出 toast 的命令(`/jobs kill`、`/retry`)走 `runQuietCommand`(观察一段时间,只认出错 toast)。弹窗/main 里加文字的命令(`/jobs` `/memory` `/tools`…)等不到 toast,走 `runBuiltin`(rpc-ui,见 `omp-rpc.md`「内置命令」)。单测 `test/task-tsp.test.ts` 用 `fixtures/tsp/slash-status.jsonl`(omp 18.12.5 真实录制,路径脱敏;裁掉了前面的命令,`/modelpreset list` 那帧的 `set u` 改成了 `add u`)。
- **`/compact` 的结局**(omp 18.12.5 实测,`compaction.keepRecentTokens: 100` 让短对话也能压缩):**没有 toast**。压缩期间 dock 的 `omp.working` 是 "Compacting context…";**成功** = main 里新增 `section role=omp.compaction`;**失败** = main 里新增 `text`(样式 `error`,"Error: Compaction failed: Nothing to compact (session too small)"),omp 18.14.0 起是 `row role=omp.notice.error`、不带 "Error: "(§10.3)。判断在 `shared/tsp/compaction.ts`(只认发命令之后**新增**的节点,两种失败写法都认),`TspRunner.compact()` 据此 resolve / 以原文 reject。录制 `fixtures/tsp/compact-ok.jsonl`、`compact-error.jsonl`;测试 `test/tsp-compaction.test.ts`、`task-tsp.test.ts`。
- **`/add-dir <路径>`**(omp 18.12.5 实测):整行剩余部分就是路径(空格、中文都行,**不要加引号**——引号会成为路径的一部分);`taskCommandText` 原样拼路径,只拒绝控制字符。

### 10.7 审批门与全屏面板(Agent Hub)时的输入框

纯函数在 `src/shared/tsp/gate.ts`(`test/tsp-gate.test.ts` 对 `approval` / `ask` / `slash` 录制逐帧验证),主进程 `TspRunner.#awaitComposer`、渲染进程 `Composer.tsx` 共用。

**审批:输入框里写的字 = 拒绝并说明理由,和 omp 的 TUI 一样。** omp 文档(`approval-mode.md`):审批停靠在输入框上方,发消息会拒绝所有待批的调用,再把这条消息作为插话交给模型。审批期间 composer 的编辑器一直 `sendable`(§10.1),所以 studio 把消息原样 `send` 给它(`findMessageTarget` 返回 `ready` 且 `approval: true`),不另发 `deny`。真实 omp 18.12.5 确认:工具卡变 `Tool call denied by user: bash`,模型照理由回复(`tsp-real-omp-probes.md` §14)。

- 按键:Enter(有草稿)= 拒绝并发送;Ctrl+Enter = 批准;Ctrl+O = Details。批准和 Details 是对审批卡上对应按钮(`actions.click` = `approve` / `expand`;`findGateButton`)发 `action`,和点按钮同一个事件。Esc = 拒绝(omp 自己的键)。
- 门:主进程合成的 `dialogs[0]` id 审批是 `tsp-approval`、提问是 `tsp-ask`(`TSP_APPROVAL_DIALOG_ID` / `TSP_ASK_DIALOG_ID`)。输入框按它区分:提问时不能发送,审批时能发(拒绝并说明)。
- 切模型、思考强度、斜杠命令(`#runSlash`)在审批期间 reject(`composer_unavailable`),不然它们的 `send` 会顺手把审批拒掉。

**面板开着时输入框不发。** 面板 = 全屏 surface(`mode: "screen"`,如 `/settings`)或 **Agent Hub**——实测(omp 18.12.5,`fixtures/tsp/hub-steer.jsonl`)Hub 是 inline surface `layer` 里的 `picker`(`hasAgentHub`),不是 screen surface。`findMessageTarget` 看到任一种就返回 `panel`,`sendPrompt` 立刻 reject(`screen_open:`),否则消息会写进主会话的 composer 成为对主代理的插话。输入框这时发送禁用、Enter 不发、placeholder 换成提示;Esc(以及停止按钮)只把 Esc 交给 omp 关面板,**不**当成停止主代理、也不记 `stopRequested`。**给子代理 steer 不用单独路由**:Hub 里 `activate` 一个子代理后 omp 进入聚焦模式(dock 里 `omp.composer.focus`),Hub 关掉,同一个编辑器的 `send` 就 steer 那个子代理(实测),`findMessageTarget` 是 `ready`。

### 10.8 后台作业(omp 18.12.5)

纯函数 `src/shared/tsp/jobs.ts`(`test/tsp-jobs.test.ts`,录制 `jobs-chart` / `hub-steer` / `jobs-kill`),渲染进程 `features/composer/{tsp-jobs-store,StatusPills,jobs-slash}`(药丸只数运行中的 bash 作业,点它打开 omp 的作业弹窗;子代理在子代理面板)。studio 没有自己的作业看板。

- **作业在文档里的两处**(role 是 omp 自己的命名):hud 作业胶囊 `omp.hud.seg`(`actions.click = "jobs.open"`),**只在有作业运行中时存在**,`title` 第一行之后每行一个作业 `<id>  <标题>`(bash 的 id 是 `bg_N`,子代理作业的 id 是子代理名);`/jobs` 弹窗 `omp.overlay.jobs` 里 `omp.jobs.master` 下的 `list`,每个 `item` 的 `title` **最后一行**是 `<Running|Done|Failed|Cancelled> · <bash|eval|task> · <id>`,倒数第二行是命令,`value` 是时长。**18.15 起**前面可能多出 intent 和 caption 各一行(18.18.5 `overlays/jobs-panel.ts` 的 `describeJobItem`),所以 `overlayItem` 从末尾数行。作业名取命令不取 intent(药丸悬停卡片有磁贴标题时用磁贴标题);多行命令只拿到最后一行。弹窗里状态最全,但只有它开着时在文档里;子代理起的 bash 作业也列在里面(`label` 带 `└─ ` 前缀),所以作业名从标题取。
- **合并**:`mergeTspJobs` 把每次的快照并进已知作业:开始时间沿用第一次看到的;已知运行中而快照里没了 → 子代理按 `agent` 节点,其余记为完成;弹窗里的状态覆盖推断。结束动作成功后 `markJobsCancelled`。`tsp-jobs-store` 只在 `JOBS_NODES` 那份 NodeWatch 的 version 变了时才推导、合并(item 是 master 的孙子,`children` 够不着,按 kind 记);单测比对"每条都合并"和"version 变了才合并"结果一样。
- **`/jobs kill <id>|all`**(真实 omp,`fixtures/tsp/jobs-kill.jsonl`):成功时**没有 toast**,只是对应的 bash 卡片变 `status: "cancelled"`;出错发 toast(未知 id、缺参数)。所以 `runQuietCommand` 发出后观察一段时间,有新 toast 就以原文 reject,没有就算成功。子代理作业的 kill 没实测,界面不提供。
- **打开 omp 的作业弹窗**:输出文本只在 `/jobs` 弹窗选中项的详情(`omp.jobs.output`)里,没有别的通道,所以药丸和 `/jobs` 都直接打开它:`openTspJobs(taskId, jobId)` 弹窗开着就只发 `select`;没开就点 hud 胶囊,没有胶囊就 `sendPrompt("/jobs")`,出现后再 `select`。**`select` 的 `id` 是作业列表、`item` 是列表项**(`findJobsOverlayItem`):omp 18.12.6 `native/backend.ts` 按 `id` 找组件,把以 `<id>/` 开头的 `item` 换回列表 key;`id = item = 列表项` 实测选中不变。
- **hud 作业胶囊的悬停卡片**(`fixtures/tsp/jobs-chart.jsonl`;omp 18.12.6 实测):胶囊的 `hovercard` 属性是一棵不带 id 的节点树,`omp.jobs.hovercard` > `omp.job.tiles` > 每个作业一个 `omp.job.tile`:头一行命令和 id;omp 的作业小部件(`widget` 角色模型,没配时用 `smol`)有进度后是 `.figure`、`meter`、`.stats`、`.stage`,之前是一行 `.lead`(最近的输出)。studio 不画 hud,药丸作业段的悬停卡片照它画(`deriveJobTiles`,进度条复用 `MeterView`)。
- **`/jobs`** 是 `tsp: "studio"` 命令:不带参数打开 omp 的作业弹窗并选中第一个运行中的 bash 作业(没有就选最近的),`kill` 由主进程拼命令(渲染进程不发自由文本)。

### 目标模式(TSP,omp 18.12.5)

`/goal` 是 studio 的命令(`tsp: "studio"`),目标条(`features/goal/GoalStrip`)挂在 `TspView` 顶部,数据是 `TaskState.goal`。录制(真实 omp + 临时 agent 目录):`fixtures/tsp/goal-{pause-resume,drop,budget,flow}.jsonl`。

- **状态在 omp 输入框卡片上**:role `omp.composer.fact` 的 `seg`,文字 `Goal <已用>[/<预算>]`(omp 缩写的 K/M/B),图标 `goal` = 进行中、`pause` = 已暂停、`warning` = 预算用尽;没有目标没有这个节点,完成和放弃都是节点消失。omp 的输入框卡片 studio 不画,所以不会重复。
- **选择器 / 弹窗开着时整个输入框卡片被 `del`**:卡片不在 = 不知道,沿用上一次;卡片在而没有事实行 = 没有目标(`deriveGoalFact` 的 `composer` 字段)。
- **目标文字不在文档里**:读会话文件。每次目标变化 omp 追加 `mode_change`(`mode` 为 `goal` / `goal_paused`,`data.goal` 带 objective、status、用量);完成时先一条 `status:"complete"` 再 `mode:"none"`;`/goal drop` 只有 `none`。`omp-output/goal.ts` 的 `parseGoalSession` 读尾部;读不到先用 studio 发出去的文字(`expectObjective`),之后用量变化再试。
- **命令**:无参数 `/goal` 打开选择器——studio 不发;`/goal <文字>` 创建,成功**没有 toast**(事实行出现就是成功),已有目标时 toast 报错;`/goal pause` / `resume` 各有 toast;`/goal drop` 弹 `Drop goal?` 选择器,`activate` Yes 后 toast `Goal dropped.`。轮次中途 `/goal pause` 也立即生效。
- **主进程**:`TspRunner.goal(op, objective?)` 在 `#exclusive` 里做;`TspGoalTracker`(`tasks/tsp-goal.ts`)每次文档变化读事实行(`shared/tsp/goal.ts`),变了才发布;事实行消失且会话文件最后一条是 `complete` 时发一次 `TaskNotice goal_complete`。
- **没做 / 局限**:预算(`token_budget` / "Adjust budget…")没有入口;`goal.enabled=false` 的行为没测。没有已暂停目标时 `/goal resume` 不出 toast 而是在 main 里加 Warning 文字——界面只在已暂停时给"继续",发出了也只会超时。`/guided-goal` 是给模型的提示模板,保持直通。
- 测试:`test/tsp-goal.test.ts`、`test/task-tsp.test.ts`"目标模式"(假 omp 严格匹配事件序列)、`test/e2e/tsp.e2e.ts`"目标条(TSP…)"。
- **"Goal complete complete" 是 omp 自己的**:goal 工具卡标题的 span 是 `Goal` + `complete`(op 参数)+ `complete`(结果状态),见 `fixtures/tsp/goal-budget.jsonl`。studio 原样画 span、不拼状态词,属于"过程区文字不汉化",不改。

## 11. rpc 任务引擎已删除(0.3.26,仓库所有者 2026-10-21 批准)

- **删掉的**:rpc 任务路径整体(`TaskRunner` 及其翻译、合批、门、子代理跟踪,`ConversationView` 及过程行 / 门 / 泳道 / 队列条 / 状态栏,设置里的"新任务的引擎",相关 IPC 和事件,评审的"改动说明"页签)。`TaskState` 没有 `engine` 字段,`DialogRequest` 只有 TSP 合成的 `confirm`,`TaskNotice` 只有 `goal_complete`。
- **保留的**:`serviceOmp`、`service/project-omp.ts`、`omp/omp-connection.ts`(rpc-ui 客户端)、`rpc-wire.generated.ts` 和 `npm run omp:update-wire`(也拷 TSP 类型)、`test/fake-omp/fake-omp.ts` 和 `fixtures/rpc/bash-tool.ndjson`(只给连接 / 服务进程的单测)。子代理面板(`features/agents`)的记录视图还用 `conversation/{ProcessDetails,ToolViews,model,tool-view}` 渲染子代理的会话记录。
- **老任务**:`TaskRegistry.load` 丢掉每条记录的 `engine` 字段,其余原样保留,下次保存时落盘;所有任务打开都是 `omp --resume=<sessionFile>`(没有会话文件就是新会话)。测试:`test/task-registry.test.ts`、`test/task-tsp.test.ts`"rpc 引擎时代的老任务"。设置文件里残留的 `taskEngine` 下次写设置时被丢掉(`sanitize` 只认已知字段)。
