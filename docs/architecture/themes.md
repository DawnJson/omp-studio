# 配色主题、主区背景图、毛玻璃

设置 → 通用 → 外观。界面规则见 `docs/design/spec.md` §2.1、§4.19。

## 主题

- 登记表 `src/shared/themes.ts`：主题名（= 设置里存的值，也是 `<html data-theme>` 的值）、深浅、顶栏色（`--bg-sidebar`）、三键符号色（`--text`）、遮罩色（`--bg-scrim`）、有没有插图。排列顺序就是主题画廊的顺序。主进程和渲染进程都 import 它。
- 颜色：浅色、深色在 `src/renderer/styles/tokens.css`，其余在 `themes.css`。每个主题一块 `[data-theme="<名字>"]`，**不带 `:root`**：画廊的预览块挂同样的 `data-theme`，子树里就地用那一套变量，不用另存颜色。浅色块同时是 `:root` 的默认值；跟随系统 = `<html>` 上没有 `data-theme`，系统深色时 `@media (prefers-color-scheme: dark) :root:not([data-theme])` 套深色（和显式深色块逐行一致）。
- `test/themes.test.ts` 核对：每个主题声明的变量集合和浅色块相同（漏一个会悄悄退回浅色的值）；文字、状态色、代码色、图表色的对比度达到 spec §2.5；登记表里的顶栏色、遮罩色、深浅和 CSS 一致；有插图的主题图文件在。
- `--accent-glow`：强调色上的静态发光（开关、选中指示、焦点环），只有炫酷类主题给值，其余是 `none`。不做动画（空闲时也会占 CPU，见 [performance.md](performance.md)）。
- Dracula、Tokyo Night、Catppuccin、Nord、Rosé Pine 的配色取自各自的 MIT 调色板，为对比度微调过；许可证 `src/renderer/styles/themes-LICENSE.txt`，打包进 `resources/licenses/theme-palettes-MIT.txt`。鲸蓝两套只取 DeepSeek 式的蓝色调，不用它的名字和鲸鱼标志。

### 主进程

- `nativeTheme.themeSource`：`system` 原样；具名主题按登记表的深浅给 `light` / `dark`（`settings-store.ts` 的 `themeSource()`）。omp 的 `{ev:"theme", dark}`、网页的 `prefers-color-scheme` 都跟着 nativeTheme，omp 只知道深浅。实测（omp 18.14.0，2026-10-30，真实模型）：选鲸蓝·深后 `nativeTheme.shouldUseDarkColors` 为 true（TSP 会话的 appearance 取它），一轮 prompt 跑完；同一任务切到樱粉（浅）再发一轮照常。
- 窗口底色、系统三键的底色和符号色取登记表（`main-window.ts` 的 `overlayColors`）；有遮罩弹窗时三键色 = 顶栏色叠一层该主题的 `--bg-scrim`。两个同为深色（或同为浅色）的主题之间切换时 nativeTheme 不发 `updated`，所以设置变化时也重算。

## 主区背景图

设置 `backdrop`（`theme` 主题插图 / `custom` 自选图片 / `none`）、`backdropStrength`（`low` / `medium` / `high`）、`customBackdrop`（文件名或 `null`）。

### 存储和校验（`src/main/settings/backdrop-image.ts`）

- `chooseBackdropImage`：`dialog.showOpenDialog` 挂主窗口，单选，过滤 png / jpg / jpeg / webp / gif / avif；取消返回 `false`。
- 先 `stat`，超过 `limits.backdropMaxBytes`（20 MB）不读就拒绝；读进来后按扩展名对应的文件头核对内容（扩展名不可信）：PNG 8 字节签名、JPEG `FF D8 FF`、GIF `GIF87a`/`GIF89a`、WebP `RIFF....WEBP`、AVIF 是 ISO BMFF 的 `ftyp` 盒、主品牌或兼容品牌里有 `avif`/`avis`。内容和扩展名对不上（文本改名 `.png`、PNG 改名 `.jpg`）一律拒绝。错误原文是英文，`src/shared/ui/errors.ts` 映射成 `error.backdropTooLarge` / `error.backdropNotImage`，界面弹 toast。
- 存到 `userData/backdrops/<内容 sha256>.<png|jpg|webp|gif|avif>`（`jpeg` 规范成 `jpg`），和 `src/shared/ipc.ts` 的 `backdropFilePattern` 一致；同一张图再选还是同一个文件。二进制内容自己写临时文件，改名用 `renameWithRetry`（`writeFileAtomic` 只收文本）。
- 之后 `updateSettings({ customBackdrop, backdrop: "custom" })`；原来的 `customBackdrop` 和新的不同就删掉（只删 backdrops 目录里、文件名匹配 `backdropFilePattern` 的那个）。设置里只引用一张，所以换图后旧图一定没人用了。

### 协议（`src/main/window/app-protocol.ts`）

- `app://studio/@backdrop/<文件名>` → `userData/backdrops/<文件名>`。文件名取原始路径（不解码），必须整个匹配 `backdropFilePattern`（小写十六进制 64 位 + 图片扩展名），不允许子目录、`%2f`、`..`；否则 404。
- `app://studio/@backdrop/../x` 在 URL 解析时就被折叠成 `app://studio/x`，落到 renderer 目录的规则里，读不到 userData。
- 文件不存在（被删的旧图、拼错的资源名）回 404：`net.fetch` 对不存在的 file:// 是 reject（`net::ERR_FILE_NOT_FOUND`，Electron 44 实测），协议处理里 catch 后确认文件确实不在才回 404，别的错误照常抛。
- CSP 不用放宽：`img-src 'self'` 就是 `app://studio`。

### 图层（`App.tsx`、`app.css`）

- `App.tsx` 在 `<main className="panel">` 上挂 `data-backdrop="theme" | "custom"`（不画时不挂）和 `data-backdrop-strength`。`theme` 只在 `themes[resolveTheme(theme, 系统深浅)].art` 为真时挂（跟随系统 = light / dark，没有插图）；`custom` 要求 `customBackdrop` 匹配 `backdropFilePattern`，再内联 `--bd-image: url("app://studio/@backdrop/<文件名>")`。
- `.panel[data-backdrop]` 的 background 从下往上：底色 `--bg-app` → 图（`--theme-art` 或 `--bd-image`；`cover`、靠右下、不平铺）→ 一层纱 `color-mix(in srgb, var(--bg-app) <浓度>, transparent)`。不在面板里另加图层元素（层叠顺序会压住内容）。
- 纱的三档按"图上最亮 / 最暗的一点上正文仍然好读"定：拿每个主题的 `--text`、`--bg-app` 算图是纯白或纯黑时正文的对比度（2026-10-30）：
  - `high` 75%（图最明显）：除 catppuccin-latte（3.9:1）外都在 4.5:1 以上；
  - `medium` 82%（默认）：全部在 4.7:1 以上；
  - `low` 90%（图最淡）：全部在 5.6:1 以上。
  主题自己的插图是按主题配色画的，实际比纯黑纯白温和得多。

### 面板里哪些层透明、哪些照旧盖住图

- 对话区（`.tsp-view`、`.tsp-surface[data-mode="inline"]`、`.tsp-scroller`、dock）、空状态（`.empty`）、设置页（`.settings`）本来就没有底色，直接透出面板的图。设置页透出图是有意的：外观里调浓度、换图能当场看到效果。
- 改了一处：`composer.css` 输入框上方的淡出渐变 `.composer-stack::before`（`linear-gradient(transparent, var(--bg-app))`）在 `.panel[data-backdrop]` 下不画。渐变尽头是实色底，会在输入框上方横出一条盖住图的带子；有背景图时对话内容在滚动区下沿直接截断。
- 照旧不透明、盖住图的：omp 的 screen surface（`.tsp-surface[data-mode="screen"]`，如 `/settings`）、omp 的偏好设置页（`.tspi-prefs`）、评审（`.review` 是 body 上的覆盖层）、omp 安装页（`.omp-setup`），以及输入框、卡片、终端这些自带底色（`--bg-raised` 等）的块。右栏的文件 / 浏览器面板在 `.panel` 之外，不受影响。
- 半透明的照旧：omp 弹出选择器下面的遮罩（`interactive.css`，`--bg-scrim` + 40% 应用底色）、上下文条的斜纹（`.tsp-mt-part.hatch`）。

## 毛玻璃

设置 `glass`（只在 `AppInfo.glassSupported` 时显示开关）。顶栏、侧栏、主区面板四周的窗口底色透出系统的 Acrylic，主区面板 `.panel` 仍是实底（或背景图）。mac 的 vibrancy 不做，Linux 没有。

### 做法

- `glassSupported`（`main-window.ts`）：win32 且 `os.release()` 的 build ≥ 22621（Windows 11 22H2）。Electron 的 `setBackgroundMaterial` 在更早的系统上直接返回（源码 `native_window_views.cc` 判 `WIN11_22H2`），开了也没效果。
- 窗口：`glass && glassSupported` 时创建就带 `backgroundMaterial: "acrylic"`、`backgroundColor: "#00000000"`；运行时开关在设置变化时 `setBackgroundMaterial("acrylic" | "none")` + `setBackgroundColor(...)`，不重建窗口。`"none"` 时 Electron 把窗口和网页底色重置成白色，所以紧接着设回顶栏色；`"acrylic"` 时 Electron 自己把底色设成透明，我们再设一次透明（主题切换走同一个 `windowBackground()`）。
- 系统三键区：毛玻璃时底色 `#00000000`，三键画在网页上面，透出网页的顶栏层；遮罩弹窗时网页的遮罩本来就盖到三键底下，所以只有符号色还随 `fadeTitleBar` 渐变。
- 网页：`<html data-glass>`（`App.tsx`）。`html`、`body`、`.topbar`、`.sidebar-column`、`.sb` 透明，只在 `#app` 上铺一层 `color-mix(in srgb, var(--bg-sidebar) 75%, transparent)`（`app.css`）；几层各自半透明会越叠越深、和三键区对不上。收起的侧栏 / 窄窗口抽屉盖在主区面板上，照旧画实底 `--bg-sidebar`。侧栏历史标题行平时钉在滚动区顶部（sticky + 实底），毛玻璃时不钉住、跟着列表滚走：实底是一条色带，`backdrop-filter` 把 `#app` 那层半透明色又叠一遍，同样是一条更深的带子（见下面实测）。

### 实测（2026-10-30，Electron 44.10.0，Windows 11 build 26300，独立小脚本截屏，脚本已删）

- `titleBarStyle: "hidden"` + `titleBarOverlay` + `backgroundMaterial: "acrylic"` + 透明底色：顶栏、侧栏透出模糊的背景，主区实底不受影响。
- 三键区底色给带 alpha 的侧栏色（如 `#1e1e2e99`）：比网页顶栏深一截、按钮之间有缝。源码里 `WinCaptionButtonContainer::UpdateBackground` 先铺整块底色，`WinCaptionButton::OnPaintBackground` 每个按钮再铺一次，alpha 叠了两次。全透明（`#00000000`）时和网页顶栏完全一致，网页遮罩也盖到三键底下。
- `setOpacity`：窗口先 `setOpacity(0)` 再逐步到 1（应用的淡入就是这样），到 1 之后 Acrylic 正常；`setOpacity(0.5)` 时 Acrylic 不画，玻璃部分直接透出后面清晰的窗口。所以淡入的 320ms 里玻璃部分是"半透明的清晰背景"，到 1 才变成毛玻璃（一跳）。
- 运行时开关：先不带材质创建（实底）、`setOpacity` 淡入后再 `setBackgroundMaterial("acrylic")`，立即生效；`"none"` + 设回底色立即回到实底；再开又生效。不用重建窗口。
- 最大化、还原、改窗口大小之后 Acrylic 都还在（最大化后窗口边界 -8，和平时一样）。
- 窗口失去焦点：Acrylic 换成系统的纯色兜底（深色时偏灰，浅色时浅灰），再叠 75% 的侧栏色，文字照样清楚。
- 浓度：60% 时彩色背景透得多、浅色主题文字发虚；75%、80% 都清楚，取 75%。
- 完整应用（前台窗口，假 omp 回放，Catppuccin Mocha / 樱粉 / 浅色）：顶栏和三键区同色无缝；命令面板的遮罩盖到三键底下；窄窗口抽屉实底；最大化、失焦、关掉毛玻璃后回到实底（窗口底色 `#EFEFED`）都正常。唯一的问题是侧栏"会话"标题行带 `backdrop-filter` 时比侧栏深一截，改成不钉住后消失。

### 推测、没实测

- e2e：后台模式的窗口被 DWM cloak，系统不画它，拍不到 Acrylic，所以毛玻璃没有 e2e。cloak 对 backdrop 本身没影响（推测）。
- 系统"节电模式"开着时 Acrylic 不画、只剩灰色兜底（electron/electron#48031 的报告，本机没开节电模式试）。
- Windows 设置里关掉"透明效果"时同样只剩兜底色（推测）。
- 22621 ≤ build < 26300 的机器没试过；Electron 源码按 22H2 判断，按理一样。

参考：[BrowserWindow `setBackgroundMaterial`](https://www.electronjs.org/docs/latest/api/browser-window#winsetbackgroundmaterialmaterial-windows)（Windows 11 22H2 起）、[electron/electron#47386](https://github.com/electron/electron/pull/47386)（修好运行时切换和最大化）、[#48031](https://github.com/electron/electron/issues/48031)（失焦 / 节电模式下的兜底色）。
