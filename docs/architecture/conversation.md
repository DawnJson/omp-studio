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

- 按键判定是纯函数 `send-logic.ts decideEnter`（`test/composer-keys.test.ts`）：IME 组合态（`isComposing` 或 `keyCode 229`）Enter 不发送；空闲 Enter/Ctrl+Enter 发送；运行中 Enter 插话（`prompt`+`whenBusy:"steer"`）、Ctrl+Enter 稍后（`"followUp"`）；有门时 Enter = 拒绝并发送（先 `deny()` 再发），Ctrl+Enter 草稿为空才是门的主操作。Enter/Ctrl+Enter 对调的设置项契约里没有，`swapped` 恒为 false。
- Esc：没人消耗（`defaultPrevented`）且任务在运行时 `stopTask`，把 `RestoredQueue` 按原文追加回草稿（图片作附件），`imagesDropped` / `queueRestored` toast。
- 队列条只渲染 `task.queue`；移除只有 `removed` 非 null 才把文字放回草稿；提前（`promote`）失败只 toast，**不回退成 steer**。
- 模型/思考胶囊（`ModelChip`）：`listTaskModels` → 分组、搜索、最近 3 个；思考分段条取 `task.thinkingLevels`（过滤掉 `inherit`），不支持思考的模型禁用。Alt M / Alt T、命令面板的 `model`/`thinking` 命令。
- 审批胶囊：`task.status` 为 `stopped`/`error`（没有进程）可改，其余只读（decisions 第 2 条）；首次选 yolo 内联确认一次（localStorage 记住）。
- 上下文提示 `percent ≥ 70`，≥90 琥珀；"压缩上下文"发 `/compact`（**[推测]** 契约没有 compact 命令，靠斜杠命令在本地执行，未实测）。
- 贴图：粘贴/拖入/⊕，长边缩到 1568px 转 WebP（`OffscreenCanvas`），模型不支持图片时 toast。
- 草稿只存在渲染进程内存（按任务）；spec 要求主进程持久化，契约里还没有。
- 没做：斜杠命令菜单（arch 不做）、发送中的旋转环（`sendPrompt` 很快 resolve）、`session.inUse` 条。

## 门（`dialogs/`）

- 门不是模态：`DialogLayer` 把 `task.dialogs[0]` portal 进 Composer 里的 `GateSlot`（输入框正上方、同一个底部栈）；同一时刻一个，其余计入 `gate.pending`。`DialogLayer` 还负责 toast（右下角、5 秒、同类合并）和 `onTaskNotice`。
- 焦点：1.5 秒内有按键或输入框有草稿时不抢焦点，只脉冲一次；否则焦点落到门容器（无预选，Enter 不隐式允许）；关闭后回到出现前的元素，没有则输入框。数字键只在门本体聚焦时生效。Ctrl+Enter 出现后 500ms 内忽略。Esc = 取消/拒绝（`stopPropagation`，不会触发"停止任务"）。
- 审批 select（真实帧，omp 18.12.1，`fixtures/rpc/approval-select.ndjson`）：title 第一行 `Allow tool: bash`，其余行是 `Command: …` 细节（等宽 pre-wrap，>8 行折叠）；选项 `Approve` / `Approve <tool> for this session` / `Deny`，没有 `optionDetails`、没有 `timeout`。只对这三种精确文本本地化（`approval-labels.ts`），其它原样显示。应答 `value` 一律是 options 原文。
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
