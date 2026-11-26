# Electron 安全、日志脱敏和私人信息

渲染进程被注入脚本就等于在用户电脑上执行任意代码，以下规则不因"方便"放宽。能机械检查的已经交给 oxlint（`.oxlintrc.json`）或 `scripts/check.ts`（`npm run check`、git hook、发版脚本都跑它；报错格式 `路径:行: <检查 id>: 说明`），每条后面注明；其余靠评审。

## 窗口和页面

- `BrowserWindow` 一律 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`，不开 `webviewTag`、不开 `nodeIntegrationInSubFrames`（preload 只进主框架，iframe 里没有 `window.studio`），不关 `webSecurity`（`browser-window-flags`）。CSP 严格：不允许内联脚本和 `eval`，不从网络加载脚本；`frame-src` 只放行 `studio-preview:`（下面「文件预览的网页」）和 `http: https:`（下面「回答里的内嵌网页」），`img-src` 除 `'self' data: blob:` 外也只多放行 `studio-preview:`（下面「文件预览的位图」）。
- 页面只从 `app://studio/` 加载；禁止窗口内导航到外部地址和新开窗口（`will-navigate`、`setWindowOpenHandler`）。
- 例外只有右栏浏览器面板（仓库所有者 2026-10-28 批准）：外部网页放在主进程的独立 `WebContentsView` 里（`sandbox`、`contextIsolation`、独立分区、拒绝所有权限、只放行 http/https），不和应用页面同一个 webContents、拿不到 preload；给 omp 的 CDP 口只听 127.0.0.1、校验 Host、拒带 Origin 的请求、路径带随机 token。见 [browser.md](browser.md)「安全」。
- 第二个应用窗口只有桌面宠物（仓库所有者 2026-11-11 批准，[pet.md](pet.md)「安全」）：同样的沙箱 / 隔离 / CSP，只加载 `app://pet/pet.html`（单独的源，见 pet.md「安全」）；preload 是单独的 `pet.cjs`，只暴露 `PetApi`，拿不到 `StudioApi`；主进程的 `pet:*` 通道只认这个窗口的顶层页面。

## 文件预览的网页

右侧预览里的 HTML（项目里的 `.html`、回答里的 html 代码块）要能按用户的“运行脚本”开关跑内联脚本，又不能借此拿到应用的任何权限。`srcdoc` 的 iframe 继承应用页面的 CSP（`script-src 'self'`），脚本永远不跑；为它放宽应用 CSP 等于给整个应用开内联脚本。所以做法同 Claude 的 artifact：独立的源 + sandbox + 改不了的响应头 CSP（仓库所有者 2026-11-10 批准）。

- 协议 `studio-preview`（`src/main/window/preview-protocol.ts`，和 `app` 一起在 `app-protocol.ts` 里登记为 standard + secure，不给 fetch / CORS / bypassCSP）。地址 `studio-preview://<token>/`，token 是 `crypto.randomUUID()`；网页只放在主进程内存里，不写盘。渲染进程经 `registerHtmlPreview(html)` 登记（限 `limits.htmlPreviewMaxChars`）、`releaseHtmlPreview(token)` 放手；主窗口重载或关闭时全部清掉。没登记、放过手的 token，子路径和非 GET 一律 404。
- 响应头 CSP（逐字值在 `preview-protocol.ts`，单测 `test/preview-protocol.test.ts` 逐字守着）：除内联脚本 / `eval` / 内联样式和 `data:`/`blob:` 资源外一律 `'none'`，`connect-src 'none'`、`form-action 'none'`、`base-uri 'none'`，`frame-ancestors` 只许应用自己的源；加 `X-Content-Type-Options: nosniff`。页面自己的 `<meta>` CSP 只能再收紧。不联网是有意的：CDN 上的脚本、图片、字体都加载不了。
- iframe 的 `sandbox` 只在勾了“运行脚本”时给 `allow-scripts`，不给 `allow-same-origin` / `allow-top-navigation` / `allow-popups` / `allow-forms`：页面的源不透明，`parent.document` 抛跨域错误。
- 主窗口的 `will-frame-navigate`（`src/main/window/web-frames.ts` 的 `guardFrames`，单测 `test/web-frames.test.ts`）按子框架现在停在哪里放行：停在 `studio-preview:` 上的只能去 `studio-preview:`、`about:blank`、`about:srcdoc`，预览页面点链接、改 `location` 想换成外部网页时拦下；新开窗口本来就被 sandbox 和 `setWindowOpenHandler` 拒绝。
- e2e `file-preview.e2e.ts`「网页预览：勾选运行脚本后内联脚本跑……」守着：脚本开时跑、关时不跑，`fetch` 外网失败，碰 `parent.document` 抛错。

## 回答里的内嵌网页

omp 把回答里单独一行的 `<iframe src>` 发成 TSP `web` 节点（[tsp-migration.md](tsp-migration.md) §7「web 节点」），studio 在对话里载入那个地址。载入 omp 内嵌的地址经仓库所有者批准（2026-11-26）；除了按地址请求网页，不向外发任何东西。

- 网页（http/https）放在应用页面的 iframe 里（`features/tsp/nodes/web.tsx`）：`sandbox="allow-scripts allow-same-origin allow-forms"`，不给 `allow-top-navigation` / `allow-popups`；`referrerpolicy="no-referrer"`，`allow=""`。网页跑在它自己的源上，和 `app://studio` 不同源，碰不到应用页面；拿不到 preload，权限请求一律拒绝（`security.ts` 只放行主框架）。和应用页面共用默认会话，网页的 Cookie 存在应用的会话里（应用页面自己不用 http Cookie）。
- 导航（`guardFrames`）：停在网页上的框架只能去别的 http/https 网页，换成 `file:`、`studio-preview:`、`app:` 等一律拦；刚建的框架（空、`about:blank`）只能载入网页、预览网页或空白页。改顶层页面被 sandbox 拒绝（抛错），主窗口的 `will-navigate` 也拦。
- 本地文件（`file://`）不直接载入：和回答里的本地图片一样经主进程 `readPreviewFile` 读（只读任务目录和已加入的工作区，有大小上限），是 HTML 才登记成 `studio-preview://`（上面「文件预览的网页」的同一套源、CSP、sandbox），脚本要用户点了之后才放行；读不到就只画静态卡片。
- 焦点在网页里时按键到不了应用页面：主进程 `relayFrameEscape` 在 `before-input-event` 看见焦点在子框架里的 Esc 时发 `frameEscape`，渲染进程据此让网页退回不可交互的状态；不拦这个键。
- e2e `tsp-web.e2e.ts` 守着：网页里没有 `studio` / `require` / `process`，改顶层页面抛错、应用页面不动，导航到 `studio-preview:`、`file:` 被拦，点链接去别的网页照常走。

## 文件预览的位图

右侧预览和回答里的本地位图（png/jpg/gif/webp/bmp/ico）不经 IPC 传内容：主进程不在主线程读整张图、转 base64，`<img>` 直接从协议按流取（`src/main/files/preview-image.ts`）。

- 只有 `readPreviewFile` / `readLinkedPreviewFile` 走完原有校验（`resolveInsideReal` 落在根内、`assertLocalFilePath`、20 MB 上限）后，才把实际路径登记到主进程内存，换来 `studio-preview://<token>/`（`crypto.randomUUID()`）。渲染进程拿不到也传不了路径；没登记的 token、子路径、非 GET 一律 404。
- 取图时再核对：实际路径（`realpath`）和登记时相同、仍是普通文件、不超过上限，读到上限为止；父目录被换成链接、文件被删或变大都 404。
- 响应头 `Content-Type` 按扩展名，加 `Content-Security-Policy: default-src 'none'`、`X-Content-Type-Options: nosniff`、`Cache-Control: no-store`。svg 不走协议，仍是 data URL（源码视图要原文，也不让可带脚本的文档挂在协议地址上）。
- 地址不由渲染进程放手：最多 256 条，超过时丢最早的；主窗口重载或关闭时和网页一起清掉。
- 单测 `test/preview-protocol.test.ts` 守着字节和响应头、未登记 / 清掉的 token、登记后换目录链接、变大超限、条数上限。

## preload 和 IPC

- preload 只暴露一个函数做一件事（如 `sendPrompt(taskId, text)`），不暴露 `ipcRenderer`，不暴露"执行任意命令""读写任意路径"。
- 例外只有内置终端（`writeTerminal`）：只作用于已存在的任务、cwd 由主进程定、输入限长。输入框里的 `!命令` 原样作为消息 `send` 给 omp，由 omp 自己处理；不新增"起一个指定命令的进程"的接口。内置终端用哪个 shell（设置 -> 通用 -> 终端，2026-11-09）只接受主进程检测到的 shell 或主进程文件对话框选的文件（`terminal-handlers.ts`），渲染进程不能传任意路径。
- 渲染进程传来的一切都不可信：每条 IPC 校验参数，任务 id 必须存在，工作区文件读取必须在任务目录或该任务经 omp `/add-dir` 加入的目录之内（根目录由主进程按下标给出，渲染进程不传绝对根路径；2026-10-21 仓库所有者批准）。任务状态以主进程为准，渲染进程只显示。
- 显式文件预览的例外是 `readLinkedPreviewFile`：主窗口可以直接读取工作区以外的单个本机文件，不显示授权或选择框（所有者定，2026-11-16）。主进程只验证任务和本机路径（拒绝网络、设备路径），不枚举目录、不执行文件；文件树、工作区读取和自动本地图片仍受根目录限制。详见 [file-preview.md](file-preview.md)。
- 宠物窗口的通道同理：发送方必须是宠物窗口的顶层页面（`pet-window.ts` 的 `trusted`），参数在主进程校验；它不能调任何 `studio:*` 通道（`assertTrustedSender` 只认主窗口）。

## 不可信内容

- 模型输出、工具结果、文件内容、diff 都不可信：Markdown 用 `markdown-it`（`html: false`）按 token 渲染成 React 元素，不用 `dangerouslySetInnerHTML`（KaTeX 输出是唯一例外，只在 `src/renderer/src/markdown/render.ts`；`inner-html`）；链接只放行白名单协议，用系统浏览器打开。见 [conversation.md](conversation.md)「Markdown」。

## 子进程和原生调用

- 启动子进程不用 `shell: true`，不把用户输入拼进命令字符串，参数一律用数组（`shell-true`）。
- 原生调用用 koffi，只在 `src/main/platform/win32/ffi.ts` 里 `koffi.load`（oxlint `no-restricted-imports`，那个文件除外）。
- 不装 `@oh-my-pi/pi-coding-agent` npm 包，RPC 类型从官方 tag 拷贝（oxlint `no-restricted-imports`，账号扩展目录除外），见 [omp-boundaries.md](omp-boundaries.md)「协议」。
- 依赖写确切版本（`.npmrc` 的 `save-exact=true`）。

## 日志和脱敏

实现见 [logging.md](logging.md)。

- 日志里不出现 API key、OAuth 凭据、登录 token，不成段打印模型请求体和响应体。
- 路径脱敏：家目录、用户名换成占位值。原样写进日志的错误（IPC 错误、omp 的 stderr）也要过一遍脱敏。
- 密钥只放 `.env` 或被 gitignore 的目录；代码、日志、截图、提交信息和回复里不出现明文，截图里的账户信息先打码。

## 私人信息（仓库是公开的）

- 仓库所有者的用户名、电脑名、私人邮箱，以及能认出人的本机路径（带用户名的 `C:\Users\<用户名>\…`、个人目录）都不能写进被跟踪的文件，包括代码、测试、录制（`fixtures/`）、文档、截图、提交信息。测试里要用路径就用占位值（`C:\Users\someone\…`、`E:\work\…`）。截图里只出现测试项目。
- 机械检查：`scripts/check.ts` 的 `private-info` 按 `.githooks/private-patterns.local.txt`（gitignore，每台机器自己维护，一行一个正则）查被跟踪的文件（pre-commit 时 `--staged` 只查暂存的文件），commit-msg hook 查提交信息（`commit-msg-private`）。文件不存在时只打一行警告、跳过这项检查，所以新机器上先把它建好。
- CHANGELOG 和提交信息里不写第三方客户端或插件的名字，只说用户得到的能力（"账号额度可见""客户端账号可登录"）：更新日志显示在应用里、提交信息推到公开仓库，事后改要改写历史。名单在 `.githooks/no-mention.local.txt`（gitignore），commit-msg hook（`commit-msg-mention`）和发版脚本（查 `CHANGELOG.md` / `CHANGELOG.en.md` 的「未发布」，`changelog-mention`）按它查。
- **提交身份**：提交邮箱是 GitHub 的 noreply 地址 `165480087+DawnJson@users.noreply.github.com`（仓库级 `git config user.email`，仓库所有者 2026-10-25 定），tag 用同一个身份。不能用全局配置里的私人邮箱；`.githooks/pre-commit` 会拦。hook 由 `npm install` 时的 `scripts/postinstall.ts` 启用（`git config core.hooksPath .githooks`），没启用时上面这些提交前的检查都不会跑。

## 安装包里只有应用本身

`electron-builder.yml` 的 `files` 只列 `out/`、`package.json` 和运行时依赖。`npm run dist` / `dist:mac` / `dist:linux` 之后，`scripts/check-package.ts` 会检查 `app.asar`，不过就让打包失败，不能跳过。改 `files` / `asarUnpack` / 平台段之后看一次 `app.asar` 里实际有什么：electron-builder 配置怎么合并的说法不看产物不信（平台级 `files` 会整个顶替顶层，曾因此带上 `.env` 和全部源码，见 [mac.md](mac.md)「打包」）。
