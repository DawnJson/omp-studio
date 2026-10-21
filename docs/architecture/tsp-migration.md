# 从 rpc-ui 迁到 TSP

> 状态:**已确认**(2026-10-20)。仓库所有者定了方向"改成 TSP:伪终端里跑交互式 omp",第 6 节三项取舍按推荐答案确认。这份文档记实测结果、要改的范围和已定的取舍。

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
| omp 加了新界面 | 要等 omp-studio 跟进(例如 `setWidget`、`setStatus` 现在被丢掉) | 自动出现;新的节点种类要在渲染器里补一种 |
| 操作 | 37 个 RPC 命令 | 少数几种事件(`send`、`action`、`select`、`activate`、`toggle`、`change`、`edit`、`focus`)+ 按键字节 |
| 协议稳定性 | wire 类型从 omp tag 拷贝,omp 内部协议 | TSP v1 是公开、带版本的协议;但节点上的 `role`(比如 `omp.editor.ask.approval`)是 omp 自己的命名,不在规范里 |

## 4. 要改什么

### 4.1 主进程

- 新的 `TspSession`(替代 `OmpConnection` + `session-init` + `translate` + `event-batcher` + `dialogs`):node-pty(`useConptyDll: true`)启动 `omp --model … [--thinking …] [--resume <会话文件>]`,环境变量 `TERM_PROGRAM=tern`;解析 APC/OSC;回 `hello`(声明我们画得出的节点种类和支持的特性);按信用值回 `ack`;维护每个 surface 的节点树(`add`/`set`/`del`/`text`/`splice`/`settle`……),批量转发给渲染进程。
- 任务状态(侧栏的点、托盘、系统通知)改为从树上推:输入框区域有 `omp.editor.ask*` = 等你;有停止按钮 / 运行中的 spinner = 运行中;否则空闲。会话文件来自 `omp_session_file`,标题来自 OSC 0。
- 保留:任务池、进程上限和回收、Job Object、worktree 的 cwd、历史会话列表(读 `.jsonl`)、git、终端、文件预览、设置存储、托盘。

### 4.2 渲染进程

- 新的 TSP 渲染器:一个节点种类一个组件,外观照 Tern(我们已有 Tern 截图做参照),颜色仍用 `tokens.css`。规范列了 40 多种节点,omp 实际用到的(实测统计):`col`、`row`、`text`、`md`、`code`、`ansi`、`tool`、`agent`、`checklist`、`card`、`section`、`list`/`item`、`picker`、`prefs`、`overlay`、`toast`、`editor`、`meter`、`effort`、`seg`、`kbd`、`icon`、`spinner`、`elapsed`、`shimmer`、`badge`、`kv`、`image`、`spacer`、`status`。
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
| 3. 切换方式 | **并存**:设置里能切回 rpc-ui;TSP 路径的功能和测试对齐后,在同一个大版本里删掉 rpc-ui 任务路径(服务进程保留) |

## 7. 主进程实现(TSP 引擎)

代码:`src/main/tsp/{stream,tsp-session}.ts`、`src/shared/tsp/task-status.ts`、`src/main/tasks/tsp-runner.ts`,任务池按 `TaskRecord.engine` 建 `TaskRunner`(rpc)或 `TspRunner`(tsp)。测试:`test/tsp-*.test.ts`、`test/task-tsp.test.ts`,假 omp 是 `test/fake-omp/fake-tsp-omp.ts`(伪终端里回放 `fixtures/tsp/*.jsonl`)。

- **启动**:node-pty + `useConptyDll: true`,`encoding: null`(按字节解析:规范允许分块切在 UTF-8 字符中间)。环境 `TERM_PROGRAM=tern`、`TERM_PROGRAM_VERSION`、`TERM=xterm-256color`、`COLORTERM=truecolor`。参数:`--model`、`--thinking`、`--allow-home` 和 rpc 路径一致,恢复会话用 `--resume=<会话文件>`(`omp --help` 里 `-r, --resume=<value>`,按 ID 前缀或路径),去掉 `--mode rpc-ui`。`STUDIO_TEST_OMP` 同样替换整条命令。
- **hello 回复**:`kinds` = `TSP_KINDS` 全部,`apc` 65536,`credits` 2,`cols`、`dark`、`reduceMotion`、`hour12`。`features`(终端特性,不是 omp 在查询里声明的程序特性 `edit`/`undo`/`send`)只声明我们处理得了的:`blobs`、`settle`、`adopt`、`dock`、`program-palette`、`scroll`、`reduce-motion`;不声明 `aside`(prefs 贴在面板旁)、`styles`(`s` 样式表,程序自带 CSS)、`flow`。omp 的 `edit`/`undo`/`send` 由渲染进程的输入框决定是否发对应事件;`send` 主进程自己用于草稿的第一句话。DA1 每收到一次就回 `ESC [ ? 62 ; 22 c`(omp 启动时会连发好几个,各带一个 DA1 哨兵)。
- **ack / error**:每个数据块处理完,对块内每个 surface 回一次最高帧号的 `ack`(规范:ack 覆盖此前所有帧);被拒的 op 回 `{"ev":"error","sf","s","op","msg"}`,整帧被丢没有 `op`;JSON 坏了回 `malformed <verb> body`;分块被打断回 `chunked … dropped: interrupted`。
- **批次**:消息应用到主进程的 `TspDocument` 后按 16ms 合批,序号 = 已应用消息数;`snapshot()` 先把待发批次推出去再取文档。进程换了(回收后再打开)序号接在上一个进程之后并空一位,渲染进程发现不连续就重取快照,不会把新进程的消息接在旧文档上。
- **状态推导**(`task-status.ts`,依据是 `fixtures/tsp/{task,approval,ask}.jsonl` 逐帧,`test/tsp-task-status.test.ts`):`dock` 里有 role 以 `omp.editor.ask` 开头的节点 = `needs_you`(提问 `omp.editor.ask`、审批 `omp.editor.ask.approval`;提问时 composer 被换掉但运行状态行还在);`dock` 里有 `omp.working` / `omp.working.stop` / `omp.composer.stop` = `running`(发出消息那一帧出现,回合结束那一帧消失);否则 `idle`。主区里的 spinner 和 `omp.hud.activity`(待办面板,回合结束后还在)不可靠,不用。回收判据另外要求没有 `pending`/`running` 的 `tool`/`agent` 卡片(转到后台的任务)。
- **会话文件**:`OSC 1337 SetUserVar=omp_session_file=<base64>` 在启动时就发了,这时文件还没落盘(第一条回复之后才写);所以只在文件存在时才记进任务,在回合结束、进程退出、关闭时重试。
- **标题**:OSC 0/2 是 `<Nerd Font 图标> <标题>`,去掉私有区字符;`omp` 是没有标题时的占位。omp 的标题只在记录里的标题为空、是草稿第一句话临时取的、或是上一次采用的 omp 标题时才覆盖——用户改过名就不再动。**改名只改本地记录**:交互模式下没有从外部改会话名的入口(rpc 的 `set_session_name` 不存在),往输入框塞 `/rename` 会混进用户的草稿。
- **通知**:不在 OSC 9/99 上发系统通知(omp 回合结束就发一条 `omp: Complete`,而窗口可见时不该通知);`needs_you` 和结束通知走 `GateNotifier` 的 TaskState 路径,等待中的任务有一个合成的 `dialogs[0]`(`kind: "confirm"`,标题取问题/审批标题的第一行)只为让它有内容可写。
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
- **测试**:单元 `test/tsp-render.test.ts`、`tsp-keys.test.ts`、`tsp-interactive.test.ts`;e2e `test/e2e/tsp.e2e.ts` 用 `fake-tsp-omp` 回放 `task` / `approval` / `ask` 三份录制,假 omp 只在收到和录制完全一致的事件后才继续,所以界面能走到下一步本身就证明事件发对了;截图 `screenshots/tsp-{done,gate,ask}-*.png`。

## 9. 还没对齐的地方

取舍 3 定的是"功能和测试对齐后再删 rpc-ui 任务路径",下面这些对齐之前不删:

- ~~侧栏和标题栏用的上下文用量、费用、思考强度对 TSP 任务是空的~~ 已由 §10.2 解析(token 分项和请求数 omp 不给,仍是 0)。
- hello 没声明 `aside`、`styles`、`flow`:prefs 贴在面板旁、程序自带样式表、`flow` 模式的 surface 都不支持,omp 会退回不依赖它们的画法。
- 停止 = 发 Esc;用户按过停止的那一轮 `lastTurn` 记为 `aborted`,哪怕之后 omp 又继续跑完(例如审批后)。
- md 节点的 `marks`(用户消息里的芯片着色)、diff 的语法高亮、`editor` 的 `gutter` / `virt` / vim 样式、超过 200 项的 `list` 虚拟化没做;录制里只有 `marks` 出现过。
- 依赖 rpc-ui 的现有 e2e 都固定跑 `taskEngine: "rpc"`(`test/e2e/launch.ts`),对应的 TSP 版本只有 `tsp.e2e.ts` 这三条。

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
- 提问/审批出现时 dock 里的 composer(role `omp.editor`)被 `omp.editor.ask` / `omp.editor.ask.approval` 替换。

### 10.2 TaskState 的字段从哪来

`src/shared/tsp/composer-state.ts`(纯函数,`test/tsp-composer-state.test.ts` 逐帧验证 `fixtures/tsp/*.jsonl`),`TspRunner` 每次文档变化调用,变了才 `publish`:

| TaskState | 来源 |
|---|---|
| `model` | dock 里 `omp.composer.model` 下的 text(显示名,如 "DeepSeek V4 Flash")→ 在模型目录(`PoolDeps.listModels` = 服务进程的 `get_available_models`,和草稿输入框同一份)里按 `name` 找;重名时先取刚选的、再取任务记录里的、再取第一个;目录里没有时用名字造一个只显示的占位(`provider: ""`);输入框还没出现时用任务记录里的模型 |
| `thinkingLevel` | `omp.composer.model.effort` 的 `p.level`;`auto`(omp 自选,不是 `ThinkingLevel`)为 null,退回记录里的值 |
| `thinkingLevels` | 模型目录里的 `thinkingEfforts` 加 `off`;目录里没有时为空 |
| `contextUsage` | `omp.composer.context`(meter):`p.value` × 100 = `percent`;`p.title` 的 "8.7K of 1M tokens" 给 `tokens` / `contextWindow`(K = 10³),没有时窗口取 `p.total`、再取目录里的 `contextWindow` |
| `sessionUsage` | `omp.composer.usage` 的文字("$0.00 (+0.02) ↓")取第一个美元数 = `cost`;token 分项和请求数 omp 不给,置 0 |

输入框被提问/审批替换的那几帧读不到,沿用上一次的值。`model` / `thinkingLevel`(模型目录里唯一匹配或明确选过的)也和 rpc 一样记进 `TaskRecord`,下次 `--resume` 带 `--model` / `--thinking`。

### 10.3 切模型和思考强度

都不往输入框塞文字,直接给 omp 的节点发 TSP 事件(实测过,包括 agent 正在跑工具的时候):

- `setTaskModel(key)`:对 `omp.composer.model` 发 `{"ev":"action","act":"status.model"}`(= Alt+P)→ 等 layer 里出现 `picker`(`p.items[].id` 是 `provider/model`,`p.current` 是当前项)→ 目录里没有该项就发 Esc 关掉并报错 → 否则 `activate` 那一项 → picker 被删并出现 toast "Session-only model: <id>. …"(或输入框的模型名变了)才算完成,5 秒没有确认就 reject。这是会话内切换,不改 omp 的角色模型配置。
- `setTaskThinkingLevel(level)`:反复对 `omp.composer.model.effort` 发 `{"ev":"action","act":"thinking.cycle"}`(= ⇧⇥),每次等 `p.level` 变化,直到显示目标级别;回到起点还没有就是这个模型不支持,报错。实测 deepseek-v4-pro 的循环是 `high → max → off → auto → low → high`,每一步 <10ms。
- 两者串行执行(共用 omp 的一个选择器/一个循环键),没有进程时先启动并等输入框。

### 10.4 发送

运行中 `sendPrompt` 也直接 `send`,omp 自己排队/steer,`whenBusy` 忽略。提问/审批替换了输入框时没有 `sendable` 的编辑器:`sendPrompt`、切模型、切思考强度立刻 reject,消息以 `composer_unavailable:` 开头(`TSP_COMPOSER_UNAVAILABLE`;IPC 只带得过 message,渲染进程按它识别并显示"先回答 omp 的提问/审批"),不等 30 秒超时。

### 10.5 引擎统一

`TaskRecord.engine` 不再"创建后不变":设置 `taskEngine === "tsp"` 时,**没有进程**的 `rpc` 任务在下次启动之前被改记成 `tsp`(持久化)再建 runner,于是用 `omp --resume=<sessionFile>` 起(没有会话文件就是新会话)。入口:应用启动时 `TaskPool.init`、已归档任务的恢复和历史会话 `resume`、分叉出的新任务、以及设置在运行期间被改后的 `openTask` / `restartTask` / `sendPrompt`(`#runnerForStart` 把没进程的 rpc runner 换成 tsp runner,同 id)。正在运行的 rpc 任务不动,结束或回收后下次启动才换。设置是 `rpc` 时一切照旧。

测试:`test/task-tsp.test.ts` 的"引擎统一"三条、`TSP 任务:输入框状态、切模型、提问时的发送`。

### 10.6 斜杠命令、快速/慢速、图片(实测 omp 18.12.3)

- **命令列表**:`listSlashCommands` = 服务进程的 `get_available_commands`(内置命令一致,项目目录里自定义的命令/技能没有;没有进程时 `[]`)。单独的 `/cmd` 经 `send` 在空闲和运行中都当命令执行(`/fast`、`/slow`、`/model` 实测),`/fast on` 这类带参数的也行;但 `/model <id>`、`/thinking low` 是普通消息。注意单独的 `/model` 打开的是**角色**选择器("Models",会改角色模型),不是会话内切换器——切模型用 §10.3。
- **`/fast`**:`setTaskFastMode` 发 `/fast on|off`,等 toast "Fast mode enabled." / "Fast mode disabled." 才算完成,出现别的新 toast(如 "…has no service-tier control for /fast to toggle.")就以它的原文 reject。真实状态在模型名后面的闪电图标 span(U+F0E7,样式含 `icon`)——`composer-state.ts` 读成 `TspComposerInfo.fast`,模型名取非图标 span,所以不受影响;`TaskState.fastMode.enabled/active` 取它。
- **`/slow`**:同上发 `/slow on|off`,toast "Slow mode on: …" / "Slow mode off: …";omp 界面上没有慢速状态节点,`TaskState.slowMode.enabled` 按最后一次 toast 记(起始为关),`supported` 恒为 true(不支持的模型 omp 的 toast "…has no slow mode…" 作为错误抛出)。
- **图片**:TSP 没有图片通道。`sendPrompt` 把图片写到 `os.tmpdir()/omp-studio-images/<任务 id>/`,在文字后面加 `@"<路径>"`(omp 的文件提及,带空格要引号),omp 读成图片附件(工具行 "Read <路径> (image)");任务移除时删目录。

## 附录:依赖 rpc-ui 的代码

完整清单(文件、符号、命令、帧、测试)由只读盘点生成,要点:

- 进程层:`src/main/omp/{launch-args,omp-connection,frame-decoder,session-init}.ts`,`src/main/tasks/{task-runner,task-machine,translate,event-batcher,dialogs,subagent-tracker,subagent-record,session-extras,goal-state,session-tree,convert}.ts`,`src/shared/omp-wire/rpc-wire.generated.ts`。
- 服务进程:`src/main/service/{service-omp,default-model,login}.ts`,`src/main/ipc/account-handlers.ts`。
- 渲染:`features/{conversation,composer,dialogs,lanes,btw,goal}`,`store/{transcript,lanes,btw}-store.ts`,`shared/{transcript,subagents,btw}.ts`。
- 测试:`fixtures/rpc/`、`test/fake-omp/`、`scripts/{record-rpc,update-rpc-wire}.ts`,约 27 个 vitest 文件,e2e 的 `conversation`、`subagent-lanes`、`jobs`、`main-ui`、`clipboard`、`review`、`tray`、`terminal`、`file-preview`、`git-worktree`、`model-picker`、`custom-models`。
