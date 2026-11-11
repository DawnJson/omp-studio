# 5. 交互

## 5.1 快捷键

Windows / Linux 用 `Ctrl`，macOS 用 `⌘`（下文表里的 `Ctrl` 都指“应用主修饰键”；mac 规则见表后“macOS”一段）。输入框/文本域里**只有带主修饰键/Alt 的快捷键和 Esc 生效，单字符键绝不抢**。快捷键只在窗口聚焦时生效，不注册系统级快捷键。设置页只读展示（`shortcut.*`），菜单项/tooltip 里以 Kbd 展示。

| 动作 | 键 | 说明 |
|---|---|---|
| 命令面板 | `Ctrl K` | 再按或 `Esc` 关闭 |
| 新任务（选项目） | `Ctrl N` | 草稿任务，§5.5 |
| 在当前项目新任务 | `Ctrl Shift N` | 不弹选择器 |
| 打开文件夹 | `Ctrl Shift O` | 同侧栏 `打开文件夹`（`Ctrl O` 是展开/收起过程行） |
| 搜索任务和会话 | `Ctrl F` | 聚焦侧栏搜索框并全选，侧栏收起/抽屉没开时先展开；设置页里 `Ctrl F` 是设置搜索，由设置页先处理（`preventDefault`，全局监听跳过 `defaultPrevented`） |
| 设置 | `Ctrl ,` | |
| 切换侧栏 | `Ctrl B` | |
| 聚焦输入框 | `Ctrl L` | 并滚到底 |
| 终端 | `Ctrl \`` | 收起 → 打开并聚焦；开着但焦点不在终端 → 聚焦终端；焦点在终端 → 收起并回到输入框。命令面板的 `切换终端` 和任务条按钮是纯显隐切换 |
| 跳到等你确认的任务 | `Ctrl J` | 已在该任务时聚焦门；无待确认时无动作 |
| 第 N 个任务 | `Ctrl 1…9` | 侧栏眼前画出来的任务顺序（合并列表里展开着的文件夹里的任务行；“对话”“归档”里是列表顺序；折叠的文件夹、被“显示更多”藏起来的行不算；`features/sidebar/visible-order-store.ts`） |
| 上/下一个任务 | `Ctrl Shift [` / `Ctrl Shift ]` | 循环；不用 `Ctrl Alt ↑ / ↓`：那是 Intel/AMD 显卡驱动的屏幕旋转热键；按物理键位认，Codex 桌面版同款 |
| 对话里上一轮 / 下一轮 | `Ctrl Shift ↑` / `Ctrl Shift ↓` | 以正在读的那条用户消息为起点跳到上 / 下一条（同点对话线的刻度），到头不动；空的输入框里也生效；输入框有字时让给输入框（Chromium 里这组键是选到段首 / 段尾，mac 的 `Cmd Shift ↑ ↓` 是选到开头 / 结尾），e2e 实测选区；不转发给 omp（`STUDIO_RESERVED`）。设置页盖着对话时不翻 |
| 发送 / 运行中插话 | `Enter` | IME 组合中无效 |
| 换行 | `Shift Enter` | |
| 空闲发送 / 运行中稍后 | `Ctrl Enter` | 有门时见 §4.17 |
| 停止并取回排队消息 | `Esc` | §5.2 栈第 4 层 |
| 门：主操作 / 拒绝 | `Ctrl Enter` / `Esc` | §4.17 |
| 门：选第 N 项 | `1…9` | 提问对话框聚焦时，studio 自己做（omp 18.18.3 不认数字键）：和点第 N 项一样，选项前画序号；审批门照旧写给 omp |
| 模型弹层 / 循环思考强度 | `Alt M` / `Alt T` | 与 omp TUI 一致 |
| 展开/收起最近一个过程行 | `Ctrl O` | 与 omp 终端习惯一致 |
| 复制最后一条回答 | `Ctrl Shift C` | 开发版改用 `Ctrl Alt C`（与 DevTools 冲突） |
| 重命名 / 归档（侧栏聚焦） | `F2` / `Del` | |
| 区域循环 | `F6` / `Shift F6` | 侧栏 → 对话区 → 门/输入框 |
| 打开评审 | `Ctrl Shift D` | 当前任务；评审内的单字符键见 §4.25 |
| 文件面板 | `Ctrl Shift E` | 当前任务或新任务草稿（含默认文件夹）；打开文件页，再按一次关闭；面板内的键见 §4.27 |
| 浏览器面板 | `Ctrl Shift B` | 当前任务；打开 / 关闭，§4.29 |
| 回底部 | `End` / `Ctrl End` | 焦点在对话区 |
| omp 自己的键（TSP 任务） | 默认：`Shift Tab` / `Ctrl T` / `Ctrl P` / `Ctrl Shift P` / `Alt P` / `Alt Shift P` / `Ctrl R` / `F5` / `Alt R` / `Alt ↑`；**以 omp 的实际键位为准**（omp 默认键位 + 用户 `<agent 目录>/keybindings.yml` 的覆盖，主进程只读，`omp-config/keybindings.ts`，算法 `src/shared/tsp/omp-keybindings.ts`，经 IPC `getOmpKeybindings` 给渲染进程；输入框 / 过程区拿到焦点、窗口回前台、打开设置页时重读） | 焦点在输入框或过程区、studio 没占用这个键时原样写给该任务的 omp（`features/tsp/use-forward-omp-keys.ts`，判定 `src/shared/tsp/forward-keys.ts`）：思考强度、思考块显隐、角色模型、临时切模型、计划模式、历史搜索、重试、取回排队消息。用户在 omp 里改了键位，转发的键跟着变（覆盖整个动作，`[]` 禁用；改到 studio 占用的键上时 studio 优先、不转发；只转发带 `Ctrl` / `Alt` 的、功能键和 `Shift Tab`，单个字符、`Shift ↑` 这类输入框要用的键不转发）。设置 → 通用 → 快捷键表下面的“omp 快捷键”一组列出当前转发的动作和键（§4.19）。另外文档里 `kbd` 节点上写着的带 `Ctrl` / `Alt` 的键和功能键也转发。`Shift Tab` 只在输入框里转发（别处是焦点反向移动）。omp 的键帽提示（`Retry F5`、`Switch model ⌥P`、`Edit ⌥↑`）因此键盘也能触发 |

**转发的优先级**：studio 自己的键先于 omp 的（`STUDIO_RESERVED`，不转发）。同键不同义的冲突：`Ctrl L`（omp 实时模式；studio = 聚焦输入框）、`Ctrl Shift O`（omp 切工具可见；studio = 打开文件夹）、`Ctrl D` / `Ctrl Z` / `Ctrl C`（omp 退出 / 挂起 / 清空；输入框里是删字符 / 撤销 / 复制）、`Alt ←/→`（omp 树折叠；studio = 后退 / 前进）；同键同义的由 studio 自己处理：`Alt M`（模型弹层）、`Ctrl O`（展开过程行）、`Ctrl Enter`（稍后发送）。`Alt T`（studio 循环思考强度）omp 没有这个键，不转发；omp 的 `Ctrl T` 是思考块显隐，两者不冲突。已被别处 `preventDefault` 的键（斜杠菜单的 Tab、输入法组合期间）不转发；list / 提问对话框 / omp 编辑器节点自己写键的控件里不重复转发。

**macOS**（2026-10-25 仓库所有者定；没有在 mac 上实测，下面的冲突核对来自对 macOS 系统快捷键的了解，是推测）：
- 主修饰键换成 `⌘`（`metaKey` 且没按 `Ctrl`）：Windows / Linux 仍是 `ctrlKey` 且没按 Win 键。判定只有一处：`src/renderer/src/app/platform-keys.ts` 的 `primaryMod(event)`，平台来自 `useAppInfo()?.platform`（没载入时当 `win32`），渲染进程同时在 `<html>` 上设 `data-platform`。全部应用快捷键（§5.1 表、`Ctrl Enter` 提交 / 在新任务中询问、`Ctrl R` 输入历史、审批门 `Ctrl O` / `Ctrl Enter`、`Ctrl Shift C`、终端里回到输入框的 `` Ctrl ` ``）都走它。`send-logic.ts`、`ComposerInput.tsx`、`CommentBox.tsx`、`SettingsNav.tsx`、过程区链接的 `ctrlKey || metaKey` 宽松判断保持不变（两个键都认）。
- 组合照搬 Windows 的，不另设一套：`⌘K`、`⌘N`、`⌘⇧N`、`⌘⇧O`、`⌘F`、`⌘,`、`⌘B`、`⌘L`、`` ⌘` ``、`⌘J`、`⌘1…9`、`⌘⇧[` / `⌘⇧]`、`⌘⇧D` / `⌘⇧E` / `⌘⇧R` / `⌘⇧C`、`⌘O`、`⌘R`、`⌘↩`。
- **例外（不照搬）**：后退 / 前进在 mac 是 `⌘[` / `⌘]`（mac 惯例，按 `event.code`），不再是 `Alt ←/→`——mac 上 `⌥←/→` 是按词移动光标，全局拦下会破坏输入框。`Alt M` / `Alt T` 在 mac 是 `⌥M` / `⌥T`，按物理键位 `event.code`（`KeyM` / `KeyT`）认：`⌥` 加字母产生的是特殊字符（`⌥M` = `µ`），`event.key` 认不出字母。
- 发给 omp / 终端的**真 Ctrl 键不变**：`features/tsp/keys.ts`、`shared/tsp/forward-keys.ts`（带 `⌘` 的键不转发）、终端里 `Ctrl C` 中断、`Ctrl V` 等。设置页“omp 快捷键”一组仍是 `Ctrl` 写法。
- **显示**：mac 用符号 `⌘` `⇧` `⌥`（`⌃` 保留给真 Ctrl），**键与键之间不加空格或加号**，如 `⌘⇧N`、`⌘,`、`⌘↩`；Windows / Linux 仍是 `Ctrl Shift N`。`platform-keys.ts` 的 `shortcutKeys`（设置页每个键一个键帽）、`shortcutLabel`（一个字符串）、`withShortcut`（悬停提示 `文字 (⌘B)`，`Tooltip` 的 `splitShortcut` 认 `(` 后以 `⌘ ⇧ ⌥ ⌃` 开头的尾巴）、`localizeKeys`（i18n 文案里写死的 `Ctrl+Enter` 换成 `⌘↩`）。源文字一律按 Windows 写，转换在显示处做。
- **与 macOS 系统 / 应用菜单快捷键的核对**：
  - `⌘H`（隐藏）、`⌘M`（最小化）、`⌘Q`（退出）、`⌘W`（关窗口）：studio 都没占用，留给应用菜单的 role（`window/` 的 mac 菜单）；`⌥M` 与 `⌘M` 不冲突。
  - `⌘,`：macOS 应用菜单的“设置…”惯用键，同时是 studio 的“设置”。**保留**；菜单里不要再给“设置…”绑 `CmdOrCtrl+,` 的 accelerator（菜单 accelerator 在渲染进程之前拦截，会走两遍或只走菜单），要加菜单项就让它发 `showView("settings")` 且不带 accelerator。
  - `` ⌘` ``：macOS 系统“在同一应用的窗口间切换”。studio 只有一个窗口，系统多半不拦、渲染进程能收到 [推测]；**保留**，收不到时用命令面板 `切换终端` 或顶栏终端按钮。
  - `⌘R`（输入历史搜索）：Electron 默认视图菜单的“重新加载”是 `⌘R`；mac 菜单**不要**带 `viewMenu` / `reload` role。`⌘⇧R`（重开会话）同理，别绑 `forceReload`。
  - `⌘N`、`⌘⇧N`（常见的“新窗口”键，studio 只有一个窗口，语义改成新任务）、`⌘O`、`⌘F`、`⌘B`、`⌘J`、`⌘K`、`⌘L`、`⌘1…9`、`⌘⇧[` / `⌘⇧]`（mac 标签页切换惯例，这里是切任务，与之呼应）：没有系统级占用；菜单里没有对应项即可。`⌘⇧D` / `⌘⇧E` / `⌘⇧C` / `⌘⇧O`：系统无占用；`⌘⇧C` 在 Chromium DevTools 里是“选择元素”，只影响开发版。
  - `⌘C` / `⌘V` / `⌘X` / `⌘A` / `⌘Z`：来自 mac 应用菜单的 `editMenu` role，studio 不自己处理（输入框的撤销 / 粘贴也走它）。内置终端里 `⌘C` / `⌘V` 靠同一组 role 和 xterm 自己的 copy / paste 事件，没有在 mac 上实测。

**Linux**：快捷键和显示同 Windows（`Ctrl`）。多一个 `Ctrl Q` 退出应用（`window/hide-on-close.ts`，主进程 `before-input-event` 拦下，渲染进程和 omp 收不到；不带 Shift / Alt / Super 才算）：原版 GNOME 这类没有托盘宿主的桌面上看不到托盘图标，点 × 隐藏窗口后没有别的"退出"可点。退出走 `app.quit()`，和托盘"退出"一样不弹确认。第一次点 × 时的系统通知按平台换文案（`notify.tray.stillRunning.*Linux`）。

`Alt ↑`（omp 取回排队消息）：omp 把最后一条排队消息写进它自己的输入框（studio 不画），渲染进程在键写出前先订阅文档，读到那段文字后追加进 studio 输入框的草稿并清空 omp 的输入框（同 Esc 取回，`queue-restore.ts`），3 秒内没有就放弃；队列里没有消息时只是把键交给 omp。转发后 omp 里改了思考强度 / 模型（`Shift Tab`、`Alt P` 选择器），输入框的模型 / 思考胶囊跟着变（读 omp 输入框卡片，实测 high → max → off、`DeepSeek V4 Flash` → `Fable 5.1`）。

**页面缩放只有一个入口：设置 → 通用 → 外观 → 字号**（`StudioSettings.fontSize`，档位 `fontSizeSteps`，存 `userData/settings.json`；按 pt 选档而不是缩放百分比，仓库所有者定，2026-10-23）。Chromium 默认缩放 `Ctrl +/-/0`、`Ctrl`+滚轮、捏合仍禁用（`window/security.ts` 的 `blockZoom`）。

实现选整页缩放（主进程 `webContents.setZoomFactor(fontSize / 15)`，15 是设计稿正文字号 `--fs-prose`，`window/main-window.ts` 的 `applyFontSize`），不改 `tokens.css` 的字号变量：整页缩放让字、间距、图标、固定像素的列和控件高度同比例变化；只乘字号变量的话固定像素尺寸不跟着动，会装不下。要点：① `titleBarOverlay`（系统三键区，不是网页画的）的高度要跟着缩放（`setTitleBarOverlay({ height: round(顶栏高 × 缩放) })`），否则三键区和顶栏错位；② 页面重载、导航（`did-finish-load`）、被滚轮缩放（`zoom-changed`）、设置变化时都重新套用同一个档位，缩放不被别的路径改乱（`zoom-changed` 同时连光标位置转给渲染进程：文件预览的网页在沙箱 iframe 里，Ctrl+滚轮只能这样缩放它，见 §4.27）；③ 只有一个窗口，`setWindowOpenHandler` 一律拒绝，系统文件对话框不属于页面，不受缩放影响；④ 窗口尺寸、位置、最小宽度以窗口像素计、不随字号变，所以大字号时 CSS 宽度变窄，布局走窄窗口的那套（侧栏抽屉、设置导航收成下拉，各处容器查询降列），e2e `shell.e2e.ts` 的「字号最大档」逐节查 `expectNoOverflow`。

## 5.2 Esc 栈（自上而下，命中即停）

1. 有菜单/弹层/面板/对话框打开 → 关闭最上层
2. 焦点在过程区里（门的选项列表、提问对话框、omp 的选择器 / 弹窗）→ Esc 写给 omp（取消提问、关选择器 / 弹窗，由 omp 决定），不当成停止
3. 斜杠菜单打开 → 关闭
4. 提示词优化进行中 → 取消优化（§4.14“提示词优化”；排在停止任务前面，运行中的任务不停）
5. 任务正在运行 → 停止（`stopTask`：主进程把 Esc 写给 omp）；omp 的面板开着时只把 Esc 交给 omp 关面板，不停止主代理
6. 侧栏抽屉打开 → 收起
7. 否则无动作（**不**清空输入框）

## 5.3 焦点去向

| 时刻 | 焦点 |
|---|---|
| 应用启动 | 输入框（有项目）/ 引导主按钮 |
| 新建任务、点任务/`Ctrl 1…9` 切换 | 输入框（光标在草稿末尾）；例外：在侧栏里用键盘 `↑↓` 移动时留在侧栏，`Enter` 才进输入框 |
| 发送后 | 仍在输入框 |
| 本轮结束 | **不动焦点** |
| 门出现 | §4.17 的 1.5 秒规则 |
| 门答复/关闭 | 回到出现前的元素；不存在则输入框 |
| 命令面板/弹层/菜单/对话框打开、关闭 | 面板输入 / 关闭后回到触发器（记 `activeElement`，已移除则输入框） |
| 设置打开、返回 | 分节列表 / 回到进入前的元素 |
| 展开/折叠过程行 | 留在该行按钮上 |
| 对话区文本选择 | 流式追加不得清除选区（只在末尾 DOM 节点上追加） |

Tab 顺序：侧栏头 → 任务列表（一个停靠点，内部方向键）→ 主区头 → 对话区（过程行、代码块按钮、卡片）→ 门 → 输入框 → 输入框工具行。对话区 `tabindex=0` 用于键盘滚动，Tab 序在输入框之后，聚焦环用 inset 样式。除 `autofocus` 与上表外，不用 JS 抢焦点；每个程序化聚焦都有对应用例。

自动聚焦之前先看焦点在哪：在 `aria-modal="true"` 的对话框里或在输入框（`[data-composer-input]`）里就不抢。新出现的卡片、列表、弹层都照这条办（踩过：审批门的选项列表抢走了写拒绝理由的输入框）。

## 5.4 滚动与流式不跳动

**滚动**（单一 `.scroller`）：
1. 吸底判定：距底 ≤48px（`IntersectionObserver` 观察底部哨兵）。吸底时每次布局变化后在 `ResizeObserver` 回调里（排版之后、绘制之前）直接 `scrollTop = scrollHeight`（瞬时，不用 smooth）：长出来的内容画出来的那一帧就在底部，不先在底边下面画一帧再跳上来。
2. 用户主动向上滚动（滚轮、拖动滚动条、PageUp/Home/↑、触摸）立即脱离吸底；此后追加内容不改变 `scrollTop`；程序性滚动不算。滚回距底 ≤48px 自动重新吸底。
3. 脱离吸底且仍有新内容 → 显示 JumpToLatest（§4.15）。
4. 用户发送消息 → 强制吸底。
5. 展开/折叠任意块（过程行、代码块、长用户消息）以被点击元素为锚：它在视口里的位置不变，必要时补偿 `scrollTop`。
6. 切换任务：各自记住滚动位置和吸底状态。最近看过的几个任务的过程区（`TspView`，个数 `App.tsx` 的 `KEPT_VIEWS`）不卸载，切走时用 React 的 `Activity` 藏起来（effect 和订阅撤掉，DOM 和状态留着；藏着时的更新按低优先级渲染），切回来不用把整段对话重画一遍。藏着的过程区 `KEPT_IDLE_MS` 没再看就卸载，挤出 `KEPT_VIEWS` 的也一样：卸载时放掉它的文档镜像和图片（`releaseTspDocument`，主进程也不再推它的批次），折叠状态留着；切回来重新拉快照、重画整段对话。因此 DOM 里可能同时有几个 `tsp-view`，按全局选择器找过程区里的元素时要取看得见的那个。进设置时当前任务的过程区不进 `Activity`，而是“停着”（`TspView` 的 `parked`，`data-parked`：`position: absolute` + `visibility: hidden`）：节点、effect、排版和滚动位置都留着，返回时不用把上万个节点重算样式、重挂 effect（2026-10-25 实测 120 轮、约 2 万个节点的对话，返回那一帧 139ms → 约 50ms）。不加 `content-visibility: hidden`：它里面的动画交不给合成器，停着的对话里有一个转圈的工具卡，主线程就每帧都要跑（2026-10-28 实测设置页上每秒 400 多个主线程帧）；停着时 omp 的快捷键不转发、⌃O / ⌃⇧C 不生效、omp 弹层不截 Esc、omp 的通知不弹（`TspParkedCtx`）。
7. 门出现不改变滚动位置。
8. 性能：离屏的已结束 turn 用 `content-visibility: auto; contain-intrinsic-size: auto 400px`（最近 20 轮不用）；不上虚拟列表。块内要量尺寸的地方（行数夹紧 `Clamp`、状态行藏 seg 的 `nodes/chrome.tsx` `Status`）只在 `ResizeObserver` 回调里量（浏览器自己排版之后），挂载、切回任务时不同步读 `offsetHeight` / `offsetWidth`，不把被跳过的离屏块强制排版；`Clamp` 在回调里 `flushSync`，夹紧和第一帧一起画出来。本地计时（`use-clock.ts`）按订阅者声明的周期醒，定时器对齐到周期的整倍数：整秒显示的计时每秒醒一次、同屏的一起跳，十分位和 spinner 按各自周期，不让所有人一起高频醒。

**流式不跳动**（硬要求，每条要有测试）：
1. **块级增量渲染**：Markdown 按块解析，已闭合的块渲染一次后冻结（`React.memo`，DOM 节点不重建），只更新最后一个未闭合块；选区、hover、展开状态因此不丢。
2. 歧义前缀延迟一行：行首 `|`、`#`、`>`、`-`、`*`、`1.`、围栏的未完成行，等该行结束再渲染，避免“先是普通文字再变表头”的跳变。
3. 未闭合的行内标记按纯文本显示，闭合时才变样式。
4. 代码块在围栏打开时就以最终样式创建（头部 32px 占位），追加只增高；闭合时只改颜色。
5. 助手消息容器的最小高度流式期间只增不减。
6. 图片/附件/表格有 `aspect-ratio` 或最小高度；不用骨架屏；运行中的过程行在回合开始就占位且高度固定 28。
7. 流式更新节流：IPC 事件在渲染层按 `requestAnimationFrame` 合并；主进程用 `set_event_filter { messageUpdates: "delta" }`（`omp-rpc.md`：默认每帧完整快照，一轮短对话就 550KB）；子代理的 `message_update` 不受此设置影响，v1 只取 `subagent_progress` 级别。**不做**“积压 ≤250ms 追完”的平滑放出。
8. 开启 `overflow-anchor: auto`；已完成消息 `contain: layout paint style`；字体不换入（系统字体，无 FOUT）。

**窗口缩放保位置**：自由态下记录阅读锚点（视口顶部下方第一个可见块的 id 与相对偏移），`ResizeObserver` 观察 `.column`，重排后还原；吸底态保持吸底。列宽 = `min(100% − 2×--gutter, --content-w)`（§3.2）：默认比例下常见窗口宽度时列宽停在下限，缩放不重排；更宽时列宽跟着主区变（上限见 `--content-w-max`），重排后靠阅读锚点补偿。拖对话列右缘（§3.2）：拖动中列宽逐帧变（只改 CSS 变量，离屏块不排版），omp 的列数松手才更新一次。侧栏折叠/抽屉切换：主区宽度**立即变一次**（一次重排 + 一次补偿），不逐帧；拖动侧栏分隔线时对话列跟着主区宽度变（离屏的块有 `content-visibility: auto`，逐帧只排视口附近）；`ResizeObserver` 回调合并到 rAF，不在 `mousemove` 里同步测量。验收：滚到中间 → 窗口宽度 1200→800→1200，锚点块视口偏移变化 ≤2px。

**滚动条与横向溢出**（仓库所有者 2026-10-21；`ui/scrollbars.css` + `ui/scroll-activity.ts`，`main.tsx` 里装一次，组件里没有任何滚动条代码）：
1. 外观：`::-webkit-scrollbar` 宽 `--scrollbar-hit`，滑块 `--scrollbar-thumb-w`（两边透明描边撑出来，`background-clip: content-box`）、`--radius-pill`、颜色 `--scrollbar-thumb`，悬停或拖动时 `--scrollbar-thumb-hover`；轨道、两端按钮、角落全部 `display: none`，没有任何底色。平时滑块透明，滚动时变色，用 `--dur-fade` 淡入淡出（reduced-motion 下也是短淡入，不闪现）。
2. 滚动活动：`document` 上一个捕获阶段、`passive` 的 `scroll` 监听（scroll 不冒泡，捕获才收得到所有容器），给正在滚动的元素挂 `data-scrolling`，停下一会儿摘掉（`ui/scroll-activity.ts`）；已挂着只续期，不重复写属性。不需要每个组件登记。
3. 不挤内容：滚动条一直占着 `--scrollbar-hit` 的宽度（只有滑块颜色在变），出现和消失不改变内容宽度，阅读列不横移。（Chromium 对 `::-webkit-scrollbar` 没有真正的覆盖模式；只要容器可滚动就占位，这一点和 `OverlayScrollbar` 不同。）要“完全不占位”的容器（`.scroller`、侧栏、设置页、命令面板、下拉列表）继续用 `OverlayScrollbar` + `scrollbar-width: none`。
4. **不要在组件里写 `scrollbar-width: thin` 或 `scrollbar-color`**：Chromium 里它们不是 `auto` 时整套 `::-webkit-scrollbar` 失效。`scrollbar-width: none` 只用于自绘滚动条的容器和不要滚动条的标签条。
5. **横向滚动条一律不画**（`::-webkit-scrollbar:horizontal { display: none }`）。能折行的先折行，不能折行的容器仍可用 Shift+滚轮 / 触控板横滑，但看不到条。逐处决定：
   - 折行（本来就折）：对话里的代码块与工具卡输出、门里的预览、设置里的 JSON 与原文输出、omp 安装详情、TSP 的 diff 行和工具卡里的 `code`（`.tsp-tool-body .tsp-code` 一律 `pre-wrap`）。
   - 评审 diff：有自己的 `折行` 开关，默认开；关掉时每个 hunk 自己横向滚动（行不折，hunk 头和评论框贴左），无条。
   - 不折、无条、可横滑：Markdown 表格（整词不拆，单元格里不带空格的文件名、路径在 `_` `/` `\` `.` 后可折行，免得一个长文件名把别的列挤成一词一行，`.md-table`）、KaTeX 块级公式、TSP 的 ANSI 行（`.tsp-rows`，列对齐，折了会错位）和 TSP `code` 节点没有 `wrap` 时、用量热力图（`usage-scroll`）、评审的标签条。
   - 其余 `overflow: auto` 的容器内容本身折行，实际只有纵向滚动。
6. 验收（800×600 窗口）：走新任务页、TSP 对话（edit / eval 卡）、设置全部分节、命令面板、终端，断言页面自身 `scrollWidth <= clientWidth`，且没有任何元素下沿被横向滚动条占高（`offsetHeight − clientHeight − 边框 = 0`）；滚动时 `data-scrolling` 出现、停后消失，且元素 `clientWidth` 不变。

## 5.5 新任务与项目

1. `Ctrl N` / `新任务` → **草稿任务**：主区显示 §4.7，主区头标题 `task.untitled`，侧栏顶部出现临时行；**此时不启动 omp 进程**。项目一律是默认文件夹（不沿用当前或最近的项目）。
2. 草稿期间可换项目（侧栏文件夹头 `＋`、`打开文件夹`、拖入文件夹）、可改模型/思考/审批；发送后项目不可换。
3. **发送第一条消息 = 创建任务**：主进程用 `omp`（伪终端里的交互式 omp，TSP，不传 `--approval-mode`，§5.8）起进程，等输入框就绪后用 `send` 事件提交第一句话（`TspRunner.sendPrompt`）。用户消息乐观上屏（`first-prompt-store`），omp 回显后接上；握手期间状态行显示 `composer.status.starting`；失败走 §4.24。
4. 离开草稿时输入为空则丢弃，不留空任务；同一文件夹可并行多个任务（各一个进程）。
5. 文件夹头 `＋` 与 `Ctrl Shift N` 直接在该项目下新建。

## 5.6 会话历史

历史来自 `~/.omp` 的只读扫描（主进程）[推测：RPC 没有“列出会话”命令]，渲染层只拿到 `{id, title, projectPath, updatedAt, status}`。点击历史会话或休眠任务：主进程立刻拉起 omp 并用 `--resume` 恢复该会话（`TaskPool.resume` / `openTask`），不等第一次发送；启动期间状态行显示 `composer.status.starting`；会话对应的目录已不存在时恢复失败，弹 toast `history.resumeFailed`。恢复的任务和新任务一样，用启动时 omp 配置里的审批模式。

## 5.7 通知（只有“等你确认”会叫你）

任务进入 `await` 且它不是当前窗口正在看的任务，或窗口未聚焦：① 侧栏菱形 + 提示条；② 任务栏闪烁（`win.flashFrame(true)`，聚焦后停止）+ 覆盖角标数字；③ 窗口未聚焦且 omp 的 `ask.notify` 为 on → 一条系统通知，标题 `notify.title`，正文 `notify.body.gate`，点击聚焦窗口并跳到该任务；④ 窗口聚焦但在看别的任务 → 顶部气泡 toast `toast.needsYou`（不抢焦点）。不播声音。任务完成：侧栏转圈停下，不画完成对勾（仓库所有者定，2026-11-09），窗口可见时**不发通知**；例外是窗口隐藏在托盘或最小化时，跑完 / 出错按 omp 的 `completion.notify` / `error.notify` 发（用户看不到窗口，见 `docs/architecture/background-run.md`）。

## 5.8 审批模式（完全跟随 omp 的配置）

**核实（`omp://approval-mode.md`、`omp://settings.md`，`omp config list` 的 enum 选项实测 omp 18.12.5）**：四种模式 `always-ask`（读自动；写、执行询问）、`always-ask-cached`（omp 界面叫 Ask and remember：读文件、写、执行都询问，批准时可记住文件或文件夹；记住的批准可用 `/forget-approvals` 清掉）、`write`（读写自动；执行询问）、`yolo`（全自动）。配置项 `tools.approvalMode`，**omp 默认 `yolo`**。omp 在进程启动时读一次；文档里没有运行中切换的 RPC。

**设计**（仓库所有者 2026-10-18 定：审批模式完全按 omp 的设置来，omp-studio 不另设一层）
1. **启动时从不传 `--approval-mode` / `--yolo` / `--auto-approve`。** omp 用配置里的 `tools.approvalMode`；没设置过就是 omp 的默认 `yolo`，此时不会出现审批门。`tools.approval.*` 与 `bash.patterns` 由 omp 按文档规则叠加，我们不改。
2. **ApprovalChip 显示 omp 对这个项目目录实际生效的值和来源**：项目 `.omp/config.yml` 设了 `tools.approvalMode` 就盖过全局（实测 18.12.5：全局 `write`、项目 `always-ask-cached`，在项目目录里 `omp config list --json` 给 `always-ask-cached`；omp 只看 cwd 下的 `.omp/config.yml`，不找父目录）；没设置过显示 omp 默认值。主进程 `getApprovalMode(projectId)` 在项目目录里跑 `omp config list --json` 取值，来源 = 项目文件有没有设这一项（只读解析，`omp-config/approval-mode.ts`）；草稿和任务都按它的项目取（无项目的聊天只看全局）。来源写进悬停提示 / `aria-label` 的最后一段（`approval.sourceProject` / `approval.sourceGlobal`），不加新的行。读到之前先用上次读到的全局值（启动缓存，见 §4.14；项目覆盖的值不进缓存），从没读到过时胶囊是图标 + 骨架条。全局快照（`config-store.ts`）里的值变了会重读，设置页和胶囊一致。
3. **在胶囊里选一个模式 = `omp config set tools.approvalMode <模式>`**（写入只经 omp，`docs/architecture/omp-boundaries.md`；改的是用户全局配置，终端里的 omp 也跟着变）。**项目 `.omp/config.yml` 设了这一项时不可改**：omp 没有写项目层的命令（实测 18.12.5，在项目目录里 `omp config set` 仍写全局并提示被项目覆盖），studio 也不自己改项目文件，所以四档灰显，菜单顶上一行写 `approval.projectLocked`。之后启动的任务生效，已在运行的任务要重启；弹层里不写这段说明。
4. **外观**（图标 + 模式名，`direction-3.2.md` §7 第 10 条）：`.ui-chip`（§4.23，同其它胶囊）；一个线性图标（`always-ask` = 盾牌 `Shield`，`always-ask-cached` = 带勾的盾牌 `ShieldCheck`，`write` = 铅笔 `Pencil`，`yolo` = 划掉的盾牌 `ShieldOff`；`yolo` 不用闪电：和输入框上方后台任务药丸的图标撞，意思也不对；几何在 `icons.tsx` 的 `*_NODE`；换档时图标从上一档形变过去，§2.6）+ 模式名（`.chip-mode`：`approval.alwaysAsk` / `approval.alwaysAskCached` / `approval.write` / `approval.yolo`，没读到档位时一条 `.ui-skeleton` 骨架条），没有 `⌄`；完整名称 `审批模式 · {档位名} · {来源}`（`approval.title` · 档位名 · `approval.sourceProject` / `approval.sourceGlobal`，来源没读到前不写）放在悬停 `title` 和 `aria-label`；`yolo` 时胶囊的图标和文字用 `--st-waiting-text`（`data-tone="warning"`，不铺底色）。点开是胶囊上方的 `Popover`（项目锁定、顶上多一行说明时加宽），里面是 `ui/MenuList` 选择菜单（§4.23 Menu）：四档，当前项第一列画 ✓，每档的描述（`approval.desc.*`）只放在这一项的悬停提示里，菜单里不写第二行（四行说明是多余的字）；分隔线后一项「清除已记住的批准」（`approval.forget`，悬停提示 `approval.desc.forget`）：给当前任务的 omp 会话发 `/forget-approvals`（`sendPrompt`，`whenBusy: "followUp"`，同 `/retry` 的做法；实测 18.12.5 rpc-ui 下会回一条 `command_output` “Remembered approvals forgotten; the next read or write asks again.”，显示在对话流里）。清的是整个 agent 目录的批准库和所有会话的临时批准，和模式、项目无关。草稿里、以及还没发过消息的任务里这一项灰显，第二行写 `approval.forgetUnavailable`（任务标题为空时发斜杠命令会被当成标题）。打开时焦点落在当前项，↑↓ / Home / End 在项之间移动（灰显项也停留，原因要能读到），Enter 选，Esc 关闭。
5. 在胶囊里把模式切到 `yolo`：首次在同一个 `Popover` 里换成确认（`kind="confirm"`：标题 `approval.yoloConfirmTitle`、正文 `approval.yoloConfirmBody`、`common.cancel` + 危险样式主按钮 `approval.yoloConfirmYes`（`danger-solid`：后果是不再询问就执行命令），`approval-yolo-confirm`），确认后记住（`StudioSettings.yoloConfirmed`）。omp 本身默认就是 `yolo` 时不弹（没有"切换"动作）。

## 5.9 无障碍

- 对话区 `role="log"`，流式期间 `aria-busy="true"`、**不逐字播报**；轮次结束时一次性更新 live region 为 `a11y.done`（结论首句）。
- 门（审批卡、提问对话框）是 omp 的 TSP 节点，studio 不给它加 `alertdialog`；出现时任务变 `needs_you`，侧栏状态、提示条和通知照 §5.7。
- 状态点有 `aria-label`（§4.1）；侧栏列表 `role="tree"`/roving tabindex；侧栏拖拽条 `aria-label=a11y.resizeSidebar`。
- `forced-colors: active`：状态点靠形状仍可辨；选中行加左 2px 条；边框用 `CanvasText`。
- 所有颜色对比见 §2.5。

---
