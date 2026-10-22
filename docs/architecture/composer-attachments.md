# 输入框的附件、大段粘贴和高度（2026-10-21，v0.3.26）

代码：`src/renderer/src/features/composer/` 的 `composer-tokens.ts`（纯函数，`test/composer-tokens.test.ts`）、`ComposerInput.tsx`（输入框本体）、`Attachments.tsx`（顶部卡片）、`use-attach.ts`、`use-draft-view.ts`、`draft-store.ts`、`field-height{,-store}.ts`、`caret-request.ts`、`composer-input.css`。界面规格见 `docs/design/spec.md` §4.14。

## 1. omp 18.12.5 的行为（实测）

方法：`omp --version` = 18.12.5；`omp config list --json`（`paste.largeMenuThreshold`）；`omp://keybindings.md`、`omp://tui-core-renderer.md`；读 `omp.exe` 里内嵌的 TypeScript 源码（`strings` 级别，`Editor` 类的 `#nt` / `#$e` / `getExpandedText`、`packages/tui/src/prompt/*` 的占位符函数）。**没有**在真机输入框里按键复现（TSP 的 `send` 事件不走粘贴路径，见下），下面标"源码"的是读源码得到的。

| 项目 | omp 18.12.5 |
|---|---|
| 折叠阈值（源码 `#nt`） | 粘贴文字**超过 10 行（`lines > 10`）或超过 1000 个字符**就折叠；否则原样插入 |
| 粘贴文字先整理（源码 `#Re`） | CRLF / CR → LF，NFC，Tab → 3 个空格，去掉 `[\x00-\x09\x0B-\x1F]` 的控制字符（LF 保留） |
| 占位符文字（源码 `#$e`） | 行数 > 10：`[Paste #N, +X lines]`（X = 总行数）；只是字符多：`[Paste #N, M chars]`。N 从 1 起，**计数器只增不减**，提交后清零（`clearPasteState`） |
| 提交时（源码 `getExpandedText`） | 占位符整段换回原文；用正则 `\[Paste #N(?:, (?:\+\d+ lines\|\d+ chars))?\]` 匹配，所以用户改过括号里的统计也认 |
| 图片占位符（源码 `sHt`） | `[Image #N, WxH]`（没有尺寸时 `[Image #N]`）；N = 第几张待发图片（从 1 起，位置编号） |
| 输入框里的显示（源码 `OXe` + `composerChips`） | 芯片 `<图标> #N`；文字里的真实内容是上面的占位符（"atom"：显示标签 ↔ 展开文字），删掉标签 = 删掉占位符 |
| 提交时图片的处理（源码 `oHt`） | 只带文字里引用到的图片；按编号排序后重新编号成 1..k，占位符同步改写 |
| 模型怎么引用图片 | 图片附件有 `attachment://N` 地址（`read` 工具能读，源码 `AttachmentProtocolHandler`） |
| `paste.largeMenuThreshold`（`omp config list --json`） | 默认 100：粘贴达到这么多行时弹菜单（包成代码块 / XML 标签 / 存成文件）；0 = 关菜单，"大段粘贴照样折叠成 `[Paste]`" |
| 原样粘贴（`omp://keybindings.md`，`app.clipboard.pasteTextRaw`） | `Ctrl+Shift+V` / `Alt+Shift+V`：不折叠 |
| 外部终端的 `send` 事件（`omp://tui-core-renderer.md` §5） | 走 `submit()` 的普通提交路径，"这不是粘贴，大段文字不弹菜单"；文字里的占位符**不会**被展开（占位符展开靠编辑器自己记着的粘贴内容，`send` 带的只有文字） |

## 2. studio 怎么做

studio 通过 TSP 的 `send` 事件把整条消息当文字交给 omp（`tsp-runner.ts` 的 `sendPrompt`），图片没有通道：主进程把图片写成临时文件，在文字后面加 `@"<路径>"` 提及，omp 读成图片附件（`docs/architecture/tsp-migration.md`）。所以占位符展开必须在 studio 这一侧做，语义照抄 omp：

- **草稿文字**（`draft.text`）里放 omp 的占位符：图片 `[Image #N, WxH]`，大段粘贴 `[Paste #N, +X lines]` / `[Paste #N, M chars]`。草稿另存 `images`（带像素尺寸）、`pastes`（编号 → 原文）、`pasteCounter`（只增不减）。
- **折叠**：粘贴（`Ctrl+V`）文字按 omp 的整理方式处理后，超过 10 行或 1000 字符的折叠成占位符，原文记进草稿；不大的交给文本框按原样粘贴。`Ctrl+Shift+V`（`Alt+Shift+V`、`Cmd+Shift+V`）永远原样粘贴：keydown 里记一个标记，紧接着的 paste 事件跳过折叠。
- **图片**：粘贴 / 拖入的图片在**粘贴那一刻的光标处**插入占位符（转换是异步的，光标位置在转换前记下；落在别的占位符里面就挪到它后面；输入框没有焦点的拖入插在末尾；前后补空格，和 omp 的 `insertAtom` 一样），图片长边缩到 1568 px 转 WebP（`image-resize.ts`），占位符里的尺寸就是缩放后的。当前模型不收图片时 toast 并拒绝。
- **发送**（`buildSubmission`，`actions.ts` 的 `sendDraft` 和草稿页的 `send` 都用它）：粘贴占位符换回原文；图片按文字里引用的编号排序、重新编号 1..k（占位符同步改写），没被引用的图片不发。发出去的文字是 `…[Image #1, 1568x165]…`，主进程在末尾追加 `@"路径"`（推测：omp 把它读成图片附件后，模型看到占位符和图片是一一对应的；没有在真机上对比过模型的反应，`@"路径"` 读成图片附件本身是 18.12.x 实测过的，见 tsp-migration.md）。
- **删除联动**：文字里的占位符没了（Backspace、剪切、选中删除、`setDraftText` 换文字），对应的图片 / 粘贴原文跟着删（`reconcileDraft`），后面的图片往前补号；点附件卡片的 ✕ = 去掉文字里的占位符。
- **输入历史**：存"粘贴换回原文、图片占位符去掉"的文字（`historyText`）；草稿里有附件时 ↑ 不翻历史（换掉文字会把附件一起丢掉）。草稿落盘（`saveDraft`，主进程存盘的只有文字）同样存展开后的文字，超过 200000 字符时退回占位符。
- **发送失败 / 撤回排队消息**（`restoreDraft` / `appendToDraft`）：把整份草稿接回现在的草稿后面，后面那份的占位符编号顺延（`appendDraft`，omp 的 `g5`）。
- **显示编号 ≠ 草稿 / 发送编号**（v0.3.26）：omp 的图片 `[Image #N]` 和粘贴 `[Paste #N]` 各有一套编号，但在 studio 界面里图片 `#1`、文件 `#1`、粘贴 `#1` 并排出现会让人分不清是哪个。所以**界面上**（顶部卡片、文字里的芯片）所有附件共用一个计数 `#1..#N`：图片在前（按图片编号），然后文件，然后粘贴（按粘贴编号排）。换算在 `composer-tokens.ts` 的 `displayNumber`（草稿类别编号 → 显示编号）和 `viewToText` 里的反向换算。草稿文字（`draft.text`）里的占位符、`reconcileDraft` 的补号、`buildSubmission` 发给 omp 的文字（`[Image #k]` 重新编号 1..k、粘贴换回原文、文件换成 `@"路径"`）完全不变，仍是 omp 自己的写法和编号。例：2 张图片 + 1 个文件 + 1 段粘贴，界面显示 `#1 #2`（图片）、`#3`（文件）、`#4`（粘贴），发给 omp 的是 `[Image #1…] [Image #2…]`、`@"路径"` 和粘贴原文。删掉前面的附件时后面的显示编号跟着往前补。

### 2.1 文件附件（非图片）

omp 没有文件附件占位符；它读文件靠 `@path` 提及（`@` 补全插入，文字里内联，带空格的路径用引号，studio 给图片追加的也是这个写法）。`omp://keybindings.md` 的 OSC 5522 / 括号粘贴说明里，只有"粘贴单个图片文件路径会被读成图片"是自动处理，别的文件路径只是文字。所以 studio 的文件附件**内联换成 `@"路径"`**：

- 草稿里的占位符是 studio 自己的 `[File #N, 名字]`（图片之外另一类位置编号，规则同图片：删掉占位符文件就没了、后面的补号、没引用的不发）；输入框里是 `#N 名字` 芯片，顶部是文件卡片（文件图标 + `#N 名字` + 大小 + ✕）。
- **路径不进渲染进程**（AGENTS：渲染进程传来的路径不可信）：拖到输入框（`[data-composer-drop]`）或粘贴的文件，由 preload 在隔离世界里用 `webUtils.getPathForFile` 取路径，经内部通道 `composerFilesChannel` 交给主进程（2026-10-22 起没有附件按钮和系统文件对话框，附件只来自拖入和粘贴）。主进程（`src/main/files/composer-files.ts`）校验：绝对路径、不含 `"`、确实是普通文件，一次最多 20 个，登记表最多 500 条；登记成不透明 id，推送 `composerFilesAdded`（id + 名字 + 大小）。目录不登记：拖放仍按"拖入文件夹 = 选项目"，粘贴的目录仍是把路径当文字插进输入框。
- 发送：`buildSubmission` 把文件占位符换成 `\uE000file:N\uE001`，`PromptInput.fileIds[N-1]` 带 id；`tsp-runner.ts` 的 `sendPrompt` 在主进程用 id 换回路径（登记表里没有或文件已不在就 reject，草稿放回去），把占位符换成 `@"路径"`（反斜杠换成正斜杠）。第一句话的气泡里显示 `@名字`，不显示路径。
- e2e 用 PowerShell 的 `Set-Clipboard -LiteralPath` 放真实的文件列表（CF_HDROP，同资源管理器里 Ctrl+C）再 Ctrl+V，覆盖粘贴文件 → 卡片 → 芯片 → 发送出去的 `@"路径"`（`test/e2e/tsp.e2e.ts`、`clipboard.e2e.ts`）；拖入造不出带磁盘路径的 File，没有 e2e；登记表的校验和占位符替换有单测（`test/composer-files.test.ts`）。

## 3. 输入框里的芯片是怎么画出来的

文本框是普通 `<textarea>`（输入法、撤销、选区、`@` 补全都沿用），不是 contenteditable。显示用的 view 文本（`buildView`）把每个占位符换成 `OPEN nbsp #N nbsp CLOSE`：`OPEN` / `CLOSE` 是零宽的 `U+2062/2063/2064`（图片 / 粘贴 / 结束），所以 view 里每个字符的宽度和下面那一层逐字对应。文本框下面垫一个同字体、同宽（脚本把它的宽度设成文本框的 `clientWidth`）、文字透明的 `.composer-backdrop`，只给芯片画圆角底色；`aria-hidden`，不进无障碍树。

- 文本框的值是 view 文本；`onChange` 里 `viewToText` 把完整的芯片换回占位符、被改坏的芯片只留可见的字、其余零宽字符丢掉。`@` 菜单、斜杠菜单拿的是 view 文本（它们的光标偏移就是文本框的）。
- 原子性：选区不能落在芯片里面（`onSelect` 里 `snapSelection`：光标贴到近的一边，选区整个包住）；紧贴芯片时 Backspace / Delete 一步删掉整个芯片，← / → 一步越过它；复制 / 剪切含芯片的选区时剪贴板里放占位符文字，不放零宽字符。
- 光标落点：程序改了文字（插入图片、折叠粘贴、删芯片）后，`caret-request.ts` 登记文字里的偏移，输入框在下一次布局里换算成 view 偏移。

## 4. 高度

顶边一条拖拽条（`role="separator"`，`composer-resize`，悬停 / 聚焦时露出一根短横线）：向上拖 = 变高；下限是输入框自己的最小高度（一行），上限是主区（`<main>`）高度的 60%（窗口变矮时重新夹取）；键盘 ↑↓ 每次 16 px，双击还原成自动增高（最大 `min(40vh, 12 行)`）。拖过之后高度固定为拖出来的值，内容超出时内部滚动。整个应用一个值，记在 `localStorage["composer.fieldHeight"]`（和 ModelPicker 的最近使用同一种存法，没有进 `ShellState`：那要动 IPC 和主进程校验）。

## 5. `!command`

omp 18.12.5 的提交路径（`send` 事件走的 `submit()` → 输入框 `onSubmit`）自己处理以 `!` 开头的文字：`!cmd` 在会话里跑 bash 并把输出放进上下文，`!!cmd` 跑但不进上下文（源码：`handleBashCommand(command, excluded)`；已有命令在跑时提示 `A bash command is already running`）。所以 TSP 任务里 `!cmd` 原样 `send` 即可，studio 不再有自己的 `runBash`（读 `omp.exe` 内嵌源码得到，没有在真机上按键复现）。

## 6. 没做的

- omp 的"大段粘贴菜单"（`paste.largeMenuThreshold`，≥100 行时选包成代码块 / XML / 存文件）：studio 一律折叠成芯片，不弹菜单，也不读这个设置。
- 视频（omp 的 `[Video #N]`）：studio 没有。
