# 2. Token（实现见 `tokens.css`）

## 2.1 主题

- 默认：浅色 `:root`；`@media (prefers-color-scheme: dark)` 下，只要 `<html>` 没有 `data-theme` 就套深色（`:root:not([data-theme])`）。
- 显式：`<html data-theme="<名字>">`。设置页选“跟随系统”时主进程**移除**该属性。主题的名字、深浅和主进程要用的颜色登记在 `src/shared/themes.ts`（`themes`，顺序即主题画廊的顺序）；`light` / `dark` 在 `tokens.css`，其余在 `themes.css`。主题块的选择器只写 `[data-theme="<名字>"]`、不带 `:root`：任何元素挂上 `data-theme` 就在它的子树里用那一套变量（主题画廊的预览块就这样就地取色，不复制颜色值）。每个主题块声明的变量和浅色块逐个对应，对比度按 §2.5（`test/themes.test.ts` 核对）。主进程按主题深浅设 `nativeTheme.themeSource`（omp 的 theme 事件、网页的 `prefers-color-scheme` 跟着它）。
- 每个主题都有的两个装饰 token：`--theme-art` = 主题自带插图 `url("./themes/<名字>.svg")`（`src/renderer/styles/themes/`；`light` / `dark` 为 `none`），背景图选“主题插图”时画在主区面板上；主题画廊的预览用同一张插图预先画好的 WebP 缩略图（见 `docs/architecture/themes.md`「主题画廊的缩略图」）；`--accent-glow` = 强调色上的静态发光（`box-shadow` / `text-shadow` 都能直接用的值，多数主题为 `none`），只叠在强调色的小面积处（开关打开态、改过的设置行竖线、命令面板和会话树当前行的高亮条、Markdown 链接、主题画廊的强调色点）；不加在大面积元素上，也不拼进已有的多层 `box-shadow`（值为 `none` 时整条声明会失效）。
- 主区背景图（`StudioSettings.backdrop`：`theme` 主题插图 / `custom` 自选图片 / `none`；浓度 `backdropStrength`）：画在主区面板 `.panel` 的 `::before` 上（单独的合成层，内容重绘时不重画插图，见 `docs/architecture/themes.md`），底色 `--bg-app` → 图（`cover`，靠右下）→ 一层 `--bg-app` 色的纱，浓度决定纱有多厚；只在当前主题有插图时画 `theme`。盖住对话区的面保持不透明。
- Windows 11 毛玻璃（`StudioSettings.glass`，只在 `AppInfo.glassSupported` 时生效）：`<html data-glass>` 时顶栏和侧栏（`--bg-sidebar` 那一层）透出系统 Acrylic，主区面板仍是实底或背景图。
- 切换过渡：用户切换主题时整页交叉淡入（仓库所有者要求，2026-10-22）。`App.tsx` 用 `document.startViewTransition` 包住 `data-theme` 的改动，`app.css` 的 `::view-transition-old/new(root)`，期间 `pointer-events: none`；启动时第一次套用主题不过渡；减少动效（系统或应用内）时只剩 `--dur-fade` 的透明度渐变。系统三键跟着一起淡入，见下方。
- 深色色板在 CSS 里出现两次（系统深色、显式深色），必须逐行一致：Vitest 测试解析 `tokens.css`，比较两个深色块与两个 reduced-motion 块的声明集合，防止改一处漏一处。
- 主进程同步：`BrowserWindow.backgroundColor`（避免首帧闪白）与 `titleBarOverlay`（主题切换时 `win.setTitleBarOverlay`），颜色取 `themes.ts` 里当前主题的 `sidebar`（= `--bg-sidebar`，顶栏和侧栏底色）/ `text`（= `--text`，三键符号色）。

有遮罩（`--bg-scrim`）的弹窗打开期间（模型选择、命令面板、会话树、确认框、关于、git 对话框、接管 omp 询问、过程区放大看图），系统三键也跟着变暗：渲染进程用 `useTitleBarDim` 计数，第一个打开时调 `setTitleBarDimmed(true)`，最后一个关掉时恢复。**调暗三键的遮罩必须盖到窗口顶上（含顶栏）**，只盖顶栏以下会出现“顶栏亮、三键暗”；只盖主区的遮罩（窄窗口侧栏抽屉、omp 的选择器浮层）不调三键。三键不是网页画的、遮罩盖不到，所以变暗色是顶栏色 / 符号色上叠一层主题的 `scrim` 后的实色（`main-window.ts` 的 `overlayColors`）。

三键变暗 / 恢复是渐变，和遮罩的淡入 / 淡出同一时长、同一曲线（3.1，`direction-3.1.md` §2 行 13）：主进程（`src/main/window/main-window.ts`）每 10ms 调一次 `setTitleBarOverlay`，在两端颜色之间插值。时长和曲线按遮罩怎么出现（`useTitleBarDim` 的第二个参数 `TitleBarFade`：弹窗遮罩 `scrim`、命令面板 `palette`、放大看图 `zoom`），各自的取值和减少动效时的取值在 `main-window.ts` 的 `dimFades`，要和对应 CSS 动画保持一致。渐变中途反向时从当前位置接着走；窗口最小化或不可见时直接换色。

切换主题时三键跟着网页的 `data-theme` 走，不跟设置（跟设置会比网页早几十毫秒跳色）：渲染进程在整窗交叉淡入真正开始时调 `setTitleBarTheme(theme, true)`，三键从旧主题的颜色用同样的时长和曲线淡入新主题，期间遮罩照常变暗 / 恢复（遮罩开着时换主题，三键落在新主题变暗后的颜色）；启动时第一次套用、淡入被跳过时直接换。跟随系统时系统深浅变了，网页的 `prefers-color-scheme` 立即变，三键也立即换。

## 2.2 字体

- `--font-sans`（正文/UI）、`--font-display`（仅 ≥20px：新任务页标题、设置页标题）、`--font-mono`（代码、命令、路径）。
- 三个字体栈在最后的通用族之前都接彩色 emoji 字体（3.1，`direction-3.1.md` §2 行 14）：任务标题等文字里的 emoji 不显示成方框。
- 代码元素：`font-variant-ligatures: none`；计时、计数、百分比加 `font-variant-numeric: tabular-nums`。
- `<html lang>` 随界面语言切换（`zh-CN` / `en`），`:root:lang(zh)` 里的行高变量因此生效；**不用 JS 切换行高**。
- 标题 `text-wrap: balance`，正文段落 `text-wrap: pretty`。
- 不写 `-webkit-font-smoothing`（Windows 无效）。

## 2.2.1 小字和说明文字（仓库所有者 2026-10-18 要求）

- **非必要不用小字。** 先看标签、控件状态、图标、位置能不能把意思说清楚，能就不加说明。小号字（`--text-xs`/`--text-sm` 配 `--text-3`）只用于必须有的元信息，例如时间、计数、路径。
- **要说明时不额外占空间。** 按这个优先级放：① 放在已有行里（标签同一行的右侧，空间不够时单行省略）；② 放进悬停提示或 `ⓘ` 弹层；③ 放进展开后的详情区。不要在标签下面另起一行灰字，也不要为说明留固定高度。
- **排版检查**：同一组里各行高度、左缘、基线一致；控件统一右对齐；不出现孤立的短行、半空的卡片、没必要的分隔线。核对界面时，这一条和对比度一起看。

## 2.3 字号

字号 / 行高的取值见 `tokens.css`（中文行高另有 `:lang(zh)` 取值）。用途：

| 变量 | 用在 |
|---|---|
| `--fs-2xs` | 键帽、角标、小标签 |
| `--fs-xs` | 文件夹名、过程行、元信息、tooltip |
| `--fs-sm` | 侧栏、胶囊、按钮、菜单、改动卡片 |
| `--fs-base` | 对话框正文、设置页正文、门的标题 |
| `--fs-prose` | **对话正文、用户消息、输入框** |
| `--fs-lg` | 对话里的 h1、对话框标题、设置分组标题 |
| `--fs-xl` | 设置页大标题、新任务页标题 |
| `--fs-code` / `--fs-code-sm` | 代码块 · 工具输出；行内代码 0.92em |

## 2.4 间距、尺寸、层级

见 `tokens.css`。规则：**组件里不出现表外的数**（除了 1px 描边、2px 焦点环/竖条、组件私有的固定像素如 8px 状态点，这些在 §4 里逐个写明）。窄窗断点（媒体查询不能用变量）：`<1000px` 侧栏抽屉并缩小 `--gutter`。命令面板不用断点，宽 `min(var(--palette-w), calc(100vw - var(--space-8)))`。

层叠上下文：`.composer-stack` 是 `--z-sticky + 1` 的层叠上下文，里面的 `--z-popover` 出不去。输入框上方要能和 omp 弹窗（过程区的 layer，`--z-popover`）同时出现的浮层挂到 body 上（`createPortal`，如 `StatusPills.tsx` 的 `JobsCard`），不在输入框里调 z-index。

## 2.5 颜色语义与对比度

| 用途 | token | 规则 |
|---|---|---|
| 表面 | `--bg-sidebar` < `--bg-app` < `--bg-raised` < `--bg-overlay`；`--bg-sunken` 是凹进去的代码/展开区；`--bg-tool` 是过程卡片、中性卡片的底 | 用层级而不是颜色分区 |
| 交互态 | `--bg-hover`、`--bg-active`、`--bg-scrim` | `:active` 无位移、无缩放 |
| 线 | `--border-subtle`（分隔）/ `--border`（外框）/ `--border-strong`（hover、输入框默认描边） | — |
| 文本 | `--text` / `--text-2` / `--text-3` / `--text-disabled` / `--text-on-accent` | `--text-3` 只用于次要元信息，不用于可操作文字；在较亮的底上对比度较低，见下方例外 |
| 强调 | `--accent` / `--accent-soft` / `--focus-ring` / `--link` / `--selection-bg` | 鸢尾紫（3.0）；只给进行中、主输入焦点、链接、上下文圆环、开关、选中 |
| 主按钮 | `--primary` / `--primary-hover` / `--text-on-primary` | 浅色近黑底白字，深色近白底深字；每个视图最多一个 |
| 状态 | `--st-running`（=强调色）、`--st-waiting`（点）+ `--st-waiting-text`（字）+ `--st-waiting-soft`、`--st-done`、`--st-error` + `--st-error-soft` | 四个语义色之外界面是灰的 |
| 代码 | `--syn-*`（7 色）；`--diff-add-fg` / `--diff-del-fg`（改动卡片的 +N/−N 文字和行数条） | 评审里的行背景 `--diff-add-bg` / `--diff-del-bg` |
| 气泡 | `--bg-bubble` | 只给"你的消息"气泡（§4.8） |

色板（颜色值在 `tokens.css`）：

- 灰是略暖的中性灰，紫色只留给强调色和你的消息气泡；深色拉开各层底色的明度差（主区比侧栏、卡片比主区各高几个 L*），层次不全靠 1px 边框（仓库所有者定，2026-10-24、2026-10-29）。
- **`--st-done` 是绿**，和 `--diff-add-fg` 同值，与紫（进行中）、琥珀（等你）、红（失败）色相分开；`--diff-add-fg` 不跟强调色（紫色的 `+` 看不出是新增）；`--diff-del-fg` = `--st-error`。
- 对比度按 WCAG 公式算，`test/themes.test.ts` 对每个主题核对文字 / 强调 / 状态色与各层底的组合（文本类 ≥4.5，非文本标记和禁用文字 ≥3）。

已知例外：`--text-3` 在“选中行”（`--bg-active`）上深色约 4.3:1——选中行的次要时间文字允许，不用于需要阅读的内容；`--st-waiting`（浅色，点）与 `--bg-sidebar` 约 3.1:1，靠形状（菱形）补足。

## 2.6 动效

| 事件 | 动画 | 时长/曲线 |
|---|---|---|
| 菜单、popover、tooltip 出现 | opacity 0→1 + `translateY(var(--travel-sm))→0` + `scale(var(--scale-pop))→1` | `--dur-base` `--ease-out`；消失 `--dur-fast-exit` `--ease-in` |
| 对话框出现 | 同上，位移 `--travel-md` | `--dur-slow` `--ease-spring` |
| 命令面板出现 / 消失（`palette.css`、`CommandPalette.tsx`；键盘高频，不弹簧） | 遮罩连面板只淡入 / 淡出，不位移不缩放 | `--dur-fast` `--ease-out` / `--dur-fast-exit` `--ease-in` |
| 过程行展开/折叠 | `grid-template-rows: 0fr↔1fr` + 内容 opacity | `--dur-base` `--ease-out` |
| 输入框首次发送 | 不做 FLIP：草稿发出第一句话后输入框留在原位，换成任务的输入框时不放换页入场（`motion.css`） | - |
| 图标形变（`ui/MorphIcon.tsx`，依赖 `morphicons`，2026-11-09 仓库所有者批准）：发送 ↑ ↔ 停止 ■（§4.14，同一个按钮、同一个图标元素）、复制 → 对勾、提示词优化 ✦ ↔ ×、浏览器刷新 ↻ ↔ ×、切换侧栏（§3.1） | 同一个 `<svg><path>` 的 `d` 从旧图标按弹簧变成新图标；按钮底色照旧用 CSS 过渡。图标几何和静态图标同一份（`src/icons.tsx` 的 `*_NODE`，模块加载时换算到 morphicons 的 24 栅格一次，`ui/morph-glyphs.ts`），描边按 `--icon-stroke` 换算，静止时和静态图标一样粗 | morphicons 的 `snappy` 弹簧；减少动效时直接换成目标图标 |
| 用户消息出现 | `translateY(var(--travel-md))→0` + opacity | `--dur-base` `--ease-out` |
| 侧栏折叠/抽屉（`app.css` `.sidebar-column`） | `translateX`；主区宽度**立即变一次**，不逐帧（收起和抽屉时侧栏 `position: absolute` 盖在主区上滑出）。不过渡列宽：长对话每帧重排，一次开合排版 60ms 以上 | `--dur-slow` `--ease-out` |
| 右栏打开（文件面板、子代理面板，`file-preview.css` 的 `panel-in`） | 整块从窗口右边 `translateX` 滑进；主区宽度立即变一次。关闭不放动画 | `--dur-slow` `--ease-out` |
| 状态点切换 | 旧点缩小淡出 + 新点放大淡入 | `--dur-fast` |
| 进行中转圈（状态点） | 一段弧旋转，循环 | `--dur-spin` 按 `--tick-spin` 跳帧，`animation-play-state: var(--play-state)`；减少动效时静止 |
| 加载环 | 旋转 | `--dur-spin` 按 `--tick-spin` 跳帧 |
| 流式光标 | opacity 脉冲 | `--dur-caret` |
| Toast | 从上方滑入：`translateY(calc(var(--travel-md) * -1))→0` + opacity；挪到窗口底部时（有遮罩的弹窗开着）从下方滑入 | `max(--dur-base, --dur-fade)`（减少动效时位移为 0，只淡入）；退出反向（原路滑回 + 淡出，`max(--dur-base-exit, --dur-fade)`）；停留时间见 §4.23 Toast |
| 浮层、菜单、对话框、toast **消失** | 反向：opacity→0 + 下沉 `--travel-sm` + 缩到 `--scale-pop`；遮罩只淡出 | `--dur-fast-exit` `--ease-in`；放完才卸载（`ui/presence.ts` 的 `usePresence`，`data-closing="pop"/"fade"`，规则在 `ui/motion.css`） |
| 折叠区域展开/收起（凡是可折叠的都用它：侧栏文件夹、设置分组、目标条、旁路提问面板、提供商组、请求记录详情、子代理对话记录等） | `grid-template-rows: 0fr↔1fr` + opacity；首次渲染就展开的不放 | 展开 `--dur-base` `--ease-out`，收起 `--dur-base-exit` `--ease-in`（`ui/Reveal.tsx`） |
| 主区换页（新任务页 / 对话 / 设置，含从设置返回任务时的过程区）、切任务、设置换节、侧栏在会话列表和设置导航之间切换 | `view-in`：opacity + `translateY(var(--travel-sm))→0`；例外：草稿发出第一句话变成任务时，输入框不播（`.composer-stack[data-from-draft]`，它在原位接着用，播了就是“闪一下”） | `--dur-base` `--ease-out` |
| 可交互元素的 hover / 选中 / 聚焦 | 背景、边框、文字颜色、阴影、透明度渐变 | `--dur-fast` `--ease-out`（`motion.css` 里 `:where(button, …)` 零优先级的默认值，组件自己写的优先） |
| 按钮鼠标按下（`ui/controls.css` `.ui-btn` / `.ui-icon-btn`） | `scale(0.97)`；只在 `(hover: hover) and (pointer: fine)`、`:active:not(:focus-visible)`、非禁用时，键盘触发不缩 | `--dur-instant` `--ease-out` |
| 侧栏任务行重排、新增删除补位（`ui/flip.ts` `useFlip`，`FolderGroup.tsx`） | FLIP：留下的行从旧位置 `translateY` 回 0；只在同一分组的 key 顺序变化时放，首次渲染、展开折叠、拖宽、跨分组不放；减少动效不放 | `--dur-base` `--ease-out` |
| toast 消失后其余补位（`Toasts.tsx`，同 `useFlip`） | 同上；消失那条的退场不变 | `--dur-base` `--ease-out` |
| 对话线跳转落点（`ConversationLine.tsx` `flashLanding`） | 目标消息 `--accent-soft` 底 + 2px `--accent` 环淡掉；只动颜色，减少动效时也放 | 900ms `--ease-out` |
| 工具卡 / 子代理行从运行中变完成（`tsp/nodes/work.tsx` `useJustFinished`，`tsp.css` `.tsp-draw-check`） | ✓ 用 `stroke-dashoffset` 描边画出，运行中的淡紫底过渡褪掉；✓ 常驻（issue #9）；描边动画只在已挂载的卡片状态变化时放，历史、切任务、重挂载不放 | 画出 `--dur-base` `--ease-out`；淡出 `max(--dur-base, --dur-fade)`；减少动效时直接显示 |
| 一批子代理行 / 作业磁贴同时出现（`tsp/entrance.ts`，`tsp.css` `.tsp-enter`） | opacity + `translateY(--travel-sm)`，同一批每格错开一点（错开上限见 `entrance.ts`），后来单个出现的不延迟；按节点 id 只算出生一次，切任务、重开不放 | `max(--dur-base, --dur-fade)` `--ease-out`；减少动效时纯淡入、不错开 |
| 对话图片点开放大 / 关闭（`tsp/zoom-store.ts`，`tsp.css`） | View Transition：缩略图与大图共用 `view-transition-name: tsp-zoom`，从缩略图位置放大、关时缩回；遮罩随 root 淡入淡出；←/→ 切图只换图；缩略图已卸载或出视口时只淡出；规则带 `:root[data-tsp-zoom-vt]` 前缀，不影响切主题的整窗过渡；减少动效时只淡入淡出 | `--dur-base` `--ease-out`（减少动效 `--dur-fade`） |
| 窗口出现 / 消失（`main-window.ts` 的 `revealWindow` / `concealWindow`，整窗 `BrowserWindow.setOpacity` 逐帧渐变） | 启动、从托盘 / 第二个实例 / 通知 / Dock 带回时整窗淡入；点 × 隐藏、退出（托盘“退出”、⌘Q、安装更新、注销）时整窗淡出再隐藏。最小化 / 还原仍是系统动画；系统自己的开关窗动画落在透明窗口上看不见，不叠两层。见下方「整窗淡入淡出」 | 自己的时长和曲线，不套 tokens.css（`main-window.ts` 的 `windowEnterMs` 等）；减少动效时只剩 `--dur-fade` |
| 有限高度的滚动列表上下渐隐（`ui/controls.css` `.ui-scroll-fade`：下拉列表、命令面板结果、模型选择表） | `animation-timeline: scroll(self)` 驱动 mask 的 `@property` 长度变量：上 / 下还有内容的一边渐隐，滚到头不隐，`--fade-inset` 避开粘性表头 | 随滚动 |
| 等 omp 返回的列表（`ui/Skeleton.tsx`：Provider、Skills、MCP、SSH、插件、市场浏览、模型选择） | 与最终行同高的灰条骨架，`::after` 光带 `translateX` 扫过；数据到了容器 `.ui-data-in` 淡入 | 扫光 `--dur-sweep` linear 循环、`--play-state`（减少动效停住）；淡入 `--dur-fast` `--ease-out` |

整窗淡入淡出：

- **启动不露空窗**：页面第一次绘制（`ready-to-show`）时窗口先以不透明度 0 显示，等渲染进程设置读到、第一次有内容的一帧真正上屏（`first-contentful-paint`）再淡入（`App.tsx` → `windowReady`）。等到那时才 `show()` 不行：显示后还要约 300ms 才有画面，淡入的是一块空底色（实测）。设置读到后过 `firstFrameFallbackMs` 还没有 FCP 也淡入：Linux 打包版里透明窗口一直不记 FCP，不兜底窗口永远透明（实测，见 `docs/architecture/linux.md`）。
- **时长和曲线不套 tokens.css**（仓库所有者 2026-10-26 嫌不够明显）：整窗透明度比弹层显眼得多，套 `--dur-base` + `--ease-out` 时看上去是直接出现 / 消失；逐帧定时器间隔写 10ms（Windows 系统时钟一跳约 15.6ms，写 16 实际 31ms 一帧），原因见 `main-window.ts` 注释。
- **淡入淡出过之后窗口一直是分层窗口（`WS_EX_LAYERED`），不清**：第一次 `setOpacity` 之后窗口就是分层的，`hide()` 后 `setOpacity(1)` 再显示也还是。代价测不出（整窗 CSS 旋转动画下分层 / 不分层交替各 3 轮，dwm 和应用 GPU 进程的 GPU 占用、显存都相同）；从外面清掉样式后 Electron 之后的 `setOpacity` 不会再加回来（实测），推断逐帧不透明度从此失效，要清就得每次淡入淡出前自己加回去，没有收益（2026-10-28 实测，Windows 11 build 26300，Electron 44.9，AMD 核显 + RTX 5070 Ti 笔记本；koffi 读 `GetWindowLongPtrW(GWL_EXSTYLE)`）。

性能规则：只动 `transform` 与 `opacity`（外加折叠用的 `grid-template-rows`）；不动画 `height` / `width` / `top` / `left`。循环动画（转圈、π 写字、思考强度刻度波动）的目标必须是 HTML 盒子：SVG 里的元素、连 `<svg>` 自己的 transform / opacity 动画都交不给合成器，每帧要在主线程重算样式甚至重新排版整页（2026-10-25 实测：侧栏一个转圈让运行中每 2 秒排版一百多次），所以 `StatusDot` / `TodoMark` 转的是包着 svg 的 span，`PiWriteMark` 和思考强度刻度用 HTML 元素画格子。例外是图标形变（`ui/MorphIcon.tsx`）：它每帧在主线程改一个 `<path>` 的 `d`，只在点击后的几百毫秒里跑、不循环；所有图标共用 morphicons 的一个 `requestAnimationFrame`，没有在变的图标就不排帧，所以不能拿它做循环动画。样式表里不用 `:has()`：对话区每插入 / 删除一个节点都要做 :has 失效检查，大对话（约 1.5 万节点）里一次改动的样式 + 排版从约 0.3ms 变成 3.5ms；要按子节点 / 兄弟决定样式时由组件加 class 或 data 属性（如 `data-blank`、`data-cards`、`data-linked`）。reduced-motion 下：所有位移、缩放、弹簧归零；循环动画暂停在 0% 帧（呼吸环=实心点带一圈淡环，光标常亮，加载环用静态 `…`，由 `useReducedMotion()` 切换字形）；图标形变直接换成目标图标；只保留 `--dur-fade` 的透明度渐变；`scrollTo` 一律 `behavior: "auto"`；输入框“落下”瞬时。JS 里读取动效开关只走一个 `useReducedMotion()`（`matchMedia` + `data-motion`），组件不各自读。

---
