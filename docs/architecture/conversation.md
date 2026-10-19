# 对话流、输入框、门（切片 C）

文件：`src/renderer/src/features/{conversation,composer,dialogs}/`、`src/renderer/src/markdown/`。数据只从 store 取（`useTranscript`、`useTask`），写操作走 `window.studio.*`。协议依据 omp 18.12.1 的 `fixtures/rpc/*.ndjson`；标"推测"的没有实测。

## 结果优先：从对话流到"轮"

`conversation/model.ts` 的 `buildTurns(transcript)`：每条非 synthetic 的 `role:"user"` 消息开一轮，之后的助手消息、工具结果、提示都归这一轮。每轮得到 `steps`（过程）、`answer`（结论）、`extras`（提示、命令输出、模型错误）、计数和时间。

叙述/结论启发式（spec 裁决 Calm-2）：

1. 助手消息里**带工具调用的消息的文字 = 叙述**，进 `steps`；
2. **最后一条不带工具调用、有文字的消息 = 结论**；
3. 兜底：没有这样的消息时，最后一条有文字的助手消息当结论（它的文字不再重复出现在叙述里）；
4. 整轮没有任何助手文字、但有过输出：显示 `turn.noResult`；
5. 正在流式的消息：有文字且还没出现 toolCall 块时，当作结论位置的"实时文字"（`data-live`，`--text-2`），定型后同一个位置渐变为 `--text`；
6. `thinking` 块永不进正文，只在展开的过程里一行；`narration:true` 的思考当作回答文字。

`test/conversation-model.test.ts` 用每份 fixture 经主进程同一个 `translateFrame` 回放，断言结论 = fixture 里最后一条不带工具调用的 `message_end`。`buildTurns(transcript, previous)` 对没变的轮沿用旧对象（`deps` 引用比较），流式追加时已完成的轮不重渲染。

## 过程行

- 运行中：一行 28px：状态点 + 当前动作（运行中工具的 `intent` 原话，缺失用 `tool.verb.*`；其它阶段 `process.starting/thinking/replying/compacting/retryingNow`）+ 计时 + ›。计时、"已暂停"时长由渲染进程自己计（帧没有时间戳）。
- 等你确认（`status:"needs_you"`）：琥珀菱形 + `process.waiting`。
- 结束：`已工作 X · N 次工具调用`，有失败追加红色 `· k 次失败`。**不足 1 秒或 0 次工具调用的轮不显示**（回放瞬间跑完，所以 e2e 里看不到这一行——这是规范行为）。
- 时长 = 该轮 `startedAt`（用户消息接收时间）到最后一次活动。**没有扣除等待确认的时间**：transcript 里没有对话框的起止事件（spec 4.11 的 `process.waited` 没做）。
- 展开：工具行（点击就地展开输出，≤12 行 + 显示全部；失败行默认显示前 4 行）、叙述（`·` 单行）、思考；>200 行只渲染最后 100 条。
- 子代理：`RunSpan.subagents` 只进计数，不显示缩进行（transcript 里没有子代理项）。

## 改动卡片

数字来自工具事件的近似（`tool-info.ts summarizeChanges`）：只统计成功的 `edit`（hashline 的 `[path#TAG]` 或 `path` 参数，行数取结果 `details.diff` 的 +/-）、`write`（`content` 行数）、`ast_edit`。**不是 git 结果**；取不到行数的文件只显示文件名。需要精确数字时应由主进程用 `git diff --numstat` 提供（契约里还没有）。文件行目前不可点：没有"在资源管理器中显示"的契约。本轮 run 结束后才出现。

## 滚动（`use-stick-to-bottom.ts`）

- 距底 ≤48px 视为吸底；吸底时内容增长在 rAF 里 `scrollTop = 底`，每帧至多一次。
- 用户主动上滚（wheel 向上、PageUp/Home/↑、scrollTop 减小且不是程序设置的）立即脱离；脱离后有新内容显示"回到最新"。End 回底。
- 输入框发送 → `scroll-bus.requestStickToBottom` 强制吸底。
- 切任务记各自的 scrollTop 和吸底状态（内存）。
- 阅读锚点：脱离吸底时每次滚动记录视口顶部下方第一个 `[data-anchor]` 块和偏移，`.column` 宽度变化（窗口缩放、侧栏折叠）后还原；点击 `[data-anchor]` 内的按钮（展开/折叠）以该块为锚补偿。
- 离屏的已结束轮（最近 20 轮之外）`content-visibility: auto`。
- 门出现/输入框增高使滚动区变矮：吸底则继续吸底，否则不动 scrollTop。

## Markdown（`markdown/`）

- `parse.ts`：markdown-it（`html:false`，linkify 关）整篇解析后切成顶层块；任务列表标记在这里摘掉。`stabilizeStreaming` 在流式时先藏起行首为 `| # > - * 1.` 或围栏的未完成行，表头要等分隔行到了才放出（spec 5.4 第 2 条）。未闭合的行内标记 markdown-it 本来就当纯文本。
- `render.ts`：token → `createElement`，无 JSX、无 DOM，可在 Node 里测试；**不用 dangerouslySetInnerHTML**。原始 HTML 作为文本转义；链接只放行 `http/https`（与主进程 openExternal 一致，mailto 只显示文字）（markdown-it 的 `validateLink` 先挡掉 `javascript:`/`vbscript:`/`file:`/`data:`，实体编码也在它之前解码），其余相对路径只显示文字；图片只放行 `data:image/*`，远程图片显示成链接。点击经 `window.studio.openExternal`。
- `Markdown.tsx`：每个顶层块 `React.memo`，按块原文比较——已闭合块不重建 DOM，只有最后一块在变。
- `highlight.ts`：Shiki `shiki/core` + JS 正则引擎 + CSS 变量主题，31 种语言按需 `import()`；`markdown.css` 把 `--shiki-*` 映射到 `--syn-*`，深浅主题不重新高亮。围栏闭合后才高亮；`diff` 整行用 `--diff-add-fg/del-fg`。>24 行在流式结束后折叠到 20 行。
- `test/markdown.test.ts`：原始 HTML 转义、危险协议被拒、流式 1/5/50 字符喂入时已闭合块原文不变。

## 输入框（`composer/`）

- 按键判定是纯函数 `send-logic.ts decideEnter`（`test/composer-keys.test.ts`）：IME 组合态（`isComposing` 或 `keyCode 229`）Enter 不发送；空闲 Enter/Ctrl+Enter 发送；运行中 Enter 插话（`prompt`+`whenBusy:"steer"`）、Ctrl+Enter 稍后（`"followUp"`）；有门时 Enter = 拒绝并发送（先 `deny()` 再发），Ctrl+Enter 草稿为空才是门的主操作，**有草稿时门忽略它，落到和没有门时一样的"稍后发送"**（门停靠即视为运行中）。Enter/Ctrl+Enter 对调的设置项契约里没有，`swapped` 恒为 false。
- Esc：没人消耗（`defaultPrevented`）且任务在运行时 `stopTask`，把 `RestoredQueue` 按原文追加回草稿（图片作附件）。toast 由纯函数 `stop-outcome.ts stopToasts` 决定：`runner.stop()` 在 `abort_and_restore_queue` 应答后再读一次 `get_state`，`isStreaming` 仍为 true → `aborted:false`，只报 `stopFailed`，**不说"已停止"**；`hasPendingAsyncWork` → `backgroundWork:true`，追加 `stoppedBackground` 警告。**已知限制（真机复现）**：steer 会让运行中的 bash 转后台（`set_interrupt_mode: immediate`），Esc 能中止这一轮并撤回排队消息，但 omp 没有取消后台 job 的 RPC 命令，job 结束时 omp 会自己开一轮续跑；studio 只能如实告知，不能阻止。
- 队列条只渲染 `task.queue`；移除只有 `removed` 非 null 才把文字放回草稿；提前（`promote`）失败只 toast，**不回退成 steer**。
- 模型/思考胶囊（`ModelChip`）：`listTaskModels` → 分组、搜索、最近 3 个；模型行右侧是紧凑的"上下文窗口 · 输入/输出价格"（`modelRowMeta`，价格全 0 不显示）。思考档位只有一份列表（`thinking-levels.ts thinkingLevelOptions`），picker 分段条、方向键、Alt T 共用：任务里是 `get_available_thinking_levels`（含 `off`，omp 故意不含 `auto`），草稿里没有进程，用 `get_available_models` 里 `thinking.efforts`（`ModelOption.thinkingEfforts`，不含 `off`，因为 `defaultThinkingLevel` 不接受；没给就退回全部 effort）。omp 会把设置的档位钳到模型支持的档位（实测 omp 18.12.2、`deepseek-v4-flash`、efforts `low/high/max`：minimal→low、medium→low、xhigh→high、auto→high；`off` 保留），草稿胶囊用同一规则（`clampThinkingLevel`：取最近的，一样近取较低）显示 omp 会采用的档位，所以草稿和发送后的任务显示一致。不支持思考的模型没有档位。Alt M / Alt T、命令面板的 `model`/`thinking` 命令。
- 审批胶囊：`task.status` 为 `stopped`/`error`（没有进程）可改，其余只读（decisions 第 2 条）；首次选 yolo 内联确认一次（localStorage 记住）。
- 上下文提示 `percent ≥ 70`，≥90 琥珀；"压缩上下文"发 `/compact`（**[推测]** 契约没有 compact 命令，靠斜杠命令在本地执行，未实测）。
- 贴图：粘贴/拖入/⊕，长边缩到 1568px 转 WebP（`OffscreenCanvas`），模型不支持图片时 toast。
- 输入框三个辅助：①斜杠守卫（`slash-guard.ts`）：`/名称` 不在 `get_available_commands`（命令列表非空时）就先提示一次，同一文字再发或点"仍作为文字发送"才发；终端独有命令（plan/tree/fork/copy/goal/btw/hotkeys/settings）用专门文案。守卫在 `Composer` 的发送入口，没有改 `sendDraft`。②输入历史（`input-history.ts`）：↑↓ 翻本任务发过的消息，内存按任务记，对话里的用户消息做种子。③`@` 文件补全（`use-file-menu.ts` + `FileMenu.tsx`）：IPC `listProjectFiles(target, query)`，主进程 `files/project-files.ts` 按 cwd 缓存 10 秒的索引（git ls-files，退回有界遍历），≤10000 条、返回 ≤20 条相对路径；`query` 含绝对路径/`..` 拒绝。
- 草稿只存在渲染进程内存（按任务）；spec 要求主进程持久化，契约里还没有。
- 没做：斜杠命令菜单（arch 不做）、发送中的旋转环（`sendPrompt` 很快 resolve）、`session.inUse` 条。

## 门（`dialogs/`）

- 门不是模态：`DialogLayer` 把 `task.dialogs[0]` portal 进 Composer 里的 `GateSlot`（输入框正上方、同一个底部栈）；同一时刻一个，其余计入 `gate.pending`。`DialogLayer` 还负责 toast（右下角、5 秒、同类合并）和 `onTaskNotice`。
- 焦点：1.5 秒内有按键或输入框有草稿时不抢焦点，只脉冲一次；否则焦点落到门容器（无预选，Enter 不隐式允许）；关闭后回到出现前的元素，没有则输入框。数字键只在门本体聚焦时生效。Ctrl+Enter 出现后 500ms 内忽略。Esc = 取消/拒绝（`stopPropagation`，不会触发"停止任务"）。
- 审批 select（真实帧，omp 18.12.1，`fixtures/rpc/approval-select.ndjson`）：title 第一行 `Allow tool: bash`，其余行是 `Command: …` 细节（等宽 pre-wrap，>8 行折叠）；选项 `Approve` / `Approve <tool> for this session` / `Deny`，没有 `optionDetails`、没有 `timeout`。只对这三种精确文本本地化（`approval-labels.ts`），其它原样显示。应答 `value` 一律是 options 原文。一排按钮时第一项带 `Ctrl+Enter` 键帽、审批的 Deny 带 `Esc` 键帽（`.gate-key`，和 confirm/input 的门一致）。title 里没有的细节来自同一次调用的 `tool_execution_start`（先于门到达）：`gate-preview.ts approvalPreview` 只取 write 的 `content`、edit 的 `input`（hashline 脚本）作为第二块折叠预览，别的工具不编造。
- ask：一次一题；推荐项标"推荐"不预选；固定末项"其他…"；单选下与选项互斥，multi 下并存（**[推测]**）；Esc = cancel。`answers` 每题一条，`selectedOptions` 用原文。
- 超时：带 `timeoutMs` 时顶边 2px 线 + `0:25` 读数（最后 10 秒琥珀）。到期由 omp 发 `cancel`，请求从 `task.dialogs` 消失，界面把它收成一行 `gate.timedOut`/`gate.cancelled`（不是我们答的才显示，见 `gate-bus.ts markAnswered`）。fixture 里没有带 timeout 的请求，这条只在代码里实现，未回放验证。
- `set_editor_text`（`taskNotice.editor_text`）：草稿为空直接写入，否则输入框上方出现"替换/保留"。
- 别的任务进入"等你确认"：右下 toast `toast.needsYou` + 查看。

## 键盘

输入框 Enter/Ctrl+Enter/Esc/Alt M/Alt T；门 Tab/数字键/Esc/Ctrl+Enter；弹层 ↑↓/Enter/←→/Esc，Esc 关闭后焦点回触发器；过程行、工具行、改动卡片都是 `button`；对话区 `tabindex=0` 可用键盘滚动，End 回底；Ctrl Shift C 复制最后一条回答。

## e2e

`test/e2e/conversation.e2e.ts`：`STUDIO_TEST_OMP` 指向 fake-omp。流式中/等你确认用"截断的录制 + `hang`"（测试里生成到临时目录），完成态直接回放 `bash-tool`。截图 `screenshots/conversation-{streaming,done,gate}-{zh-CN,en}-{light,dark}.png`。

## 第二轮补充（协调者追加项）

- **覆盖式滚动条** `src/renderer/src/ui/OverlayScrollbar.tsx`：宿主 `position: relative`，滚动容器隐藏原生条，组件作为兄弟节点。hover 宿主或滚动时出现（指针还在宿主上不自动隐藏），拖滑块滚动，点轨道翻 0.9 页，颜色取 `--scrollbar-thumb(-hover)`，深浅随主题。对话流、侧栏任务列表、命令面板列表共用。
- **压缩上下文**：`compactTask(taskId)` → 任务运行器 `compact()` → RPC `compact {}`（`#live()` 会在没进程时先拉起）。输入框的上下文提示和命令面板的 `compact` 都走它；运行中按钮禁用。
- **斜杠菜单**：`useSlashCommands(taskId)`（`listSlashCommands` + `slashCommands` 事件）；草稿是 `/名字`（没有空格）时按名字、别名过滤（前缀优先，最多 8 行）。↑↓ 选，Tab 补全，Enter 补全（草稿已是完整命令名时发送），Esc 关闭。草稿模式没有进程，菜单不出现。命令面板的 `onComposerText` 把文本放进草稿并聚焦；`DraftComposer` 挂载时取 `takePendingDraftText()`。
- **改动卡片文件行可点**：`openTaskFile(taskId, relPath)` 用系统默认应用打开，`revealTaskFile` 在资源管理器中显示（行右侧按钮或右键）。主进程 `task-file-path.ts`：必须是相对路径、`..`/盘符/绝对路径拒绝，符号链接解析后仍须在任务 cwd 内（`test/task-file-path.test.ts`）；**`.exe/.bat/.ps1/.js/.lnk…` 等可执行类不直接打开**（默认应用打开等于执行 agent 刚写的脚本），只能"显示"。渲染进程把工具参数里的绝对路径按项目目录换成相对路径，换不了的行不可点。
- **草稿持久化**：`getDrafts`/`saveDraft`（`draft-handlers.ts` → `userData/drafts.json`，串行写、先写临时文件再改名；限 300 条、每条 20 万字）。渲染进程 400ms 防抖保存，启动读回（读回之前已经打过字的 key 不覆盖）。只存文字，图片不存。
- 慢速回放：fake-omp 新增 `{"kind":"delay","ms":N}`（见 `rpc-replay.md`）；e2e 在每次 `tool_execution_end` 前等 2.5 秒，得到"已工作 3 秒 · 1 次工具调用"折叠行和展开后的工具列表（截图 `conversation-{folded,expanded}-*`）。
- fake-omp 把 `get_available_commands` 当幂等查询（用启动时的 `available_commands_update` 垫底）：输入框一挂载就会查斜杠命令，不这样做回放会以退出码 3 结束。

## 第三轮（评审修复）

- 停止按钮：`stoppingId` 按任务记，停止请求结束（成功或失败）都复位。e2e 把 `studio:stopTask` 换成抛错的 handler，断言按钮重新可点。
- 过程行：淡入动画的 key 是"在做什么"（工具 id / 阶段），不是文字，等待倒计时每秒变文字但节点不重挂载（e2e 用 MutationObserver 断言 3.5 秒内没有替换）。
- 门的倒计时：`DialogRequest.receivedAt`（ipc.ts 追加，`task-runner` 收到请求时打点），剩余时间和顶边线起点都按它算（`gate-timer.ts`）。ask 门答到一半的内容按请求 id 存在 `ask-draft-store.ts`，卸载后还在，答复成功后清掉。
- mailto：渲染进程白名单与主进程一致，只有 http/https 是可点链接。
- 草稿：`flushDrafts()` 在 `pagehide`/`beforeunload`/页面隐藏时把防抖中的草稿立刻发给主进程（e2e：fill 后立刻 reload，drafts.json 里有内容）。主进程退出时写盘链的冲刷归 Runtime 的 draft-handlers。
- Ctrl O / 命令面板"展开或收起最近的过程"：点最近一个 `.process-row`（e2e 覆盖）。
- 对话流镜像的同步规则抽成纯函数 `store/transcript-sync.ts`（`planBatch`），`test/ui-state.test.ts` 覆盖跳过已应用批次、断档重拉、衔接。
- 焦点：选中任务后聚焦输入框只在 `App.tsx` 一处，同步执行；焦点在侧栏内时不抢；Composer 不再自己聚焦。去掉了 sidebar.e2e 的 `toPass` 重试。侧栏里 Enter 选中任务后进输入框由 Sidebar 在 Enter 处理里聚焦 `[data-composer-input]`。

## 第四轮（试用修复）

- 斜杠命令输出（`command_output`）在主进程 `translateFrame` 里用 `shared/ansi.ts` 的 `stripAnsi` 去掉 ANSI/OSC 转义，存进对话流的就是干净文本；输出里的 http(s) 地址渲染成链接，点击走 `window.studio.openExternal`（主进程只放行 http/https）。`omp config list` 的解析复用同一个函数。
- `fileMention` 消息映射成 `Extra { kind: "file_mention" }`，显示一行灰色"已附带文件：a.py, b.ts"（悬停看完整路径，内容不进界面），紧跟在所属轮的用户消息下面（它是 omp 展开这条消息里的 `@路径` 生成的），其他附注仍在一轮末尾。
- 模型错误的"重试"：只给最近一轮里最后一条 `prompt_error`，且 `error.retryable === true`、任务空闲、`TaskState.lastTurn.status === "error"`；点击走 `sendPrompt` 发 `/retry`。
- 悬停复制按钮（`top: 100%`）原先盖住下一块的文字：`.user` / `.answer` 底部留出 `--control-h-sm` 减去下一块自带的 `--space-3` 上边距。
- 完成播报（`aria-live`）按任务作用域：切换/恢复任务时清空，且不会把"上一个任务忙→这个任务闲"当成刚完成。

## 待办进度条（`TodoStrip.tsx`、`todo-model.ts`）

- 数据：`TaskState.todoPhases`（主进程来自 `get_state.todoPhases`，见 task-model.md）。没有任何待办项时不渲染。
- 位置：对话流顶部、滚动区之外的一行（spec 4.6 的 ProgressPill 在对话区里，不占头部）；展开的列表浮在对话流上，不推动滚动内容。
- 胶囊：`{done}/{total}`（tabular）+ 当前项（第一个进行中，否则第一个未开始）+ 展开箭头；`abandoned` 不计入 total。点击展开，Esc 或点外面收起。
- 列表按阶段分组：`pending` 空圈、`in_progress` 呼吸点（reduced-motion 下不呼吸）、`completed` 对勾、`blocked` 红点 + blocker 原因、`abandoned` 删除线。状态词另有 sr-only 文本。

## `!命令`（输入框里以 `!` 开头的草稿）

- 入口：`composer/actions.ts sendDraft` 的早分支——草稿无图片且以 `!` 开头时走 `runShellDraft`：`window.studio.runBash(taskId, command)` → 主进程 `TaskPool.runBash` → `TaskRunner.runBash`（`#live()` 没进程先拉起，和 compact 一样）→ RPC `bash {command}`（见 `rpc-wire.generated.ts` 的 `BashParams` / `BashResult`）。失败（omp 拒绝、命令过长、进程退出）把原文放回草稿并 toast。
- **`!!`（不进模型上下文）没做**：线上 `BashParams` 只有 `command`，没有 `excludeFromContext` 之类的标志（`BashExecutionMessage` 里有该字段，但 RPC 没法设置）。`!!` 不会悄悄当成 `!` 执行，而是 toast 说明并保留草稿。
- IPC 收窄：`runBash(taskId, command)`、`abortBash(taskId)`；只作用于已存在的任务，cwd 由主进程决定（任务 cwd，渲染进程不传路径），命令是 1–`limits.bashCommandMaxChars`（16384）字符的字符串，在 omp 自己的 bash 工具里执行。它是一个"用户键入命令即执行"的入口，是 `src/main/AGENTS.md` 里内置终端之外的**第二个例外**（仓库所有者 2026-10-19 同意）；规则与终端一致（已有任务、cwd 主进程定、长度上限），不经审批门是因为命令由用户亲手键入，和终端版 omp 一样。
- **实测（omp 18.12.1，rpc-ui）**：`bash` 只回一条 `response`（`data` 有 `output/exitCode/cancelled/truncated/…`），中途没有任何事件帧、也不推 `message_end`；之后 `get_messages` 里能读到一条 `role:"bashExecution"`（`command/output/exitCode/cancelled/truncated/timestamp`）。所以应答回来后主进程把同样的消息合成一个 `message_end`（key `${gen}:bash-${n}`）推进对话流；重新打开会话时 `loadHistory` 读到的就是 omp 记下的那条，两条路径渲染一致。
- 渲染：`bashExecution` 在 `groupItems` 里自己开一轮（模型自己的 bash 是 `toolCall`，不会产生这种消息），`buildTurn` 把它变成 `Extra { kind: "shell" }`；`ShellBlock` 画命令行（`$ cmd`）、非 0 退出码 / 已取消、输出（超过 12 行默认只显示最后 12 行，"展开全部（N 行）"）、`truncated` 时"omp 已截断输出"。失败只用左 2px 红线和红字。
- 运行期间：omp 只在结束时应答，没有流式输出，所以只显示一行"命令 + 正在运行… + 停止"（`ShellRunning`，状态在 `shell-run-store.ts`，由 `runShellDraft` 开关）。停止按钮和 Esc 调 `abortBash` → RPC `abort_bash`：Esc 只归输入框的窗口级处理（有 `!` 在跑就中止它，否则才停这一轮），`ShellRunning` 不另挂监听；没有命令在跑时 `abortBash` 什么也不发。被取消的命令照常记成 `cancelled` 的块。进程还在启动时按的停止不丢：先记下，`bash` 请求一发出就补发 `abort_bash`。
- 限制：任务在跑一轮（含有门停靠）或这个任务已有 `!` 在跑时不执行，toast 说明并保留草稿（避免把正在进行的一轮切成两段）；门停靠时输入 `!` 不会被当成"拒绝并发送"。新任务草稿里的 `!` 也不执行（还没有 omp 进程和任务目录），提示先发第一条消息。
- 测试：`test/task-bash.test.ts`（fake-omp：成功、失败应答、空命令、abort）、`test/conversation-model.test.ts`（历史里的 `bashExecution` → 命令块）。
