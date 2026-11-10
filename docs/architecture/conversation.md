# 对话区、输入框和斜杠命令

所有任务都是 TSP：对话区的内容是 omp 发来的节点树，studio 只决定每种节点长什么样；输入框、侧栏、顶栏是 studio 自己的。协议、节点渲染、文档同步见 [tsp-migration.md](tsp-migration.md) §7–§10。文件：`src/renderer/src/features/{tsp,composer,conversation,dialogs,agents,goal,btw}/`、`src/renderer/src/markdown/`。数据从 store 取（`useTask`、`useTspNode` 等），写操作走 `window.studio.*`。omp 行为结论标了版本；标"推测"的没有实测。

## 对话区（`features/tsp/`）

- `TspView`：inline surface 的 `main` 在可滚动的对话区；`dock`（运行状态、提问 / 审批、排队）紧跟在对话后面：对话短时就在最后一项下面，长过视口时停在过程区底部、Composer 正上方（所有者定，2026-10-29）。dock 最多占满过程区，再高自己滚动，dock 里的 list 选中项变了时滚进视野（e2e `tsp.e2e.ts`"提问放不下时"）。`layer` 是盖在整块上的浮层容器（选择器、弹窗）；screen surface（如 `/settings`）盖住整个过程区。
- 用户消息、助手消息（`omp.assistant`，正文是 `md` 节点）、工具卡片、子代理卡片、待办、压缩分隔、用量脚注都是 omp 的节点，折叠 / 展开跟着节点的 `collapsed`（用户翻过之后以本地状态为准，见 `use-fold.ts`）。过程怎么展开 / 折叠由 omp 的节点决定，studio 不另外折叠，也不自己把对话流切成"轮"（所有者定，2026-10-22：没有"过程默认折叠"这条规则）。例外只有下面两条。
- **例外：eval 输出切成几段时合起来夹紧**（所有者问"输出过长时为什么不自动折叠"后定，2026-10-28）。实测 omp 18.13.1（`fixtures/tsp/eval-split-output.jsonl`）：eval 卡片的一个 cell 是 col `omp.run` = 代码 + 输出 + 底栏；打印较长的对象时（实测约 100 字的 Python tuple；omp 源码里 JS 一侧的门槛是 repr 超过 80 字或跨行，Python 一侧推测相同）omp 把它画成 JSON 视图（`tree`，没有 preview），前后的文字切成几段各自夹紧的 ansi（`omp.tool.eval.output`），没有总上限，折叠的卡片照样上千像素高。studio 在折叠时把代码和底栏之间这几段包进一个尾部夹紧的 `Clamp`，里面各段不再各自夹紧；只有一段（bash、普通 eval）或展开时照常。范围判断在 `shared/tsp/run-output.ts`（`test/tsp-run-output.test.ts`），渲染在 `nodes/layout.tsx` 的 `RunCol`，e2e `tsp.e2e.ts`"eval 输出被 JSON 视图切成几段"。
- **例外：连续的工具调用合成一组**（所有者批准，2026-11-09，issue #9 照 ompweb）。工具卡（`k:"tool"`）是 `main` 的直接子节点，和助手列交替出现（实录 omp 18.12.3 `task.jsonl`、`--resume` 重放 `resume.jsonl`）。
  - 切组（纯函数 `shared/tsp/tool-runs.ts`，录制测 `test/tsp-tool-runs.test.ts`）：两张及以上连着的工具卡成一组；夹在中间、不画正文的助手列（空的、只有思考块的）不打断，有正文的回答、用户消息之类的节点打断；子代理的等待卡（磁贴默认看得见，所有者定，2026-10-22）和提问卡（问答是对话内容）也打断、自己不进组。
  - 渲染：`MainFlow` 在组的第一张卡前插组头（`ToolRun.tsx`），收起时组员不画。组头和卡片都是 `main` 下的兄弟，不另包一层 DOM，所以组形成、变长时卡片不重挂载，挂在组员后面的状态行照常画。
  - **组头的内容**（所有者选，2026-11-10；`features/tsp/tool-run-head.ts`）：每种工具（按 omp 的工具名 `p.name`、第一次出现的顺序）一个图标 + 调用次数，种类太多时余下几种合成 `+N`（N 是它们的调用次数之和）；整组用时 = 各张卡 omp 报的 `p.took` 之和（写法同用量脚注；还在跑时只加已完成的，没有一张卡有 `took` 时不写——`resume` 录制和 read 卡都没有）；有失败时红字 `N failed`；文字在 `labels.ts`，不汉化。`N tool calls` 只做 `aria-label`。悬停每张卡一行 `<标题> <目标> · <用时>`，缺的部分不写；`took`、标题、目标变了组头也重画（`sameToolRuns`）。
  - 默认：组里有卡在跑，或这一组在对话末尾且任务在跑（还可能往里加卡）时展开，否则收起（有失败也收起，组头标红）。用户点过组头以本地为准，默认值变了就作废，同 `use-fold.ts`；记录按组里每张卡的 omp 调用 id（`p.key`）存，因为待办卡会被 omp 删了再加到后面，组的第一张卡会变。
  - Ctrl+O 只写给 omp；组跟着 omp 报的展开状态走，所以从终端面板、审批门"详情"按的 Ctrl+O 也同步，组和卡片不会错开。omp 每次切换都发状态行 "Tool output expansion: enabled / disabled"（omp 18.18.1 实测），文档在出现那一帧记进 `DocSurface.toolsExpanded`（之后同一个 toast 会被 Ctrl+T 的 "Thinking blocks: hidden / visible" 换掉文字，不能事后从状态行读；新进程从收起开始），展开着时全部组展开。真实 omp 18.18.2 实测（deepseek-v4-flash，两次 bash）：跑的时候组展开、空闲后收起；Ctrl+O 三次，组和卡片每次一致；重开会话后 omp 的工具输出回到收起、组也收起。录制 `fixtures/tsp/cards-expand.jsonl` 是 `cards.jsonl` 后面手接了两次 Ctrl+O 的回应（照 18.18.1 实测的样子）。
  - 设置 → 通用"连续的工具调用合成一组"（`groupToolCalls`，默认开）关掉就照 omp 一张张画。e2e `tsp.e2e.ts`"连续的工具调用合成一组"。
- 过程区里 studio 自己加的文字不汉化，集中在 `features/tsp/labels.ts`（所有者定，2026-10-21）。
- 文件链接（工具卡片上的路径、`file://` 的 `href`，以及回答 Markdown 里的 `[文字](file:///…)` 和相对路径链接）点开在右侧预览（`openHref` → `openFilePreview`），Esc 关闭、焦点回到链接；e2e `test/e2e/file-preview.e2e.ts`。Markdown 默认的 `validateLink` 挡 `file:`，`markdown/parse.ts` 单独放行，只有传了 `openFile` 的 `Markdown`（`nodes/text.tsx` 的 `Md`）才画成链接。

### 滚动（`conversation/use-stick-to-bottom.ts`）

- 离底不远即视为吸底；吸底时内容增长在 `ResizeObserver` 回调里直接 `scrollTop = 底`：回调在排版之后、绘制之前，这一帧画出来就在底部。留到下一个 rAF 再设会先在底边下面画一帧再跳上来，新消息看着"闪一下"（`tsp.e2e.ts`"流式吸底"）。
- 用户主动上滚（wheel 向上、PageUp/Home/↑、scrollTop 减小且不是程序设置的）立即脱离；脱离后有新内容显示"回到最新"。End 回底。"scrollTop 减小"只在可滚范围（`scrollHeight - clientHeight`）和上次滚动事件时一样、或按着鼠标 / 触摸时才算：scroll 事件晚一帧派发，omp 先收起上方的块（浏览器把 `scrollTop` 夹小）、同一帧又长出新内容时，读到的也是"scrollTop 变小、离底很远"，那是布局变化，不是用户上滚（慢机器上会让吸底停在半截；用 CDP `Emulation.setCPUThrottlingRate` 降速可复现）。
- 输入框发送 → `scroll-bus.requestStickToBottom` 强制吸底。
- 切任务记各自的 scrollTop 和吸底状态（内存）。
- 阅读锚点：脱离吸底时每次滚动记录视口顶部下方第一个 `[data-anchor]` 块和偏移（只看最外层的块：缓存列表，对话列直接子元素增删时作废，按底边二分，每次滚动只读 O(log n) 个矩形）；内容尺寸变化（列宽变化、锚点上方的块变高变矮）后让锚点块回到原偏移，底下长出新内容才提示"回到最新"；点击 `[data-anchor]` 内的按钮（展开/折叠）以该块为锚补偿，补偿后重记阅读锚点。
- TSP 的对话区关掉浏览器的滚动锚定（`overflow-anchor: none`）：omp 一直在改写视口上方的节点，锚定会把 `scrollTop` 往上推，被误认成用户上滚（[tsp-migration.md](tsp-migration.md) §8）。脱离吸底时由上一条的阅读锚点补偿代替。
- inline 对话区的顶层块（`.tsp-column > [data-anchor]`，用户消息除外）用 `content-visibility: auto`：离屏块不排版、不绘制；没画过的块按估计高度占位，滚到附近换成实际高度，差值由阅读锚点补偿。块自带 paint 包含：后代画到块外会被裁掉、点击也落不到，节点里不能放超出块边界的弹层（菜单、放大图在 `TspHosts` / `layer` 里）。用户消息不加：气泡上方的悬停按钮行和悬停桥（`bottom: 100%`）在块外，加了就点不到回退、复制按钮（`overflow-clip-margin` 不管用）。
- 覆盖式滚动条 `src/renderer/src/ui/OverlayScrollbar.tsx`：宿主 `position: relative`，滚动容器隐藏原生条，组件作为兄弟节点。hover 宿主或滚动时出现（指针还在宿主上不自动隐藏），拖滑块滚动，点轨道翻约一页，深浅随主题。对话区、侧栏任务列表、命令面板列表共用。
- 对话线 `features/tsp/ConversationLine.tsx`（spec §4.15）：用户消息从 TSP 文档取（`shared/tsp/user-messages.ts` 的 `userMessages`，main 里 `card role=omp.user`，id 是卡片的节点 id），页面里按 `[data-id]` 找卡片（消息列表变了才重找，元素被换掉时补找）。点刻度直接改 `scrollTop`（不走 `scrollIntoView`，免得连带滚外层），上滚就按"用户主动上滚"脱离吸底；之后短时间内对话列尺寸一变（落点附近的块从估计高度换成实际高度）就把落点放回原处，用户滚轮 / 按下 / 按键即停。当前刻度在滚动和尺寸变化时每帧至多算一次，按卡片顶边二分。omp 压缩后只留压缩点之后的消息（`omp.compaction` 之前的 `omp.user` 不再发），所以对话线也只有这些。

## Markdown（`markdown/`）

`md` 节点的 `p.text` 是 markdown 原文，由这里渲染（`features/tsp/nodes/text.tsx`），子代理面板、旁路提问、文件预览、omp 更新日志也用它。

- `parse.ts`：markdown-it（`html:false`）整篇解析后切成顶层块；任务列表标记在这里摘掉。linkify 只认写全的 `http(s)://` 网址（模型常输出裸网址）：不猜 `example.com`、邮箱、IP，去掉 `ftp:` / `mailto:` / `//`；句末的中文句号等标点不算网址。`stabilizeStreaming` 在流式时先藏起行首为 `| # > - * 1.` 或围栏的未完成行，表头要等分隔行到了才放出（spec 5.4 第 2 条）。未闭合的行内标记 markdown-it 本来就当纯文本。
- 流式增量解析（`parseStreaming`）：流式时复用上一次的块（同一个对象），只从最后一个"前一行是空行、且新旧原文到这一行为止相同"的顶层块重解析到末尾；结果与整篇解析逐字段相同（`test/markdown.test.ts` 逐前缀比对）。原文里有 `]:`（可能是链接引用定义，后定义前使用）或 `\r` 时整篇重解析。流式结束（`streaming=false`）整篇解析一次。为什么：每批整篇重解析太慢（实测 20KB 回答按 30 字一批：解析总耗时 ~750ms，增量 ~29ms）。
- `render.ts`：token → `createElement`，无 JSX、无 DOM，可在 Node 里测试；**不用 dangerouslySetInnerHTML**（唯一例外是 KaTeX 的输出）。原始 HTML 作为文本转义；链接只放行 `http/https`（与主进程 openExternal 一致，mailto 只显示文字）（markdown-it 的 `validateLink` 先挡掉 `javascript:`/`vbscript:`/`file:`/`data:`，实体编码也在它之前解码），其余相对路径只显示文字；图片只放行 `data:image/*`，远程图片显示成链接。点击经 `window.studio.openExternal`。KaTeX 由调用方经 `RenderContext.katex` 传入，没有时公式按原文放在 `<code>` 里。
- 有序列表的序号是 `li` 里的真文字（`.md-ol-n`，看起来和原生 `::marker` 一样）：Chromium 复制选中文字（选中即复制、Ctrl+C）时不带 `::marker`，用原生序号复制出来没有"1. 2."（Electron 44 实测）。无序列表的圆点照旧用 `::marker`，复制时不带。
- `Markdown.tsx`：每个顶层块 `React.memo`，按块原文比较——已闭合块不重建 DOM，只有最后一块在变。KaTeX（JS + CSS）按需加载：第一次出现公式 token（块的 `math` 标记）才 `import()`，加载完只重画含公式的块。块的 token（约是原文的 5–10 倍，估算）画完就在 `useEffect` 里放掉，块只留原文、`closed`、`math` 和整篇的链接引用定义；少数要重画的块（切语言、KaTeX 加载完）由 `parse.ts` 的 `blockTokens` 按原文带上引用定义重解析。流式增量解析只看块原文和块首位置，不受影响。
- `highlight.ts`：Shiki `shiki/core` + JS 正则引擎 + CSS 变量主题，语言包按需 `import()`。
  - 语言名和别名在 `highlight-languages.ts`（没有 `import()`，主线程引用它）；`import()` 表在 `highlight-loaders.ts`，只有 worker 引用——主线程碰到它，每个语言包会再打出一份没人加载的 chunk。
  - 分词在 Web Worker 里（`highlight-worker.ts`，ES 模块 worker，`electron.vite.config.ts` 的 `worker.format: "es"`，iife 不能拆语言包）：同步分词几百行要 100ms 以上，放主线程会在打开任务后卡住滚动和动画。worker 闲置一段时间就关掉（Shiki 和加载过的语言包都在它里面），下次要高亮时重建，重新加载语言包期间显示纯文本。
  - 主线程有按估算大小限额的 LRU 结果缓存和请求队列：同一段代码并发请求只算一次；worker 里同时只放少数请求，其余在主线程排队，排队时调用方全卸载了（滚过去、折叠、切任务）就丢掉不算；worker 起不来时请求失败、调用方显示纯文本，下次重建。
  - 组件统一用 `useHighlighted(code, lang)`（`lang` 传 `null` = 不高亮，如围栏没闭合），代码块、过程区、评审 diff 共用。代码变了、新结果没到时先用 `highlight-tokens.ts` 的 `carryHighlight` 顶着：和上一次相同的行照旧着色，那一行后面追加的字和新行无色，文字总是新代码的原文——omp 往 eval / 写文件卡片的代码节点里流式追加文字时，已着色的字不会每追加一次就闪回无色（e2e `tsp.e2e.ts` "流式追加的代码节点"、`test/highlight-carry.test.ts`）。
  - `tokens.css` 的 `:root` 把 `--shiki-*` 映射到 `--syn-*`（全应用一份），深浅主题不重新高亮；token 的 span 用 `highlight-tokens.ts` 的 `tokenProps` 拿类名（每种颜色一个 `.hl-*` 类，斜体、粗体各一个），认不出的颜色才写内联 style（`test/highlight.test.ts` 核对主题里的颜色都有规则）。
  - Markdown 源码先加载围栏代码块用到的语言，块里的代码才着色。围栏闭合后才高亮。代码块全文显示，不折叠（spec §4.10）。
- `svg-figure.ts`：```` ```svg ```` 围栏闭合后画成图（`CodeBlock.tsx`）。omp 的做法（读 v18.12.6 源码，推测，未在 studio 里实测）：交互式会话的系统提示让模型把版式、示意图画成 ```` ```svg ````，只许用 `currentColor` 和一组主题 CSS 变量（`prompts/system/system-prompt.md` 的 `renderSvg` 段，开关 `tui.renderSvg` 默认开；studio 的 TSP 任务跑的是交互式 omp，所以这段提示在），TUI 用 `tui/src/chat/svg-source.ts` 把这些变量换成终端主题色再栅格化。studio 照样替换：变量（含带默认值的写法）和 `currentColor` 换成 `FIGURE_TOKENS` 对应的实际颜色（切主题经 `ui/theme-change.ts` 重画），补 `xmlns`，转成 `data:` URL 给 `<img>`——不执行脚本、不加载外部资源、不碰页面 DOM。`test/svg-figure.test.ts`。
- `mermaid.ts` / `mermaid-worker.ts`：```` ```mermaid ```` 围栏闭合后画成图（`CodeBlock.tsx`，spec §4.10）。omp 的做法（读 GitHub main 的源码，2026-10-27）：`tui.renderMermaid` 默认开，系统提示让模型用 mermaid 画流程、时序、状态、依赖；TUI 用 pi-natives 的 `renderMermaidAscii` 画成字符图，只认 flowchart、state、sequence、class、ER、xychart。TSP 的 md 节点只带原文，studio 拿不到 omp 画好的图，所以自己画：`beautiful-mermaid`（同样六种）在 worker 里把源码画成 SVG 字符串，主线程按源码缓存、同一段源码同时只算一次；worker 闲置就关掉（库很大），下次要画时重建；`svg-figure.ts` 的 `prepareMermaidSvg` 把根标签的 `--bg` / `--fg` 换成当前主题色（其余颜色由这两个 `color-mix` 出来）、去掉 Google Fonts `@import`，交给和 svg 图同一个 `<img>`。放 worker 的原因：第一张图要初始化 elkjs，主线程上约 90ms，40 个节点的图约 50ms（Node 实测）。worker 里要先放一个空 `document`、把 `self` 换成可写的自有属性再加载库：elkjs 看到"没有 document、有 self"会把自己当成布局 worker 脚本、不导出同线程的 FakeWorker，beautiful-mermaid 绕开它的办法（删 `self` 再写回）在 worker 里行不通（Electron 44 实测报 `o is not a constructor` / `Cannot set property self`）。e2e：`test/e2e/file-preview.e2e.ts` 的 mermaid 用例。
- `code-quote.ts`：代码块的"引用到输入框"（所有者批准，2026-11-09）。`CodeQuoteCtx` 只由 `TspView` 提供（`composer/insert-into-draft.ts` 的 `quoteCodeIntoDraft`），所以按钮只出现在任务对话区；文件预览、设置页、子代理面板、旁路提问等地方没有提供者，`CodeBlock` 不画它。点了 = 带语言的围栏代码块（代码里有 ```` ``` ```` 时围栏多一个反引号）经 `appendToDraft` 接在草稿末尾，光标放到末尾，焦点给输入框；只在围栏闭合后出现。e2e `tsp.e2e.ts`「回答里代码块的引用按钮」。
- `code-preview.ts`：代码块的"在侧栏预览"（所有者批准，2026-11-10；spec §4.10、§4.27"代码片段"）。和引用一样，`CodePreviewCtx` 只由 `TspView` 提供（`file-preview` 的 `openSnippetPreview(taskId, kind, code)`），面板的键就是任务 id；别处没有提供者 = 没有面板可开，不画按钮。`previewKind` 认 html / svg / mermaid / markdown 及别名，围栏闭合后才出现。片段只在渲染进程内存里（`PanelState.snippet`，`id` 用自增序号，不用内容长度之类会撞的值），`file-preview/snippet.ts` 把它换成 `PreviewFile`，`PreviewPage` / `PreviewContent` 按文件的同一条路画；mermaid 交给 `CodeBlock`（`view` 由预览页的 `渲染 / 源码` 控制）。片段本身不另加 IPC。`test/code-snippet-preview.test.ts`，e2e `file-preview.e2e.ts`「回答里 html / svg / markdown 代码块在侧栏预览」。HTML 片段和 HTML 文件一样在独立的沙箱源里加载，见 `security.md`「文件预览的网页」。
- `test/markdown.test.ts`：原始 HTML 转义、危险协议被拒、流式逐段喂入时已闭合块原文不变、放掉 token 后重画的块与原来逐字相同。
- 把第三方库放进 Web Worker 前，先在打包后的应用里真的让 worker 跑一次（e2e 或探针看结果），Node 里跑通不算：库会按 `typeof self` / `typeof document` 猜自己在哪，Node 没有 `self`，worker 有 `self` 没 `document`，走的分支不一样（mermaid 的 elkjs 踩过，`file-preview.e2e.ts` 的 mermaid 用例守着）。

## 输入框（`composer/`）

输入框是 studio 自己的 `<textarea>`（omp 的输入框节点 `omp.editor` 不画），发送 / 编辑经 TSP 事件或按键写给 omp（[tsp-migration.md](tsp-migration.md) §8「输入」、§10.4）。

- 按键判定是纯函数 `send-logic.ts decideEnter`（`test/composer-keys.test.ts`）：IME 组合态（`isComposing` 或 `keyCode 229`）Enter 不发送；Enter / Ctrl+Enter 发送；运行中 Enter 默认 `send`（插话，omp 自己排队 / steer），Ctrl+Enter（或发送键旁下拉的"等这一轮结束再发"）= `whenBusy: "followUp"`，主进程发 omp 的 `/queue <文字>`（见 [composer-input.md](composer-input.md) §3）；有审批在等时 Enter = 拒绝并发送，Ctrl+Enter = 批准，Ctrl+O = Details（见 [dialogs.md](dialogs.md)）。提问在等、全屏面板（含 Agent Hub）开着时不能发送，输入框给出提示。
- Esc：没人消耗（`defaultPrevented`）且任务在运行时 `stopTask`：主进程把 Esc 交给 omp 停下这一轮；排队消息（`omp.queue` 节点，`shared/tsp/queue-restore.ts`）被 omp 写回它自己的输入框，由主进程读出来返回（读法和清空见 [composer-input.md](composer-input.md) §5），按原文追加回草稿（图片作附件）。toast 由纯函数 `stop-outcome.ts stopToasts` 决定：只有这一轮确实停下才说"已停止"（有排队消息则带条数），没停下只报 `stopFailed`；用户按过停止的那一轮 `lastTurn` 记为 `aborted`。
- 模型 / 思考胶囊（`ModelChip`）：`listTaskModels` → 分组、搜索、最近几个；模型行右侧是紧凑的"上下文窗口 · 输入/输出价格"（`model-groups.ts`，价格全 0 不显示）。切换是给 omp 的节点发事件（[tsp-migration.md](tsp-migration.md) §10.3），不往输入框塞文字。
  - 思考档位只有一份列表（`thinking-levels.ts thinkingLevelOptions`），picker 分段条、方向键、Alt T 共用：任务里是主进程按 omp 输入框卡片算的 `TaskState.thinkingLevels`（含 `auto`、`off`；切档位时转满一圈还没遇到目标，就把这一圈看到的档位记成这个模型的列表，界面跟着改正），草稿里没有进程，用 `auto` 加 `get_available_models` 里的 `thinking.efforts`（不含 `off`）。
  - `auto`（omp 每轮按模型自选，胶囊显示 Auto；issue #9）：新任务带 `--thinking auto` 起进程，任务里经 omp 自己的 ⇧⇥ 循环切到它。
  - omp 会把设置的档位钳到模型支持的档位（实测 omp 18.12.2、`deepseek-v4-flash`、efforts `low/high/max`：minimal→low、medium→low、xhigh→high、auto→high；`off` 保留），草稿胶囊用同一规则（`clampThinkingLevel`：取最近的，一样近取较低）显示 omp 会采用的档位，所以草稿和发送后的任务显示一致。不支持思考的模型没有档位。
  - Alt M / Alt T、命令面板的 `model` / `thinking` 命令。
- 审批胶囊（`ApprovalChip`）：读写 omp 的 `tools.approvalMode`，没有进程的任务（`stopped` / `error`）可改，其余只读；首次选 yolo 内联确认一次（localStorage 记住）。详见 [omp-settings.md](omp-settings.md)「审批模式」。
- 工具行右侧的用量：上下文圆环（点开是构成，见下面「上下文构成」）、费用（`SessionCost`）；输出速度在圆环浮层左栏的本会话用量里（`ModelBreakdown`：运行中用 omp 输入框卡片的实时速度，否则是会话文件里最近一条回复的 output ÷ (duration − ttft)）。数据来源见 [task-model.md](task-model.md)「输入框上的状态从哪来」。上下文快满时圆环变琥珀。
- 贴图、粘贴、拖入文件：见 [composer-attachments.md](composer-attachments.md)。图片走 omp 自己的图片附件：`sendPrompt` 把图片写成临时文件，在 omp 的输入框里填字、括号粘贴路径、`action submit`（composer-attachments.md「发图片」）。粘贴的非图片文件不走图片流程：preload 在隔离世界里取路径（`src/preload/index.ts`，spec §4.14）。
- 输入框三个辅助：①斜杠守卫（`slash-guard.ts`）：`/名称` 不在命令表（omp 的 `get_available_commands` + TUI 才有的命令 + studio 接管的命令，非空时）里就先提示一次，同一文字再发或点"仍作为文字发送"才发。②输入历史：studio 自己按项目持久化，↑ 翻看、Ctrl+R 搜索（`input-history.ts`、`history-store.ts`）。③`@` 文件补全（`file-complete.ts` + `use-file-menu.ts` + `FileMenu.tsx`）：IPC `listProjectFiles(target, query)`，主进程 `files/project-files.ts` 按 cwd 短时缓存有上限的索引（git ls-files，退回有界遍历），返回少量相对路径；`query` 含绝对路径 / `..` 拒绝；发给 omp 后由 omp 展开 `@路径`。命令表、参数接管、发送方式、历史、omp 输入框回填的细节见 [composer-input.md](composer-input.md)。
- **草稿持久化**：`getDrafts` / `saveDraft`（`draft-handlers.ts` → `userData/drafts.json`，串行写、先写临时文件再改名；条数和每条长度有上限）。渲染进程防抖保存，启动读回（读回之前已经打过字的 key 不覆盖）。只存文字，图片不存。`flushDrafts()` 在 `pagehide` / `beforeunload` / 页面隐藏时把防抖中的草稿立刻发给主进程（e2e `composer-draft.e2e.ts`：fill 后立刻 reload，drafts.json 里有内容）。
- **`!` / `$` 开头的文字**原样发给 omp，由 omp 在对话里画结果：`!echo x` 当 bash 执行（节点 `omp.bash` / `omp.tool.bash.*`），`$ print(1)` 当 eval 执行（`omp.eval`）（omp 18.12.5 实测，[tsp-real-omp-probes.md](tsp-real-omp-probes.md) §3）。`!!` 是否进模型上下文由 omp 决定，没有逐项核对。studio 没有自己的"运行命令"通道。
- 焦点：选中任务后聚焦输入框只在 `App.tsx` 一处，同步执行；焦点在侧栏内时不抢；侧栏里 Enter 选中任务后进输入框由 Sidebar 在 Enter 处理里聚焦 `[data-composer-input]`。

### 键盘

输入框 Enter / Ctrl+Enter / Esc / Alt M / Alt T / ↑↓（输入历史）；审批 Enter / Ctrl+Enter / Ctrl+O / Esc；提问对话框和选择器见 [tsp-migration.md](tsp-migration.md) §10.6；弹层 ↑↓ / Enter / ←→ / Esc，Esc 关闭后焦点回触发器。作用在当前任务对话上的两个全局键：**Ctrl Shift C** 复制最后一条回答，**Ctrl O** 展开或收起所有工具卡片（`features/tsp/use-task-commands.ts`，命令面板里是同名命令 `copyLast` / `toggleProcess`）：

- `copyLast`：`shared/tsp/last-answer.ts` 的 `lastAnswerText` 从 TSP 文档取最后一条有正文的助手消息的 markdown 原文（`omp.assistant` 容器里不带 role 的 `md` 节点；工具卡片、思考块、错误卡里的不算），写进剪贴板并 toast；没有回答时提示 `cmd.copyLastEmpty`。测试 `test/tsp-last-answer.test.ts`。
- `toggleProcess`：把 Ctrl+O（`\x0f`，omp 的 `app.tools.expand`）写给 omp。**omp 18.12.5 实测**：一次 Ctrl+O 把 `omp.tool.bash` 卡片的 `collapsed` 从 `true` 变成 `false`，再按一次变回 `true`；思考块（`omp.thinking`）的 `collapsed` 不变。studio 的折叠状态跟着程序发来的 `collapsed` 走，所以不用自己改。输入框里的审批门用 Ctrl+O 当"Details"（Composer 先处理并 `preventDefault`，不会再触发展开）；焦点在终端面板里时不拦。

## 导出 HTML

- 入口三处，同一动作：输入框 `/export`（studio 接管的斜杠命令，盖住 omp 的同名命令）、命令面板 `cmd.exportHtml`、侧栏任务行菜单 `task.exportHtml`；动作在 `composer/export-html.ts`。`/share` 不动，仍是 omp 自己的命令。
- 路径由主进程定：IPC `exportTaskHtml(taskId)` 在主进程弹 `dialog.showSaveDialog`（默认桌面、文件名 `<任务标题清理后>-<本地日期>.html`，清理见 `tasks/export-name.ts`），`exportTarget` 保证扩展名是 `.html`（`.htm` 不算，补 `.html`），经 `TaskPool.exportTaskHtml` → `TspRunner.exportHtml(outputPath)`。渲染进程不传任何路径；取消对话框 = 返回 `null`，什么也不发生。
- 后端：对会话文件跑 `omp --export <会话文件> <输出路径>`（主进程 `omp/export-session.ts`，`PoolDeps.exportSession`，`runtime.ts` 接上）。实测（omp 18.12.5）：第二个位置参数就是输出路径，绝对路径（含中文、空格、不存在的上级目录）原样照写、不补扩展名；不带输出路径时写成当前目录下的 `omp-session-<文件名>.html`（会弄脏项目目录，所以总是传路径）；会话文件不存在时退出码 1，stderr 是 `Error: File not found: …`。任务还没有会话文件（没发过消息）时拒绝（`this task has no session file yet`）。任务运行中也能导出（读的是磁盘上已写的部分）。
- 成功后 toast `toast.exported` + `toast.revealExport`；按钮调 `revealTaskExport(taskId)`，主进程只显示**它自己选的、该任务最近一次导出的路径**（`tasks/export-record.ts`：记下的是 target，且要求返回的路径解析后与 target 一致，否则不记录；任务归档 / 移除时清掉记录），没导出过就拒绝。
- 测试：`test/export-name.test.ts`、`test/export-record.test.ts`、`test/task-tsp.test.ts` "导出" 两条。

## 上下文构成

点圆环弹出的构成照抄 omp `/context` 的数字：studio 自己按会话文件估算和 omp 对不上，也不随对话刷新。

- 怎么读：`TspRunner.readContext()`（`shared/tsp/context-report.ts` 解析）。主进程向 omp 输入框卡片上的 meter（role `omp.composer.context`）发 `action`（`actions.click` = `status.context`），等报告出现，读完再向报告里 role `omp.btn` 的 Close 发它自己的 `action` 关掉。**不用 Esc 关**：运行中 Esc 会打断这一轮。渲染进程读的期间 `beginTspDrive(taskId, { kind: "context" })`，`TspView` 不画 layer，omp 的弹窗不会闪出来。
- 实测 omp 18.12.6（录制 `fixtures/tsp/context-report.jsonl`）：
  - 报告是 layer 里一个 modal overlay，role `omp.overlay.report`，正文 role `omp.context`；`omp.context.cats` 下每类一行 role `omp.context.cat`，节点 id 末段是类别 id（`systemPrompt` / `systemTools` / … / `messages`），然后是 `omp.context.cat.free`、有预留时 `omp.context.cat.buffer`。
  - 每行的 `title` 是 `<名称> · <token 数，千分位> tokens`，是精确值（行里画的是 `3K` 这样的缩写）。各类之和 + 剩余 + 预留 = 窗口。
  - **运行中也能读**：一轮 bash 工具调用进行中点 meter，omp 当场弹出报告，Close 关掉后这一轮照常跑完（没有 "Stopped"）。空闲时 omp 在收到点击后几毫秒画出报告。
  - omp 没在运行、输入框被提问 / 审批换掉时读不到（`TSP_COMPOSER_UNAVAILABLE`），界面显示 `composer.context.unavailable`。
- 实测 omp 18.13.2（`deepseek/deepseek-v4-flash`；录制 `fixtures/tsp/context-report-18.13.jsonl`）：报告换了写法，没有 `omp.context.cats`。两种都认：
  - 正文 `omp.context` 下一个 id 以 `/categories` 结尾的 `list`，每类一个 `item`：id 末段是连字符写法（如 `system-prompt`、`built-in-tools`，最后 `buffer`、`free`），studio 换成驼峰当 key（`builtInTools`），界面按 key 起名、上色。
  - item 的 `label` 是 `[色块 "■ ", 名称]`，`value` 是 `3.1K · 0.3%` 这样的缩写，没有精确数（omp 自己也只显示缩写）。已用取 role `omp.context.used` 的第一段，窗口 = 已用 + 预留 + 剩余。
  - Close 照旧是报告里 role `omp.btn` 的按钮（`actions.click` = `close`）。
- 新任务草稿没有 omp 进程：已用 0，只画剩余空间和按压缩设置算的自动压缩预留（`composer/context-rows.ts`）。

## 压缩上下文

命令面板"压缩 context"（`cmd.compact`）→ `window.studio.compactTask(taskId)` → `TaskPool.compactTask` → `TspRunner.compact()`：发 `/compact`，等 omp 画出压缩分隔（成功）或 "Error: Compaction failed: …"（失败，原文作为错误抛出），有超时；没有进程时先拉起。omp 18.12.5 实测见 [tsp-migration.md](tsp-migration.md) §10.6「`/compact` 的结局」。输入框里直接输入 `/compact` 是 omp 自己的命令，同样会压缩（没有等待结果的封装）。

上下文浮层的"压缩"一栏（`ContextCompact`，实测见 [todo-board.md](todo-board.md)）有"立即压缩"（`TaskCommand` `compact`）和"交接"（`TaskCommand` `handoff` → `TspRunner.handoff`，`/handoff`，判定同 `/compact`：新增 `omp.compaction` 分隔 = 成功，`Error: Handoff failed` / `Compaction failed` = 失败）。自动压缩触发点、预生成摘要起点和摘要状态读输入框卡片上 `omp.composer.context` 的 `marks` 和标题（`shared/tsp/context-compaction.ts` → `TaskState.contextCompaction`），是 omp 算好的生效值；圆环上画一道刻度。omp 没给的（自动压缩关着、摘要没在生成）不显示。

## 斜杠菜单和 studio 接管的命令

- 命令列表：`useSlashCommands(taskId)`（`listSlashCommands`，服务进程的 `get_available_commands`，和任务进程无关）；草稿页是 `useDraftSlashCommands()`（`listSlashCommands(null)`，同一份，`composer/use-draft-slash.ts` 管菜单和按键）。加载规则在纯函数 `palette/slash-cache.ts`：每个键同时只有一个请求，**空数组和失败都不记为"已取过"**（否则新建任务里菜单永远不出现），任务状态变化（起进程完成）时会再取，拿到非空才停。草稿是 `/名字`（没有空格）时按名字、别名过滤（前缀优先）。↑↓ 选，Tab 补全，Enter 补全（草稿已是完整命令名时发送），Esc 关闭。命令面板的 `onComposerText` 把文本放进草稿并聚焦；`DraftComposer` 挂载时取 `takePendingDraftText()`。
- **studio 接管的命令**（桌面优先：能在 studio 自己界面里做的，输入同名命令就开 studio 的界面，不触发 omp 的终端弹窗）：唯一的表是 `composer/studio-slash-table.ts`（清单看表和它开头的 import），每条有名字、别名、说明和 `run`；写了 `draft` 的在新任务草稿页也能用（不创建任务）。判定在 `studio-slash.ts` 的 `handledCommands` / `withStudioSlash`（纯函数），输入框 `sendDraft`、命令面板的 `/` 行、草稿页 `send` 用同一份；同名时 studio 的优先，omp 列表里的同名项从菜单里去掉。表里的命令不发给 omp，处理函数自己报错，抛错时草稿放回输入框。两个例子：`/rename` 不带名字时侧栏里该任务行就地改名（侧栏收起会展开）；`/delete` 是可撤销的归档（`archiveWithUndo`）。不在表里的 `/命令` 原样发给 omp，由它在过程区里画界面（弹窗、选择器等）。
- 测试：`test/studio-slash.test.ts`、`test/slash-cache.test.ts`、`test/composer-assist.test.ts`、`test/toggle-slash.test.ts`。

## 待办板

数据 `TaskState.todoPhases`（主进程从 dock 里 `omp.hud.todo` 的 checklist 换算，见 [tsp-migration.md](tsp-migration.md) §7「待办」）。没有任何待办项时不渲染。位置：输入框上方状态行的右端（`ComposerTop` → `TodoBoard.tsx`，`todo-model.ts`）；omp 自己的待办药丸不画。

- 按钮照 Tern 里的 omp（omp 18.12.6 在隔离的 Tern 里从列出计划跑到全部完成逐帧截图）：进度环（弧长正好是 完成/总数，0 是 12 点钟一个圆点，进行中的那项不算半格）+ 当前项（第一个进行中，否则第一个未开始；全部完成时写"全部完成"）+ `{done}/{total}`；`abandoned` 不计入 total。
- 全部完成后 omp 过 `tasks.todoClearDelay` 秒自己删掉 HUD 节点（omp 源码 `interactive-mode.ts` 的 `#syncTodoHudState`；Tern 里"All done 8/8"停十几秒后消失），`todoPhases` 变空，按钮跟着消失。
- 点击展开，Esc 或点外面收起。列表按阶段分组：`pending` 空圈、`in_progress` 细弧（任务在跑时转动，reduced-motion 下停住）、`completed` 对勾、`blocked` 红色 + 感叹号 + blocker 原因、`abandoned` 删除线。状态词另有 sr-only 文本。
- 编辑（细节和 omp 18.12.6 实测见 [todo-board.md](todo-board.md)）：条目下面显示备注（HUD 的 `note`，`TodoItem.notes`；受阻的是 blocker）；每条右边有 ⋯ 菜单（开始 / 完成 / 放弃 / 删除，菜单内嵌在浮层里：浮动 `Menu` 渲染在 body 上会被 `Popover` 当成点外面而关掉板），经 `TaskCommand` `todo` 变成 `/todo start|done|drop|rm <内容>`，成功读 omp 的 toast、失败读新增的 `Error:` 行（`TspRunner.runTodoCommand`）；板底有"添加条目"（`/todo append "<阶段>" "<任务>"`，阶段可选）、"复制为 Markdown"（本地拼，和 omp `/todo` 同文，`todoMarkdown`）、"展开全部"（已做完的阶段默认收起，同 omp HUD，只改界面不发命令）。重名条目只能操作第一个。

## 旁路提问（`/btw`，`features/btw/`）

入口：`/btw [问题]`（`btwSlash`，不发给模型）和命令面板"旁路提问（/btw）"。两者都打开面板并聚焦面板里的输入框（`openBtw`），带了问题的 `/btw` 直接开一个新话题；失败时 `sendDraft` 把原文放回草稿并提示。数据不走对话：omp 在 TSP 下把 `/btw` 画成 layer 里的 modal 弹窗，studio 读它的问答、不画它；同一组 IPC `askBtw` / `cancelBtw` / `getBtw`，话题 id 和历史读会话旁边的 `btw-history/`。面板停在输入框上方（`BtwPanel`，样式见 spec 4.14），问答用 Markdown 流式渲染；输入框默认对当前话题追问，"新话题"切到开新话题；Esc 在提问中取消、否则关闭（挂在面板自己的 `keydown` 上并 `stopPropagation`，不会触发输入框的"停止这一轮"）。提问完成后面板才切到返回的话题 id（`btw-actions.ts askBtwQuestion`），但**提问期间用户换了选择就不动它**：话题 id 要等磁盘记录落下来才回来（最多约 1 秒），回答很快时用户已经点了"新话题"，晚到的 `selectBtwTopic` 会把它拽回刚问完的话题。IPC 收窄：只作用于已存在的任务；问题长度限 `btwLimits.questionChars`，`recordId` 限长；话题 id 必须在主进程镜像里。在跑的旁路提问让任务不可回收。实测、事件序列、依赖的 omp 约定和限制见 [tsp-btw.md](tsp-btw.md)；录制 `fixtures/tsp/btw.jsonl`、`btw-error.jsonl`、`btw-stop.jsonl`。

## 目标模式（`/goal`，`features/goal/`）

`/goal <目标>` 创建目标（`goalSlash`，不发给模型）；`/goal` 不带文字用 toast 说出当前目标（或"当前没有目标"）；单独的 `pause` / `resume` / `drop` 操作当前目标；失败时 `sendDraft` 把原文放回草稿并提示。目标条上的按钮和命令面板的"暂停目标 / 继续目标 / 放弃目标"（只列当前状态下能做的，`goal-model.ts goalButtons`）走同一条路：`window.studio.taskGoal(taskId, op, objective?)` → `TaskPool.taskGoal` → `TspRunner.goal`：发 omp 的 `/goal pause|resume|drop|<文字>`（drop 要点掉 omp 的 "Drop goal?" 确认选择器）。

- 数据 `TaskState.goal`（`TaskGoal`）：状态从 omp 输入框卡片上的 `Goal …` 事实行读（`shared/tsp/goal.ts`），目标文字从会话文件的 `mode_change` 读（`shared/omp-output/goal.ts`）；只保留 `active` / `paused` / `budget-limited`，`complete` / `dropped` / 没有目标都是 `null`，目标条随之消失；完成时经 `TaskNotice{kind:"goal_complete"}` 弹一条 info toast（放弃不弹）。目标条 `GoalStrip` 挂在 `TspView` 顶部。
- IPC 收窄：`op` 必须是 `get | create | pause | resume | drop`；`create` 的目标文字长度限 `limits.goalObjectiveMaxChars`。omp 拒绝时 reject，原文透传。
- `drop` 不中止正在跑的那一轮（omp 的语义，studio 不额外发 Esc）；停止一轮（Esc）会把进行中的目标暂停，要 `resume` 才继续（omp 18.12.2 实测）。omp 的 `goal.continuationModes` 对 TSP 任务无关（交互式 omp 自己连续推进）。
- 实测和细节见 [tsp-migration.md](tsp-migration.md)「目标模式」，录制 `fixtures/tsp/goal-{pause-resume,drop,budget,flow}.jsonl`，测试 `test/tsp-goal.test.ts`、`test/goal-model.test.ts`。

## 会话树与分叉

语义、实测和任务模型上的取舍见 [session-tree.md](session-tree.md)。界面一侧：面板 `SessionTreePanel.tsx`（`session-tree-store.ts` 管开关）、动作 `fork-actions.ts`（`forkFromMessage` / `branchToNode`，分叉出的任务被选中、那条消息的文字追加进它的输入框）、omp 用户消息卡片上的回退图标被接管成打开面板。用户消息悬停按钮行里 studio 加的"编辑"（`editUserCard`：只把这条消息的原文追加进输入框并聚焦，不回溯）和"分叉"（`forkFromUserCard`）见 session-tree.md「用户消息上的"编辑"」。`/tree`、`/fork` 在 `studio-slash-table.ts`，命令面板 `cmd.sessionTree` 打开面板。

## 模式与状态区（`composer/ModeChip.tsx`、`ComposerNotes.tsx`、`session-toggles/ModeSection.tsx`）

实测：omp 18.12.6，真实 omp + 临时 agent 目录，录制 `fixtures/tsp/composer-{modes,loop,retry,interrupted}.jsonl`；全部读法在纯函数 `shared/tsp/composer-facts.ts`（`test/tsp-composer-facts.test.ts` 逐帧验证）。

- **模式**：输入框卡片里 `omp.composer.fact` 的 `mode` 片段（按节点 id 最后一段认，不按文字，分支叫 "Vibe" 不会误判）。文字 `Plan` / `Plan (paused)` / `Prewalk` / `Goal …` / `Vibe` / `Loop[:] running|paused|next prompt repeats [3/5 | 2m left] [until|while: <命令前若干字>]`；同一时刻只显示一种，优先级 Plan > Prewalk > Goal > Vibe > Loop。主进程记进 `TaskState.composerMode`（目标之外）和 `goal`，输入框卡片被弹窗换掉时沿用上一次的值。
- **开关**：`/plan` 是切换（开 → 退出到 `Plan (paused)` → 再发一次关闭；已有计划时 omp 先弹确认），`/loop` 开着时再发是关闭，`/vibe` 同理。TaskCommand `plan` / `planReview` / `vibe` / `loopStart` / `loopStop` → `TspRunner.runModeCommand`：发之前看当前模式（`modeCommandBlocker`），发出后等模式变成预期的样子或弹出确认 / 评审弹窗（`modeCommandDone`）；没变而 omp 给了 toast（"Exit goal mode first."）= 被拒，原文抛出。成功和被拒都有 toast，所以不靠 toast 判断。`/loop` 的条件命令用 shell 引号：无单引号包单引号，否则包双引号并转义 `\ " $ \``（实测 omp 解析出原命令）。Loop 暂停 = Esc（`stopTask`），继续 = 发下一条消息。Loop 开启只在无模式时给（模式显示优先级会盖住它）。
- **界面**：有模式时工具行出现模式胶囊（点开是当前模式的控件）；无模式时同一组开关在"会话开关"菜单底部。目标开着时 Plan / Vibe / Loop 禁用并说明。
- **扩展状态**：`hook-<N>` 片段（`ctx.ui.setStatus`，只有文字），`TaskState.extStatuses`，状态行右侧只读标签，悬停看全文。
- **速度**：`omp.composer.rate`（`p.value` tok/s，约 10 次/秒），只在 omp 设置 `composer.tokenRate` 开着时有（默认关）；有就用它（取整），没有退回会话文件里的值。
- **状态区**（dock → `omp.hud.status`）：自动重试 = `omp.working` 行，`meter style=ring` 的 value 1 → 0（每 0.5 秒一帧，总等待不在文档里，界面用第一帧和当前帧估秒数 `estimateRetrySeconds`），标签 `Retrying · attempt N of M`，取消 = `omp.working.stop` 的 `interrupt` 动作；压缩 = 同一行多一个无 value 的 `progress`，Stop 同一动作；上一轮停在工具调用中途 = `omp.hint.retry`（"F5 to retry"），界面显示"上一轮被中断 + 重试"（`/retry`）；空闲 loader 能取消的（文字以 `(… to cancel)` 结尾）发 Esc。
- **聚焦子代理**：`omp.composer.focus`，状态行上方横幅 + "回到主会话"（点 omp 的 `focus:Main` 动作），输入框占位符写明对象。
- 未实测（推测）：`/plan` 在已有计划时的退出确认弹窗、`/plan-review`、`omp.hint.retry` 在新一轮开始后何时消失。

## e2e

`test/e2e/tsp.e2e.ts`（`fake-tsp-omp` 回放 `task` / `approval` / `ask` 等录制，假 omp 只在收到和录制完全一致的事件后才继续）、`composer-draft.e2e.ts`、`file-preview.e2e.ts`、`clipboard.e2e.ts`、`session-tree.e2e.ts`、`tsp-modes.e2e.ts` 等，一个一个跑：`npx playwright test test/e2e/<名字>.e2e.ts`（先 `npm run build`）。
