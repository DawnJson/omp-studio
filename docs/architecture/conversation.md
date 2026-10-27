# 对话区、输入框和斜杠命令

所有任务都是 TSP：对话区的内容是 omp 发来的节点树，studio 只决定每种节点长什么样；输入框、侧栏、顶栏是 studio 自己的。协议、节点渲染、文档同步见 [tsp-migration.md](tsp-migration.md) §7–§10。文件：`src/renderer/src/features/{tsp,composer,conversation,dialogs,agents,goal,btw}/`、`src/renderer/src/markdown/`。数据从 store 取（`useTask`、`useTspNode` 等），写操作走 `window.studio.*`。omp 行为结论标了版本（18.12.5）；标"推测"的没有实测。

## 对话区（`features/tsp/`）

- `TspView`：inline surface 的 `main` 在可滚动的对话区，`dock`（运行状态、提问 / 审批、排队）贴在下面、Composer 正上方，`layer` 是盖在整块上的浮层容器（选择器、弹窗）；screen surface（如 `/settings`）盖住整个过程区。
- 用户消息、助手消息（`omp.assistant`，正文是 `md` 节点）、工具卡片、子代理卡片、待办、压缩分隔、用量脚注都是 omp 的节点，折叠 / 展开状态跟着节点的 `collapsed`（用户翻过之后以本地状态为准，见 `use-fold.ts`）。过程怎么展开 / 折叠由 omp 的节点决定，studio 不另外折叠，也不自己把对话流切成"轮"（2026-10-22 仓库所有者：没有"过程默认折叠"这条规则）。
- 过程区里 studio 自己加的文字不汉化（所有者 2026-10-21，集中在 `features/tsp/labels.ts`）。
- 文件链接（工具卡片上的路径、`file://` 的 `href`）点开在右侧预览（`openHref` → `openFilePreview`），Esc 关闭、焦点回到链接；e2e `test/e2e/file-preview.e2e.ts`。

### 滚动（`conversation/use-stick-to-bottom.ts`）

- 距底 ≤48px 视为吸底；吸底时内容增长在 `ResizeObserver` 回调里直接 `scrollTop = 底`：回调在排版之后、绘制之前，这一帧画出来就在底部。2026-10-25 之前留到下一个 rAF 设，回放 `task.jsonl` 时 36 次长高里 24 次先在底边下面画一帧（最多 80px）再跳上来，看着是新消息"闪一下"（`tsp.e2e.ts`"流式吸底"）。
- 用户主动上滚（wheel 向上、PageUp/Home/↑、scrollTop 减小且不是程序设置的）立即脱离；脱离后有新内容显示"回到最新"。End 回底。"scrollTop 减小"只在可滚范围（`scrollHeight - clientHeight`）和上次滚动事件时一样、或按着鼠标 / 触摸时才算：scroll 事件晚一帧派发，omp 先收起上方的块（浏览器把 `scrollTop` 夹小）、同一帧又长出新内容时，读到的也是"scrollTop 变小、离底很远"，那是布局变化（2026-10-25：mac CI 上"完整一轮"e2e 连续两次停在半截；用 CDP `Emulation.setCPUThrottlingRate` 降速 3 倍复现，修前 12 次里 9 次停在半截，修后 0 次）。
- 输入框发送 → `scroll-bus.requestStickToBottom` 强制吸底。
- 切任务记各自的 scrollTop 和吸底状态（内存）。
- 阅读锚点：脱离吸底时每次滚动记录视口顶部下方第一个 `[data-anchor]` 块和偏移（只看最外层的块：缓存列表，对话列直接子元素增删时作废，按底边二分，每次滚动只读 O(log n) 个矩形）；内容尺寸变化（列宽变化、锚点上方的块变高变矮）后让锚点块回到原偏移，底下长出新内容才提示"回到最新"；点击 `[data-anchor]` 内的按钮（展开/折叠）以该块为锚补偿，补偿后重记阅读锚点。
- TSP 的对话区关掉浏览器的滚动锚定（`overflow-anchor: none`）：omp 一直在改写视口上方的节点，锚定会把 `scrollTop` 往上推，被误认成用户上滚（[tsp-migration.md](tsp-migration.md) §8）。脱离吸底时由上一条的阅读锚点补偿代替。
- inline 对话区的顶层块（`.tsp-column > [data-anchor]`，用户消息除外）用 `content-visibility: auto; contain-intrinsic-block-size: auto 160px`：离屏块不排版、不绘制；没画过的块按 160px 估计占位，滚到附近换成实际高度，差值由阅读锚点补偿。块自带 paint 包含：后代画到块外会被裁掉、点击也落不到，节点里不能放超出块边界的弹层（菜单、放大图在 `TspHosts` / `layer` 里）。用户消息不加：气泡上方的悬停按钮行和悬停桥（`bottom: 100%`）在块外，加了就点不到回退、复制按钮（2026-10-27 e2e；`overflow-clip-margin` 不管用）。
- 覆盖式滚动条 `src/renderer/src/ui/OverlayScrollbar.tsx`：宿主 `position: relative`，滚动容器隐藏原生条，组件作为兄弟节点。hover 宿主或滚动时出现（指针还在宿主上不自动隐藏），拖滑块滚动，点轨道翻 0.9 页，颜色取 `--scrollbar-thumb(-hover)`，深浅随主题。对话区、侧栏任务列表、命令面板列表共用。
- 对话线 `features/tsp/ConversationLine.tsx`（spec §4.15）：用户消息从 TSP 文档取（`shared/tsp/user-messages.ts` 的 `userMessages`，main 里 `card role=omp.user`，id 是卡片的节点 id），页面里按 `[data-id]` 找卡片（消息列表变了才重找，元素被换掉时补找）。点刻度直接改 `scrollTop`（不走 `scrollIntoView`，免得连带滚外层），上滚就按"用户主动上滚"脱离吸底；之后 900ms 内对话列尺寸一变（落点附近的块从估计高度换成实际高度）就把落点放回原处，用户滚轮 / 按下 / 按键即停。当前刻度在滚动和尺寸变化时每帧至多算一次，按卡片顶边二分。omp 压缩后只留压缩点之后的消息（`omp.compaction` 之前的 `omp.user` 不再发），所以对话线也只有这些。

## Markdown（`markdown/`）

`md` 节点的 `p.text` 是 markdown 原文，由这里渲染（`features/tsp/nodes/text.tsx`），子代理面板、旁路提问、文件预览、omp 更新日志也用它。

- `parse.ts`：markdown-it（`html:false`）整篇解析后切成顶层块；任务列表标记在这里摘掉。linkify 只认写全的 `http(s)://` 网址（2026-10-25 起，模型常输出裸网址；之前关着、只认 `[文字](网址)`）：不猜 `example.com`、邮箱、IP，去掉 `ftp:` / `mailto:` / `//`；句末的中文句号等标点不算网址。`stabilizeStreaming` 在流式时先藏起行首为 `| # > - * 1.` 或围栏的未完成行，表头要等分隔行到了才放出（spec 5.4 第 2 条）。未闭合的行内标记 markdown-it 本来就当纯文本。
- 流式增量解析（2026-10-27 起，`parseStreaming`）：流式时不再每批整篇重解析，而是复用上一次的块（同一个对象），只从最后一个"前一行是空行、且新旧原文到这一行为止相同"的顶层块重解析到末尾；结果与整篇解析逐字段相同（`test/markdown.test.ts` 逐前缀比对，含列表跨空行、缩进代码、围栏、公式块、setext、表格）。原文里有 `]:`（可能是链接引用定义，后定义前使用）或 `\r` 时整篇重解析。流式结束（`streaming=false`）整篇解析一次。实测 20KB 回答按 30 字一批：解析总耗时 ~750ms → ~29ms。
- `render.ts`：token → `createElement`，无 JSX、无 DOM，可在 Node 里测试；**不用 dangerouslySetInnerHTML**（唯一例外是 KaTeX 的输出）。原始 HTML 作为文本转义；链接只放行 `http/https`（与主进程 openExternal 一致，mailto 只显示文字）（markdown-it 的 `validateLink` 先挡掉 `javascript:`/`vbscript:`/`file:`/`data:`，实体编码也在它之前解码），其余相对路径只显示文字；图片只放行 `data:image/*`，远程图片显示成链接。点击经 `window.studio.openExternal`。KaTeX 由调用方经 `RenderContext.katex` 传入，没有时公式按原文放在 `<code>` 里。
- 有序列表的序号是 `li` 里的真文字（`.md-ol-n`，`list-style: none`，绝对定位在内容左边，看起来和原生 `::marker` 一样）：Chromium 复制选中文字（选中即复制、Ctrl+C）时不带 `::marker`，用原生序号复制出来没有"1. 2."（Electron 44 实测，2026-10-27）。无序列表的圆点照旧用 `::marker`，复制时不带。
- `Markdown.tsx`：每个顶层块 `React.memo`，按块原文比较——已闭合块不重建 DOM，只有最后一块在变。KaTeX（JS + CSS）按需加载：第一次出现公式 token（块的 `math` 标记）才 `import()`，加载完只重画含公式的块。
- `highlight.ts`：Shiki `shiki/core` + JS 正则引擎 + CSS 变量主题，31 种语言按需 `import()`。语言名和别名在 `highlight-languages.ts`（没有 `import()`，主线程引用它）；`import()` 表在 `highlight-loaders.ts`，只有 worker 引用——主线程碰到它，每个语言包会再打出一份没人加载的 chunk（2026-10-27 拆开前 cpp/php/ruby 等 6 个语言包各两份，≈1.1 MB）。分词在 Web Worker 里（`highlight-worker.ts`，ES 模块 worker，`electron.vite.config.ts` 的 `worker.format: "es"`，iife 不能拆语言包）：同步分词几百行要 100ms 以上，放主线程会在打开任务后卡住滚动和动画（2026-10-26 实测：空闲时最长帧 49–63ms → 14ms）。主线程有结果缓存（LRU，200 段）和请求队列：同一段代码并发请求只算一次；worker 里同时只放 2 个请求，其余在主线程排队，排队时调用方全卸载了（滚过去、折叠、切任务）就丢掉不算；worker 起不来时请求失败、调用方显示纯文本，下次重建。组件统一用 `useHighlighted(code, lang)`（`lang` 传 `null` = 不高亮，如围栏没闭合；代码变了不会拿旧 token 对新代码），代码块、过程区、评审 diff 共用。`tokens.css` 的 `:root` 把 `--shiki-*` 映射到 `--syn-*`（全应用一份：对话、评审、文件预览的源码视图都用它），深浅主题不重新高亮；Markdown 源码先加载围栏代码块用到的语言，块里的代码才着色。围栏闭合后才高亮；`diff` 整行用 `--diff-add-fg/del-fg`。代码块全文显示，不折叠（spec §4.10）。
- `svg-figure.ts`：```` ```svg ```` 围栏闭合后画成图（`CodeBlock.tsx`）。omp 的做法（读 v18.12.6 源码，未在 studio 里实测）：交互式会话的系统提示让模型把版式、示意图画成 ```` ```svg ````，只许用 `currentColor` 和 `var(--fg)` `--muted` `--border` `--surface` `--accent` `--success` `--warning` `--error`、`--c1`…`--c6` 这几个颜色（`prompts/system/system-prompt.md` 的 `renderSvg` 段，开关是 `tui.renderSvg`，默认开；`main.ts` 里交互模式才算 `tuiTranscript`，studio 的 TSP 任务跑的就是交互式 omp，所以这段提示在），TUI 用 `tui/src/chat/svg-source.ts` 把这些变量换成终端主题色再栅格化。studio 照样替换：变量（含带默认值的写法）和 `currentColor` 换成 `FIGURE_TOKENS` 对应的 tokens.css 实际颜色（`getComputedStyle(document.documentElement)` 读，切主题经 `ui/theme-change.ts` 重画），补 `xmlns`，转成 `data:` URL 给 `<img>`——不执行脚本、不加载外部资源、不碰页面 DOM。`test/svg-figure.test.ts` 覆盖替换和 `xmlns` 补全。
- `test/markdown.test.ts`：原始 HTML 转义、危险协议被拒、流式 1/5/50 字符喂入时已闭合块原文不变。

## 输入框（`composer/`）

输入框是 studio 自己的 `<textarea>`（omp 的输入框节点 `omp.editor` 不画），发送 / 编辑经 TSP 事件或按键写给 omp（[tsp-migration.md](tsp-migration.md) §8「输入」、§10.4）。

- 按键判定是纯函数 `send-logic.ts decideEnter`（`test/composer-keys.test.ts`）：IME 组合态（`isComposing` 或 `keyCode 229`）Enter 不发送；Enter / Ctrl+Enter 发送；运行中 Enter 默认 `send`（插话，omp 自己排队 / steer），Ctrl+Enter（或发送键旁下拉的"等这一轮结束再发"）= `whenBusy: "followUp"`，主进程发 omp 的 `/queue <文字>`（见 [composer-input.md](composer-input.md) §3）；有审批在等时 Enter = 拒绝并发送，Ctrl+Enter = 批准，Ctrl+O = Details（见 [dialogs.md](dialogs.md)）。提问在等、全屏面板（含 Agent Hub）开着时不能发送，输入框给出提示。
- Esc：没人消耗（`defaultPrevented`）且任务在运行时 `stopTask`：主进程把 Esc 交给 omp 停下这一轮；排队消息（`omp.queue` 节点，`shared/tsp/queue-restore.ts`）被 omp 写回它自己的输入框，由主进程读出来返回（读法和清空是 omp 输入框回填的通用规则，见 [composer-input.md](composer-input.md) §5），按原文追加回草稿（图片作附件）。toast 由纯函数 `stop-outcome.ts stopToasts` 决定：只有这一轮确实停下才说"已停止"（有排队消息则带条数），没停下只报 `stopFailed`；用户按过停止的那一轮 `lastTurn` 记为 `aborted`。
- 模型 / 思考胶囊（`ModelChip`）：`listTaskModels` → 分组、搜索、最近 3 个；模型行右侧是紧凑的"上下文窗口 · 输入/输出价格"（`model-groups.ts` 的 `modelContextCell` / `modelPriceCell`，价格全 0 不显示）。切换是给 omp 的节点发事件（[tsp-migration.md](tsp-migration.md) §10.3），不往输入框塞文字。思考档位只有一份列表（`thinking-levels.ts thinkingLevelOptions`），picker 分段条、方向键、Alt T 共用：任务里是模型目录的 `thinkingEfforts` 加 `off`，草稿里没有进程，用 `get_available_models` 里的 `thinking.efforts`（不含 `off`）。omp 会把设置的档位钳到模型支持的档位（实测 omp 18.12.2、`deepseek-v4-flash`、efforts `low/high/max`：minimal→low、medium→low、xhigh→high、auto→high；`off` 保留），草稿胶囊用同一规则（`clampThinkingLevel`：取最近的，一样近取较低）显示 omp 会采用的档位，所以草稿和发送后的任务显示一致。不支持思考的模型没有档位。Alt M / Alt T、命令面板的 `model` / `thinking` 命令。
- 审批胶囊（`ApprovalChip`）：读写 omp 的 `tools.approvalMode`，没有进程的任务（`stopped` / `error`）可改，其余只读；首次选 yolo 内联确认一次（localStorage 记住）。详见 [omp-settings.md](omp-settings.md)「审批模式」。
- 工具行右侧的用量：上下文圆环（点开是构成，类别和数字都是 omp `/context` 算的，见下面「上下文构成」）、费用（`SessionCost`）；运行中模型 / 审批胶囊右边是上一条回复的输出速度（`UsageMeter`：会话文件里 assistant 消息的 output ÷ (duration − ttft)，一轮结束时刷新；omp 没有实时速度）。数据来源见 [task-model.md](task-model.md)「输入框上的状态从哪来」。上下文 ≥90% 圆环变琥珀。
- 贴图、粘贴、拖入文件：见 [composer-attachments.md](composer-attachments.md)。图片走 omp 自己的图片附件：`sendPrompt` 把图片写成临时文件，在 omp 的输入框里填字、括号粘贴路径、`action submit`（composer-attachments.md「发图片」）。粘贴的非图片文件不走图片流程：preload 在隔离世界里取路径（`src/preload/index.ts`，spec §4.14）。
- 输入框三个辅助：①斜杠守卫（`slash-guard.ts`）：`/名称` 不在命令表（omp 的 `get_available_commands` + TUI 才有的命令 + studio 接管的命令，非空时）里就先提示一次，同一文字再发或点"仍作为文字发送"才发；没有"终端版独有"的特殊提示了。②输入历史：studio 自己按项目持久化，↑ 翻看、Ctrl+R 搜索（`input-history.ts`、`history-store.ts`）。③`@` 文件补全（`file-complete.ts` + `use-file-menu.ts` + `FileMenu.tsx`）：IPC `listProjectFiles(target, query)`，主进程 `files/project-files.ts` 按 cwd 缓存 10 秒的索引（git ls-files，退回有界遍历），≤10000 条、返回 ≤20 条相对路径；`query` 含绝对路径 / `..` 拒绝；发给 omp 后由 omp 展开 `@路径`。命令表、参数接管、发送方式、历史、omp 输入框回填的细节见 [composer-input.md](composer-input.md)。
- **草稿持久化**：`getDrafts` / `saveDraft`（`draft-handlers.ts` → `userData/drafts.json`，串行写、先写临时文件再改名；限 300 条、每条 20 万字）。渲染进程 400ms 防抖保存，启动读回（读回之前已经打过字的 key 不覆盖）。只存文字，图片不存。`flushDrafts()` 在 `pagehide` / `beforeunload` / 页面隐藏时把防抖中的草稿立刻发给主进程（e2e `composer-draft.e2e.ts`：fill 后立刻 reload，drafts.json 里有内容）。
- **`!` / `$` 开头的文字**原样发给 omp，由 omp 在对话里画结果：`!echo x` 当 bash 执行（节点 `omp.bash` / `omp.tool.bash.*`），`$ print(1)` 当 eval 执行（`omp.eval`）（omp 18.12.5 实测，[tsp-real-omp-probes.md](tsp-real-omp-probes.md) §3）。`!!` 是否进模型上下文由 omp 决定，没有逐项核对。studio 没有自己的"运行命令"通道。
- 焦点：选中任务后聚焦输入框只在 `App.tsx` 一处，同步执行；焦点在侧栏内时不抢；侧栏里 Enter 选中任务后进输入框由 Sidebar 在 Enter 处理里聚焦 `[data-composer-input]`。

### 键盘

输入框 Enter / Ctrl+Enter / Esc / Alt M / Alt T / ↑↓（输入历史）；审批 Enter / Ctrl+Enter / Ctrl+O / Esc；提问对话框和选择器见 [tsp-migration.md](tsp-migration.md) §10.6；弹层 ↑↓ / Enter / ←→ / Esc，Esc 关闭后焦点回触发器。作用在当前任务对话上的两个全局键：**Ctrl Shift C** 复制最后一条回答，**Ctrl O** 展开或收起所有工具卡片（`features/tsp/use-task-commands.ts`，命令面板里是同名命令 `copyLast` / `toggleProcess`）：

- `copyLast`：`shared/tsp/last-answer.ts` 的 `lastAnswerText` 从 TSP 文档取最后一条有正文的助手消息的 markdown 原文（`omp.assistant` 容器里不带 role 的 `md` 节点；工具卡片、思考块、错误卡里的不算），写进剪贴板并 toast；没有回答时提示 `cmd.copyLastEmpty`。测试 `test/tsp-last-answer.test.ts`（真实录制 `fixtures/tsp/task.jsonl` + 合成文档）。
- `toggleProcess`：把 Ctrl+O（`\x0f`，omp 的 `app.tools.expand`）写给 omp。**omp 18.12.5 实测**（真实 omp、临时 agent 目录，一轮 bash 工具调用之后）：一次 Ctrl+O 把 `omp.tool.bash` 卡片的 `collapsed` 从 `true` 变成 `false`，再按一次变回 `true`；思考块（`omp.thinking`）的 `collapsed` 不变。studio 的折叠状态跟着程序发来的 `collapsed` 走，所以不用自己改。输入框里的审批门用 Ctrl+O 当"Details"（Composer 先处理并 `preventDefault`，不会再触发展开）；焦点在终端面板里时不拦。

## 导出 HTML

- 入口三处，同一动作：输入框 `/export`（studio 接管的斜杠命令，omp 的同名命令被它盖住）、命令面板 `cmd.exportHtml`、侧栏任务行菜单 `task.exportHtml`；动作在 `composer/export-html.ts`。`/share` 不动，仍是 omp 自己的命令。
- 路径由主进程定：IPC `exportTaskHtml(taskId)` 在主进程弹 `dialog.showSaveDialog`（默认桌面、文件名 `<任务标题清理后>-<本地日期>.html`，清理见 `tasks/export-name.ts`），`exportTarget` 保证扩展名是 `.html`（`.htm` 不算，补 `.html`），经 `TaskPool.exportTaskHtml` → `TspRunner.exportHtml(outputPath)`。渲染进程不传任何路径；取消对话框 = 返回 `null`，什么也不发生。
- 后端：对会话文件跑 `omp --export <会话文件> <输出路径>`（主进程 `omp/export-session.ts`，`PoolDeps.exportSession`，`runtime.ts` 接上）。实测（omp 18.12.5）：第二个位置参数就是输出路径，绝对路径（含中文、空格、不存在的上级目录）原样照写、不补扩展名，不带输出路径时写成当前目录下的 `omp-session-<文件名>.html`（会弄脏项目目录，所以总是传路径）；会话文件不存在时退出码 1，stderr 是 `Error: File not found: …`。任务还没有会话文件（没发过消息）时拒绝（`this task has no session file yet`）。任务运行中也能导出（读的是磁盘上已写的部分）。
- 成功后 toast `toast.exported` + `toast.revealExport`；按钮调 `revealTaskExport(taskId)`，主进程只显示**它自己选的、该任务最近一次导出的路径**（`tasks/export-record.ts`：记下的是 target，且要求返回的路径解析后与 target 一致，否则不记录；任务归档 / 移除时清掉记录），没导出过就拒绝。
- 测试：`test/export-name.test.ts`、`test/export-record.test.ts`、`test/task-tsp.test.ts` "导出" 两条。

## 上下文构成

点圆环弹出的构成照抄 omp `/context` 的数字（2026-10-22 起；之前 studio 自己按会话文件里的 `contextSnapshot` 估算系统提示词和工具定义，和 omp 对不上，也不随对话刷新）。

- 怎么读：`TspRunner.readContext()`（`shared/tsp/context-report.ts` 解析）。主进程向 omp 输入框卡片上的 meter（role `omp.composer.context`）发 `action`（`actions.click` = `status.context`），等报告出现，读完再向报告底栏的 Close（role `omp.btn`）发它自己的 `action` 关掉。**不用 Esc 关**：运行中 Esc 会打断这一轮。渲染进程读的期间 `beginTspDrive(taskId, { kind: "context" })`，`TspView` 不画 layer，omp 的弹窗不会闪出来。
- 实测 omp 18.12.6（真实 omp 探针，临时 `PI_CODING_AGENT_DIR`；录制 `fixtures/tsp/context-report.jsonl`）：
  - 报告是 layer 里一个 modal overlay，role `omp.overlay.report`，正文 role `omp.context`；`omp.context.cats` 下每类一行 role `omp.context.cat`，节点 id 末段是类别 id：`systemPrompt` / `systemTools` / `systemContext` / `skills` / `messages`，然后是 `omp.context.cat.free`、有预留时 `omp.context.cat.buffer`。
  - 每行的 `title` 是 `<名称> · <token 数，千分位> tokens`，是精确值（行里画的是 `3K` 这样的缩写）。各类之和 + 剩余 + 预留 = 窗口（200K 窗口：2,958 + 4,543 + 115 + 549 + 0 + 161,835 + 30,000）。
  - **运行中也能读**：一轮 bash 工具调用进行中点 meter，omp 当场弹出报告，Close 关掉后这一轮照常跑完（回复正确，没有 "Stopped"）。空闲时 omp 在收到点击后 5-11 ms 画出报告（录制里两次）；运行中没有计时。
  - omp 没在运行、输入框被提问 / 审批换掉时读不到（`TSP_COMPOSER_UNAVAILABLE`），界面显示 `composer.context.unavailable`。
- 新任务草稿没有 omp 进程：已用 0，只画剩余空间和按压缩设置算的自动压缩预留（`composer/context-rows.ts`）。

## 压缩上下文

命令面板"压缩 context"（`cmd.compact`）→ `window.studio.compactTask(taskId)` → `TaskPool.compactTask` → `TspRunner.compact()`：发 `/compact`，等 omp 画出压缩分隔（成功）或 "Error: Compaction failed: …"（失败，原文作为错误抛出），上限 5 分钟；没有进程时先拉起。omp 18.12.5 实测见 [tsp-migration.md](tsp-migration.md) §10.6「`/compact` 的结局」。输入框里直接输入 `/compact` 是 omp 自己的命令，同样会压缩（没有等待结果的封装）。

2026-10-23 起（B1Board，实测见 [todo-board.md](todo-board.md)）：上下文浮层的"压缩"一栏（`ContextCompact`）有"立即压缩"（`TaskCommand` `compact`）和"交接"（`TaskCommand` `handoff` → `TspRunner.handoff`，`/handoff`，判定同 `/compact`：新增 `omp.compaction` 分隔 = 成功，`Error: Handoff failed` / `Compaction failed` = 失败）。自动压缩触发点、预生成摘要起点和摘要状态读输入框卡片上 `omp.composer.context` 的 `marks` 和标题（`shared/tsp/context-compaction.ts` → `TaskState.contextCompaction`），是 omp 算好的生效值；圆环上画一道刻度。omp 没给的（自动压缩关着、摘要没在生成）不显示。

## 斜杠菜单和 studio 接管的命令

- 命令列表：`useSlashCommands(taskId)`（`listSlashCommands`，服务进程的 `get_available_commands`，和任务进程无关）；草稿页是 `useDraftSlashCommands()`（`listSlashCommands(null)`，同一份，`composer/use-draft-slash.ts` 管菜单和按键）。加载规则在纯函数 `palette/slash-cache.ts`：每个键同时只有一个请求，**空数组和失败都不记为"已取过"**，任务状态变化（起进程完成）时会再取，拿到非空才停（以前空数组被缓存，新建任务里菜单永远不出现）。草稿是 `/名字`（没有空格）时按名字、别名过滤（前缀优先，最多 8 行）。↑↓ 选，Tab 补全，Enter 补全（草稿已是完整命令名时发送），Esc 关闭。命令面板的 `onComposerText` 把文本放进草稿并聚焦；`DraftComposer` 挂载时取 `takePendingDraftText()`。
- **studio 接管的命令**（桌面优先：能在 studio 自己界面里做的，输入同名命令就开 studio 的界面，不触发 omp 的终端弹窗）：唯一的表是 `composer/studio-slash-table.ts`，每条有名字、别名、说明和 `run`；写了 `draft` 的在新任务草稿页也能用（不创建任务）。判定在 `studio-slash.ts` 的 `handledCommands` / `withStudioSlash`（纯函数），输入框 `sendDraft`、命令面板的 `/` 行、草稿页 `send` 用同一份；同名时 studio 的优先，omp 列表里的同名项从菜单里去掉。表里的命令不发给 omp，处理函数自己报错，抛错时草稿放回输入框。表里有：`/new`（当前项目的新任务草稿）、`/resume`（开命令面板，搜任务和历史会话）、`/settings`、`/hotkeys`（设置页的快捷键分节）、`/git`（提交对话框）、`/rename [新名]`（带名字直接改；不带名字时侧栏里该任务行就地改名，侧栏收起会展开）、`/delete`（`archiveWithUndo`，8 秒内可撤销）、`/model`（别名 `/switch`）和 `/effort`（都开模型选择器，思考强度在里面）、`/usage`（用量对话框）、`/context`（上下文构成，omp 还没给出占用时提示）、`/todo`（待办板）、`/export`、`/tree`、`/fork`、`/goal`、`/btw`、`/jobs`、`/hub`（子代理面板），以及各功能追加的命令（目录、插件、集成、会话信息、会话开关，见表文件开头的 import）。不在表里的 `/命令` 原样发给 omp，由它在过程区里画界面（弹窗、选择器等）。
- 测试：`test/studio-slash.test.ts`、`test/slash-cache.test.ts`、`test/composer-assist.test.ts`、`test/toggle-slash.test.ts`。

## 待办板

数据 `TaskState.todoPhases`（主进程从 dock 里 `omp.hud.todo` 的 checklist 换算，见 [tsp-migration.md](tsp-migration.md) §7「待办」）。没有任何待办项时不渲染。位置：输入框上方状态行的右端（`ComposerTop` → `TodoBoard.tsx`，`todo-model.ts`）；omp 自己的待办药丸不画。按钮照 Tern 里的 omp（2026-10-22 起；omp 18.12.6 在隔离的 Tern 里从列出计划跑到全部完成逐帧截图）：进度环（弧长正好是 完成/总数，0 是 12 点钟一个圆点，进行中的那项不算半格）+ 当前项（第一个进行中，否则第一个未开始；全部完成时写“全部完成”）+ `{done}/{total}`（tabular，比文字淡）；`abandoned` 不计入 total。全部完成后 omp 过 `tasks.todoClearDelay` 秒自己删掉 HUD 节点（omp 源码 `interactive-mode.ts` 的 `#syncTodoHudState`：在会话里记一条 dismissed 再重画 HUD；Tern 里“All done 8/8”停十几秒后消失），`todoPhases` 变空，按钮跟着消失。点击展开，Esc 或点外面收起。列表按阶段分组：`pending` 空圈、`in_progress` 细弧（任务在跑时转动，reduced-motion 下停住）、`completed` 对勾、`blocked` 红色细圈 + 感叹号 + blocker 原因、`abandoned` 删除线。状态词另有 sr-only 文本。

2026-10-23 起（B1Board，细节和 omp 18.12.6 实测见 [todo-board.md](todo-board.md)）：条目下面显示备注（HUD 的 `note`，`TodoItem.notes`；受阻的是 blocker）；每条右边有 ⋯ 菜单（开始 / 完成 / 放弃 / 删除，菜单内嵌在浮层里，浮动 `Menu` 渲染在 body 上会被 `Popover` 当成点外面而关掉板），经 `TaskCommand` `todo` 变成 `/todo start|done|drop|rm <内容>`，成功读 omp 的 toast、失败读新增的 `Error:` 行（`TspRunner.runTodoCommand`）；板底有"添加条目"（`/todo append "<阶段>" "<任务>"`，阶段可选）、"复制为 Markdown"（本地拼，和 omp `/todo` 同文，`todoMarkdown`）、"展开全部"（已做完的阶段默认收起，同 omp HUD，只改界面不发命令）。重名条目只能操作第一个；没有待办时板不出现。

## 旁路提问（`/btw`，`features/btw/`）

入口：`/btw [问题]`（`btwSlash`，不发给模型）和命令面板"旁路提问（/btw）"。两者都打开面板并聚焦面板里的输入框（`openBtw`），带了问题的 `/btw` 直接开一个新话题；失败时 `sendDraft` 把原文放回草稿并提示。数据不走对话：omp 在 TSP 下把 `/btw` 画成 layer 里的 modal 弹窗，studio 读它的问答、不画它；同一组 IPC `askBtw` / `cancelBtw` / `getBtw`，话题 id 和历史读会话旁边的 `btw-history/`。面板停在输入框上方（`BtwPanel`，样式见 spec 4.14），问答用 Markdown 流式渲染；输入框默认对当前话题追问，"新话题"切到开新话题；Esc 在提问中取消、否则关闭（挂在面板自己的 `keydown` 上并 `stopPropagation`，不会触发输入框的"停止这一轮"）。提问完成后面板才切到返回的话题 id（`btw-actions.ts askBtwQuestion`），但**提问期间用户换了选择就不动它**：话题 id 要等磁盘记录落下来才回来（最多等约 1 秒），回答很快时用户已经点了"新话题"，晚到的 `selectBtwTopic` 会把它拽回刚问完的话题。IPC 收窄：只作用于已存在的任务；问题 1–`btwLimits.questionChars`（8192）字符，`recordId` 限长；话题 id 必须在主进程镜像里。在跑的旁路提问让任务不可回收。实测、事件序列、依赖的 omp 约定和限制见 [tsp-btw.md](tsp-btw.md)；录制 `fixtures/tsp/btw.jsonl`、`btw-error.jsonl`、`btw-stop.jsonl`。

## 目标模式（`/goal`，`features/goal/`）

`/goal <目标>` 创建目标（`goalSlash`，不发给模型）；`/goal` 不带文字用 toast 说出当前目标（或"当前没有目标"）；单独的 `pause` / `resume` / `drop` 操作当前目标；失败时 `sendDraft` 把原文放回草稿并提示。目标条上的按钮和命令面板的"暂停目标 / 继续目标 / 放弃目标"（只列当前状态下能做的，`goal-model.ts goalButtons`）走同一条路：`window.studio.taskGoal(taskId, op, objective?)` → `TaskPool.taskGoal` → `TspRunner.goal`：发 omp 的 `/goal pause|resume|drop|<文字>`（drop 要点掉 omp 的 "Drop goal?" 确认选择器）。数据 `TaskState.goal`（`TaskGoal`：id、objective、status、tokensUsed、tokenBudget、timeUsedSeconds）：状态从 omp 输入框卡片上的 `Goal …` 事实行读（`shared/tsp/goal.ts`），目标文字从会话文件的 `mode_change` 读（`shared/omp-output/goal.ts`）；只保留 `active` / `paused` / `budget-limited`，`complete` / `dropped` / 没有目标都是 `null`，目标条随之消失；完成时经 `TaskNotice{kind:"goal_complete"}` 弹一条 info toast（放弃不弹）。目标条 `GoalStrip` 挂在 `TspView` 顶部。IPC 收窄：`op` 必须是 `get | create | pause | resume | drop`；`create` 的目标文字 1–`limits.goalObjectiveMaxChars`（4096）字符。omp 拒绝时 reject，原文透传。`drop` 不中止正在跑的那一轮（omp 的语义，studio 不额外发 Esc）；停止一轮（Esc）会把进行中的目标暂停，要 `resume` 才继续（omp 18.12.2 实测）。实测和细节见 [tsp-migration.md](tsp-migration.md)「目标模式」，录制 `fixtures/tsp/goal-{pause-resume,drop,budget,flow}.jsonl`，测试 `test/tsp-goal.test.ts`、`test/goal-model.test.ts`。omp 的 `goal.continuationModes` 对 TSP 任务无关（交互式 omp 自己连续推进）。

## 会话树与分叉

语义、实测和任务模型上的取舍见 [session-tree.md](session-tree.md)。界面一侧：面板 `SessionTreePanel.tsx`（`session-tree-store.ts` 管开关）、动作 `fork-actions.ts`（`forkFromMessage` / `branchToNode`，分叉出的任务被选中、那条消息的文字追加进它的输入框）、omp 用户消息卡片上的回退图标被接管成打开面板。`/tree`、`/fork` 在 `studio-slash-table.ts`，命令面板 `cmd.sessionTree` 打开面板。

## 模式与状态区（`composer/ModeChip.tsx`、`ComposerNotes.tsx`、`session-toggles/ModeSection.tsx`）

实测：omp 18.12.6，2026-10-23，真实 omp + 临时 agent 目录，录制 `fixtures/tsp/composer-{modes,loop,retry,interrupted}.jsonl`；全部读法在纯函数 `shared/tsp/composer-facts.ts`（`test/tsp-composer-facts.test.ts` 逐帧验证）。

- **模式**：输入框卡片里 `omp.composer.fact` 的 `mode` 片段（按节点 id 最后一段认，不按文字，分支叫 "Vibe" 不会误判）。文字 `Plan` / `Plan (paused)` / `Prewalk` / `Goal …` / `Vibe` / `Loop[:] running|paused|next prompt repeats [3/5 | 2m left] [until|while: <命令前 33 字>]`；同一时刻只显示一种，优先级 Plan > Prewalk > Goal > Vibe > Loop。主进程记进 `TaskState.composerMode`（目标之外）和 `goal`，输入框卡片被弹窗换掉时沿用上一次的值。
- **开关**：`/plan` 是切换（开 → 退出到 `Plan (paused)` → 再发一次关闭；已有计划时 omp 先弹确认），`/loop` 开着时再发是关闭，`/vibe` 同理。TaskCommand `plan` / `planReview` / `vibe` / `loopStart` / `loopStop` → `TspRunner.runModeCommand`：发之前看当前模式（`modeCommandBlocker`），发出后等模式变成预期的样子或弹出确认 / 评审弹窗（`modeCommandDone`）；没变而 omp 给了 toast（"Exit goal mode first."）= 被拒，原文抛出。成功和被拒都有 toast，所以不靠 toast 判断。`/loop` 的条件命令用 shell 引号：无单引号包单引号，否则包双引号并转义 `\ " $ \``（实测 omp 解析出原命令）。Loop 暂停 = Esc（`stopTask`），继续 = 发下一条消息。Loop 开启只在无模式时给（模式显示优先级会盖住它）。
- **界面**：有模式时工具行出现模式胶囊（点开是当前模式的控件）；无模式时同一组开关在"会话开关"菜单底部。目标开着时 Plan / Vibe / Loop 禁用并说明。
- **扩展状态**：`hook-<N>` 片段（`ctx.ui.setStatus`，只有文字），`TaskState.extStatuses`，状态行右侧只读标签，悬停看全文。
- **速度**：`omp.composer.rate`（`p.value` tok/s，约 10 次/秒），只在 omp 设置 `composer.tokenRate` 开着时有（默认关）；有就用它（取整），没有退回会话文件里的值。
- **状态区**（dock → `omp.hud.status`）：自动重试 = `omp.working` 行，`meter style=ring` 的 value 1 → 0（每 0.5 秒一帧，总等待不在文档里，界面用第一帧和当前帧估秒数 `estimateRetrySeconds`），标签 `Retrying · attempt N of M`，取消 = `omp.working.stop` 的 `interrupt` 动作；压缩 = 同一行多一个无 value 的 `progress`，Stop 同一动作；上一轮停在工具调用中途 = `omp.hint.retry`（"F5 to retry"），界面显示"上一轮被中断 + 重试"（`/retry`）；空闲 loader 能取消的（文字以 `(… to cancel)` 结尾）发 Esc。
- **聚焦子代理**：`omp.composer.focus`，状态行上方横幅 + "回到主会话"（点 omp 的 `focus:Main` 动作），输入框占位符写明对象。
- 未实测（推测）：`/plan` 在已有计划时的退出确认弹窗、`/plan-review`、`omp.hint.retry` 在新一轮开始后何时消失。

## e2e

`test/e2e/tsp.e2e.ts`（`fake-tsp-omp` 回放 `task` / `approval` / `ask` 等录制，假 omp 只在收到和录制完全一致的事件后才继续）、`composer-draft.e2e.ts`、`file-preview.e2e.ts`、`clipboard.e2e.ts`、`session-tree.e2e.ts` 等，一个一个跑：`npx playwright test test/e2e/<名字>.e2e.ts`（先 `npm run build`）。
