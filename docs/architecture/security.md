# Electron 安全、日志脱敏和私人信息

渲染进程被注入脚本就等于在用户电脑上执行任意代码，以下规则不因"方便"放宽。能机械检查的已经交给 oxlint（`.oxlintrc.json`）或 `scripts/check.ts`（`npm run check`、git hook、发版脚本都跑它；报错格式 `路径:行: <检查 id>: 说明`），每条后面注明；其余靠评审。

## 窗口和页面

- `BrowserWindow` 一律 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`，不开 `webviewTag`，不关 `webSecurity`（`browser-window-flags`）。CSP 严格：不允许内联脚本和 `eval`，不从网络加载脚本。
- 页面只从 `app://studio/` 加载；禁止窗口内导航到外部地址和新开窗口（`will-navigate`、`setWindowOpenHandler`）。
- 例外只有右栏浏览器面板（仓库所有者 2026-10-28 批准）：外部网页放在主进程的独立 `WebContentsView` 里（`sandbox`、`contextIsolation`、独立分区、拒绝所有权限、只放行 http/https），不和应用页面同一个 webContents、拿不到 preload；给 omp 的 CDP 口只听 127.0.0.1、校验 Host、拒带 Origin 的请求、路径带随机 token。见 [browser.md](browser.md)「安全」。

## preload 和 IPC

- preload 只暴露一个函数做一件事（如 `sendPrompt(taskId, text)`），不暴露 `ipcRenderer`，不暴露"执行任意命令""读写任意路径"。
- 例外只有内置终端（`writeTerminal`）：只作用于已存在的任务、cwd 由主进程定、输入限长。输入框里的 `!命令` 原样作为消息 `send` 给 omp，由 omp 自己处理；不新增"起一个指定命令的进程"的接口。
- 渲染进程传来的一切都不可信：每条 IPC 校验参数，任务 id 必须存在，路径必须在任务目录或该任务经 omp `/add-dir` 加入的工作区目录之内（根目录由主进程按下标给出，渲染进程不传绝对根路径；2026-10-21 仓库所有者批准）。任务状态以主进程为准，渲染进程只显示。

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
- CHANGELOG 和提交信息里不写第三方客户端或插件的名字，只说用户得到的能力（"账号额度可见""客户端账号可登录"）：更新日志显示在应用里、提交信息推到公开仓库，事后改要改写历史。名单在 `.githooks/no-mention.local.txt`（gitignore），commit-msg hook（`commit-msg-mention`）和发版脚本（查「未发布」，`changelog-mention`）按它查。
- **提交身份**：提交邮箱是 GitHub 的 noreply 地址 `165480087+DawnJson@users.noreply.github.com`（仓库级 `git config user.email`，仓库所有者 2026-10-25 定），tag 用同一个身份。不能用全局配置里的私人邮箱；`.githooks/pre-commit` 会拦。hook 由 `npm install` 时的 `scripts/postinstall.ts` 启用（`git config core.hooksPath .githooks`），没启用时上面这些提交前的检查都不会跑。

## 安装包里只有应用本身

`electron-builder.yml` 的 `files` 只列 `out/`、`package.json` 和运行时依赖。`npm run dist` / `dist:mac` / `dist:linux` 之后，`scripts/check-package.ts` 会检查 `app.asar`，不过就让打包失败，不能跳过。改 `files` / `asarUnpack` / 平台段之后看一次 `app.asar` 里实际有什么，关于 electron-builder 配置怎么合并的说法不看产物不信（平台级 `files` 会整个顶替顶层，0.4.16 因此带上了 `.env` 和全部源码，见 [mac.md](mac.md)「打包」）。
