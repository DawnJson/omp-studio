# 3. 布局

## 3.1 窗口

- `BrowserWindow`（`main/window/main-window.ts`）：`titleBarStyle: "hidden"`，Windows 用 `titleBarOverlay`（颜色取值见 §2.1），`backgroundColor` 同它；有默认尺寸和最小尺寸；`Menu.setApplicationMenu(null)`，快捷键用窗口内 `keydown` 处理。窗口图标 `resources/icon.ico`（见下方"标志"）。
- **macOS**（仓库所有者定，2026-10-25；只写代码、没有在 mac 上实测）：① 标题栏：不传 `titleBarOverlay`（Electron 只在 win32/linux 提供，`setTitleBarOverlay` 在 mac 上不调用），用 `trafficLightPosition` 把系统红黄绿三键摆在顶栏里垂直居中（推算值，需真机微调）；三键随遮罩变暗（`setTitleBarDimmed`）在 mac 上是空操作，`setTitleBarTheme` 只换窗口底色；窗口不传 `icon`（Dock 图标来自 app bundle）。② 应用菜单：`appMenu` + `editMenu` + `windowMenu` 三个 role 菜单，为的是 ⌘C/V/X/A/Z、⌘Q/H/M/W 能用；⌘Q 走 `app.quit()` → `before-quit` → `window/shutdown.ts` 的退出流程，⌘W 触发窗口 `close`，被 `hide-on-close.ts` 拦成隐藏。③ 关窗口只隐藏、应用留在 Dock；菜单栏图标（托盘）用模板图 `resources/trayTemplate.png`（只看 alpha，系统按菜单栏明暗着色），设了菜单后左键也弹菜单（推测），第一项"打开 omp-studio"找回窗口；点 Dock 图标走 `activate`。首次隐藏的通知说"菜单栏"而不是"托盘"（`notify.tray.stillRunning.*Mac`）。④ Dock 图标不显示任务进度：`setProgressBar` 的 `mode` 只在 Windows 有效，mac 上没有"不定进度"的对应形态，用固定值会被当成真进度。
- **标志**（仓库所有者选定"层叠"，2026-10-20）：omp 终端启动画面的块字符 π（逐格粉→紫→蓝，颜色与主题无关），身后往右下错开 1 像素再叠一层同色淡影——终端里的 π 只有一层，到了桌面上多一层。数据只有一份：`src/shared/ui/pixel-pi.ts`；渲染进程 `ui/PiMark.tsx` 画 SVG（`shape-rendering: crispEdges`），整幅标志（π + 像素字 `omp studio`）是 `ui/PixelLogo.tsx`，新任务页和顶栏左上角用同一个组件，只是大小不同。应用图标 `resources/icon.ico`（仓库所有者定，2026-10-21：透明底、不要深色底，只有 π 和淡影且淡影要和界面里一样看得出两层，尽量铺满宽度别显小；多个尺寸每个单独画，能整数倍就整数倍）和托盘图标 `resources/tray.png` 由 `npm run icons`（`scripts/make-icons.ts`）从同一份数据生成并提交进仓库；改了 π 要重新生成。
- **顶栏 = 任务条**（通栏，高 `--titlebar-h`；仓库所有者 2026-10-19 选定方案 B「任务条 + 工具区」）：底色 `--bg-sidebar`（与 `titleBarOverlay.color` 相同，系统三键融进同一条）。控件统一 `--control-h-sm` 高。三段：
  - 左段（宽 = 侧栏宽，侧栏收起/抽屉时自适应）：标志（`topbar-brand`，`PixelLogo`，不带版本号；顶栏里像素字往下挪半格（`.topbar-brand .pixel-logo-text`），基线对上旁边标题的拉丁字母、x 高中线对上侧栏按钮的图标），只是标识，不可点、可拖动窗口；切换侧栏按钮（`IconButton` `topbar-sidebar`，`aria-expanded` = 侧栏显示着，展开时 `--bg-active` 底，同 `Ctrl B`；图标形变（§2.6）：侧栏显示时窗框里有左栏分隔线，收起时分隔线滑进窗框左边；侧栏宽度收起/展开有短过渡，拖拽调宽时关掉）。
  - 顶栏没有信息（i）按钮（`direction-3.2.md` §7 第 5 条）："关于与反馈"对话框（`AboutDialog`，照 macOS 标准关于面板、Chrome、VS Code 的关于框，只留有用的）从命令面板的 `about` 命令（`window.about`，§4.18）打开：`ui/Dialog` sm，标题 `shell.appName`，正文一行：左边 π 标志（`PiMark`），右边竖排版本号 · `window.aboutOmp`（omp 没就绪时 `window.aboutOmpMissing`；可选中）；安装版再多一行更新状态（与设置 → 关于同一句话），可检查时跟"检查更新"，新版本已下载时跟主按钮"重启并安装"（同样走 §4.5 的安装规则），开发版、免安装版、没配更新源时这一行不显示；页脚右对齐两个次要按钮：`window.aboutCopyInfo`（复制给报问题用的纯文本：omp-studio、omp、Electron、Chromium、Node、OS 的版本，标签固定英文，不带 omp 路径）、`window.aboutReportIssue`（打开 Issues 选模板页）。焦点和关闭按 `ui/Dialog` 通则（§4.23）。日志文件夹和导出诊断在设置 → 关于 → 问题排查。新任务和设置在侧栏，命令面板 `Ctrl K`，退出走系统三键。语言和主题只在设置 → 通用 → 外观（§4.19）。
  - **macOS 的顶栏**（`html[data-platform="darwin"]`，`app/app.css`）：红黄绿三键在窗口**左上角**，所以左段左侧留出三键的宽度（推算值，没有在 mac 上实测，算法见 `app.css` 注释），顶栏右侧不给系统三键让位（mac 没有 `titleBarOverlay`，`env(titlebar-area-*)` 的取值不可信，不用）。**全屏时系统会隐藏三键**，这里不处理（左边多一段空白，无害）。窄窗口 / 侧栏收起时左段宽度 auto，同样先留这段。e2e `mac-keys.e2e.ts` 在 Windows 上用 stub 的 `getAppInfo`（`platform: "darwin"`）验证这条留白和窄窗口中英文不越界。
  - 中段（左缘对齐主区面板）：**只有任务标题**（过长省略，悬停提示完整标题；中文落到常规字重，不做整屏最显眼的字；不显示项目名，项目在侧栏分组里）。没有状态胶囊：侧栏任务行的状态图标和输入框上方的状态行已经在说，不重复。空状态显示 `新任务`，设置页显示页面标题。
  - 右段（只在对话页出现，任务和新任务草稿都有，`data-testid="topbar-tools"`），从左到右：
    - 分支胶囊（`features/git/GitTools.tsx`；等宽字，内容 分支图标 + 分支名 + worktree 任务领先时 `↑N` + ⌄）；分支有 PR 时胶囊右边多一个 `#12` 徽标按钮（`git-pr-badge`；PR 号来自 omp 标题后缀 `TaskState.prNumber`；点击用系统浏览器打开 PR）；点开是 Git 菜单（§4.25「git 菜单与对话框」；不重复顶栏评审按钮；破坏性项永远放最后；再点胶囊、点窗口任意处（含顶栏空白拖动区，菜单开着时 `.git-menu-scrim` 盖住整窗并设为 no-drag）、Esc 都收回，Esc 把焦点还给胶囊）；"分支 · Worktree · 基于 main · 领先 N 个提交"在悬停提示里；窄窗口只留图标和 `↑N`；任务目录不是 git 仓库时不渲染。
    - **新任务草稿**的分支胶囊（仓库所有者定，2026-10-22：worktree 开关放在这里，不在输入框工具行）：草稿项目正好是 git 仓库根时（`getDraftGit`）显示同样外观的胶囊（`features/git/DraftGitTools.tsx`，`draft-git-menu`）：分支图标 + 项目当前分支 + ⌄，菜单只有一个选择项 `在独立 worktree 里开始`；悬停提示是分支、worktree 的一句说明，有 setup 脚本时再加 `创建时会运行 .omp-studio/setup.ps1`；勾上后分支名后面多 `→ 新 worktree`。创建被拒绝（没提交、detached 等）后这一项灰显，原因写在它的第二行和胶囊的悬停提示里。默认文件夹和不是仓库根的项目不显示；发出第一句话后由任务的分支胶囊接手。
    - 评审按钮（`topbar-review`，`Ctrl Shift D`；只有任务有，不是 git 仓库时不渲染）→ 文件按钮（`topbar-files`，`Ctrl Shift E`，§4.27）→ 子代理按钮（`topbar-agents`，只有任务有；一直在，没有子代理时打开是空状态，§4.28）→ 浏览器按钮（`topbar-browser`，`Ctrl Shift B`，只有任务有，§4.29）→ 终端按钮（`topbar-terminal`，Ctrl + 反引号）→ 任务菜单 `⋯`（`task-menu`，只有任务有，§4.6）→ 一条竖线，与系统三键隔开。都是 `IconButton`（§4.23），悬停提示带快捷键；文件、子代理、浏览器和终端是开关（`aria-pressed` + `aria-expanded`），按下 = `--bg-active` 底、`--text` 图标。再往右是系统三键（`titleBarOverlay` 绘制）；顶栏 `padding-right` 用 `env(titlebar-area-*)` 让位。
  - **没有后退/前进按钮**（仓库所有者 2026-10-18 确认）：后退/前进在 `Alt+←/→`（mac：`⌘[` / `⌘]`，见 §5.1）和鼠标侧键（button 3/4）。导航历史栈仍在渲染进程。
  - 其余空白全部 `-webkit-app-region: drag`，按钮和任务条 `no-drag`；双击空白最大化/还原（系统行为）。
- **主区面板（"纸面"）**：顶栏下方，侧栏右边。底色 `--bg-app`，1px `--border`，四个角都是大圆角，右边和下边留一圈窗口底色，像一张放在桌上的纸；侧栏收起或作为抽屉时左边也留。面板与侧栏之间不画分隔线。
- 单实例（二次启动聚焦已有窗口）；记忆位置/尺寸/最大化/侧栏宽度/侧栏折叠/历史会话排列（文件夹或时间）/对话列宽度。
- Windows 11 毛玻璃是可选设置（`settings.glass`；做法、实测和限制见 `docs/architecture/themes.md`「毛玻璃」，§2.1）；改相关样式要在前台真窗口里截屏幕上那一块看，`page.screenshot` 和后台 e2e 看不到 Acrylic。

## 3.2 栅格

```
┌─ 顶栏（通栏，--bg-sidebar）─────────────────────────────────────────────────────┐
│ [omp studio] [▯]   {任务标题}        [分支 ⌄] [评审][文件][子代理][浏览器][终端][⋯] │ ─ ▢ ✕
├──────────────────────┬╭───────────────────────────────────────────────────────┤
│ [＋ 新任务   Ctrl N]   ││ .scroller（唯一滚动容器，铺满主区面板）                │
│ ▾ 项目                ││   └ .column：width min(100% − 2×--gutter, --content-w)  │
│   任务行 …            ││ ┌ 底部栈（钉底，同列宽）─────────────────────────────┐ │
│ ▸ 项目                ││ │ [dock：门、排队] [输入框]                           │ │
│                      ││ └──────────────────────────────────────────────────┘ │
│ ⚙ 设置               ││                         主区面板 --bg-app，圆角        │
└──────────────────────┴┴───────────────────────────────────────────────────────┘
```

- 侧栏底色 `--bg-sidebar`，与顶栏连成一片；主区面板 `--bg-app` 带圆角，两者之间不画线。侧栏拖拽条贴在面板左缘，hover 显示 `--border`；双击恢复默认宽 `--sidebar-w`（范围见 `app/shell-store.ts` 的 `sidebarWidthRange`）。
- `.scroller` 铺满主区、滚动条贴窗口边缘；`.column` 在其中居中；底部 padding = 底部栈高度 + 留白（栈高度由 `ResizeObserver` 写入组件私有变量 `--stack-h`）。
- 任务里输入框和它上面的用时、待办行直接放在背景上，没有底色（仓库所有者定，2026-11-10）：对话不被一刀切，而是过程区滚动区自己的底边遮罩（`mask-image`，`tsp.css` `.tsp-scroller`）在状态行上方淡出，淡出高度等于对话列的下边距，滚到底时最后一项不被淡掉。空状态里输入框 sticky 在概览上，仍用 `--bg-app` 渐变让概览从它后面淡出。
- 对话列默认约占主区面板 80%，夹在 `--content-w-min` 和 `--content-w-max` 之间（`--content-w` = `clamp(--content-w-min, var(--content-ratio, 80cqi), --content-w-max)`，定义在 `.panel` 上：自定义属性里的 `var()` 在声明处就替换，放 `:root` 拿不到面板上的比例；`cqi` 相对主区面板 `.panel`，它是 `container-type: inline-size`；用的地方再和 `100% − 2×--gutter` 取小）。默认窗口时列宽是下限，15px 正文下英文约 99 字符/行、中文约 54 字/行。omp 拿到的列数随列宽变（`useColumns` → `resizeTsp`）。
- **拖宽拖窄**（仓库所有者定存百分比，2026-11-09）：对话列右缘一条拖拽条（`features/tsp/ColumnResizer.tsx`，`column-resizer`，`role="separator"`，`aria-valuenow` 是百分比；以列右缘为中线，竖向只跨滚动区，不盖 dock 里的提问卡片；平时看不见，悬停 / 拖动时显示一条线，键盘聚焦时 `--focus-ring`）。列居中，所以列宽变化是拖动量的两倍；像素上下限由 CSS 夹（宽屏上也能拖到下限），存的百分比范围是 `limits.conversationWidthRange`。拖动中只改 `.panel` 的 `--content-ratio`（不写 store，不重渲染），`useColumns` 不发 `resizeTsp`，松手量一次（omp 整篇重排一次）并写 `window-state.json` 的 `shell.conversationWidth`（占主区宽度的百分比；null = 默认，越界读成 null）。双击回默认；聚焦后 ←/→ 按步长移动右缘。窗口放大缩小时列宽按存的比例跟着变。列已经最窄、没得拖时不画。只有任务页有拖拽条；新任务页（空状态）同一份宽度，不另放。screen 模式（`/settings` 等 omp 全屏面板）不受影响（`tsp.css` 里另有 `--content-w`）。

## 3.3 响应式

| 窗口宽度 | 行为 |
|---|---|
| ≥1000 | 侧栏常驻固定列；列宽 `min(100% − 2×--gutter, --content-w)`，任务页可拖（§3.2） |
| <1000 | 侧栏默认隐藏，`Ctrl B` 或左上按钮以**覆盖式抽屉**滑出（`--bg-scrim`；点击空白、Esc、选择任务后关闭）；正文不被挤压 |
| 高度 <560 | 输入框最大高度降低 |
| 侧栏折叠（任一宽度） | 侧栏宽 0（不留图标条）；主区头左侧出现同一个 `[≡]` 按钮；任务状态靠任务栏角标补偿 |

---
