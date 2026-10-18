# 内置终端（阶段 6）

状态：**已实现（2026-10-18）。** 对应 `PLAN.md` 阶段 6"xterm.js + node-pty，每个任务的终端在它的 worktree 目录里打开"。界面规格见 `docs/design/spec.md` §4.26，安全边界见 `src/main/AGENTS.md`"Electron 安全"。

标注约定：**实测** = 本机亲手测的，写明版本；**推测** = 没有证据，只是推断。实测环境：Windows 11（10.0.26300）、Electron 44.9.0、node-pty 1.1.0、@xterm/xterm 6.0.0、@xterm/addon-fit 0.11.0、PowerShell 7.6.7（`pwsh.exe`）。

## 组成

| 位置 | 做什么 |
|---|---|
| `src/main/terminal/terminal-manager.ts` | 按 TaskId 管 pty：打开/复用、写、改尺寸、结束。不 import electron 和 node-pty，外部能力从 deps 进来（单测用假 pty） |
| `src/main/terminal/output-batcher.ts` | 输出合并：攒 16ms 或 64KB 发一次 |
| `src/main/terminal/backlog.ts` | 最近 256KB 的回放缓冲 |
| `src/main/terminal/shell.ts` | 选 shell、拼环境变量（纯函数） |
| `src/main/terminal/input.ts` | IPC 参数校验（纯函数） |
| `src/main/terminal/runtime.ts` | Electron 接线：任务池、node-pty 按需加载、Job Object、`taskkill`、退出 hook |
| `src/main/terminal/active.ts` | 任务池结束任务终端的入口（避免 import 成环） |
| `src/main/ipc/terminal-handlers.ts` | 四个 invoke：`openTerminal` `writeTerminal` `resizeTerminal` `closeTerminal` |
| `src/renderer/src/features/terminal/` | 面板、xterm 会话、打开状态 store、焦点动作 |
| `src/shared/ui/terminal-model.ts` | 纯逻辑：高度夹取、输入分块、cwd 显示、从 token 推 xterm 配色 |

IPC（`src/shared/ipc.ts`）：

- `openTerminal(taskId, cols, rows) → { cwd, shell, reopened, backlog }`
- `writeTerminal(taskId, data)`：非空字符串，≤ 65536 字符（`limits.terminalInputMaxChars`）；没有终端时静默忽略。粘贴更大的文本时渲染进程按代理对边界分块发。
- `resizeTerminal(taskId, cols, rows)`：2–1000 的整数。
- `closeTerminal(taskId)`：结束整棵进程树后才 resolve；没有终端时静默成功。
- 事件 `terminalData {taskId, data}`、`terminalExit {taskId, exitCode}`。主动 `closeTerminal` 不发 `terminalExit`。
- 外壳状态 `ShellState.terminalHeight`（120–4000，默认 280，和侧栏宽度同一处持久化）。

## 生命周期

1. 用户打开面板（Ctrl+`、任务条按钮、命令面板），渲染进程创建 xterm、`fit()` 得到 cols/rows，调用 `openTerminal`。
2. 主进程：该任务已有活着的终端 → **复用**：改成新尺寸，丢掉还没发出去的批次（已经在 backlog 里，否则界面收到两遍），返回 `reopened: true` 和 backlog；渲染进程 `reset()` 后写入 backlog 还原屏幕。否则 **新起**：校验任务存在、目录存在，起 shell，`reopened: false`。同一任务并发的 `openTerminal` 共用一次 spawn。
3. 渲染进程在 `openTerminal` 返回之前先订阅事件并缓冲：新起的终端，缓冲的输出照写；复用的，缓冲丢弃（backlog 已覆盖）。主进程里"取 backlog"和"返回结果"在同一个同步段，之后的输出才会走事件。
4. **隐藏面板 ≠ 结束 shell**：面板卸载只释放 xterm，shell 继续在主进程里跑，输出继续进 backlog。再打开 = 第 2 步的复用。面板的打开状态按任务记在内存里（切到别的任务再回来仍是开着的），重启应用后默认收起。
5. shell 自己退出：主进程先把剩余批次发出去，再发 `terminalExit`，并把这个终端从表里摘掉；界面追加一行灰色提示，按任意键调用 `openTerminal` 在同一目录起新的（新屏幕，不保留旧输出）。重启按钮 = `closeTerminal` + `openTerminal`。
6. 结束：`closeTerminal`、任务归档（`TaskPool.archiveTask`）、丢弃 worktree（`discardWorktree`）、应用退出（`registerShutdownHook`）。任务池通过 `PoolDeps.beforeTaskClose` 在关 omp **之前**等终端被结束；丢弃 worktree 时这一步保证目录不再被占用。正在起的终端被结束时，等它起好再结束，不留孤儿。

## cwd 规则

终端目录 = 任务的有效目录 `TaskPool.taskCwd(id)`：任务有 worktree 时是 worktree 根，否则是项目目录（和 omp 子进程用的是同一个）。渲染进程不传路径。目录已不存在（worktree 被手动删了）时 `openTerminal` 拒绝并给出明确错误，面板里显示这句话，按任意键重试；不替用户换目录。草稿没有任务，没有终端入口。

## Shell 和环境变量

- Windows：PATH 上有 `pwsh.exe` 用它（`-NoLogo`），否则 PATH 上的 `powershell.exe`，都没有时用 `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`。只看 PATH，不看当前目录（Windows 的 `CreateProcess` 会先找当前目录，项目里的 `pwsh.exe` 不能抢先）。其他平台：`$SHELL`，没有就 `/bin/bash`。
- 环境：进程环境 + 自管 omp 的 `bin` 前置到 PATH（`prependToPath`，同 `buildOmpLaunch`，所以终端里敲 `omp` 和 omp-studio 用的是同一个；非自管或 omp 还没就绪时不加，不等待发现流程）+ `TERM=xterm-256color` + `COLORTERM=truecolor`。值为 `undefined` 的项去掉（node-pty 在 Windows 上会把它拼成字符串 `undefined`）。用户环境里的 `NO_COLOR` 原样继承（PowerShell 会因此去掉输出里的颜色，是用户自己的设置）。
- `useConpty` 不传，用 node-pty 的默认（Windows 10 1809+ 走 ConPTY）。xterm 的 `windowsPty: { backend: "conpty" }` 只在 Windows 上设。

## 进程树

- shell 起好后在同一个同步段里放进应用 Job Object（`assignToAppJob`，`KILL_ON_JOB_CLOSE`）：主进程被强杀时由系统回收，shell 的所有后代继承这个 Job。放进去失败只记日志，终端照常可用（正常退出仍由 hook 结束）。
- 正常结束时 Windows 上用 `taskkill /T /F /PID <shell>` 结束整棵树，**然后**才 `pty.kill()`（shell 先死的话子进程被重新挂靠，按父子关系就找不到它们了）。**实测**：只调 node-pty 的 `kill()` 时，shell 用 `Start-Process ping.exe -t` 起的子进程不会被结束，归档任务后它的 cwd（项目目录）一直被占用，测试清理 `rmdir` 报 `EBUSY`；加上 `taskkill /T` 后 shell 和子进程在归档后 15 秒内都消失（`test/e2e/terminal.e2e.ts`）。
- 退出：`registerShutdownHook` 里 `closeAll()`（等所有 `taskkill` 完成，单个超时 5 秒）。**实测**：开着终端退出应用后 shell 的 pid 不再存活。

## 数据通路

pty `data` → 写进 backlog（立即）+ 进 `OutputBatcher`（16ms 或攒够 64KB 发一次 `terminalData`）→ 渲染进程 `term.write`。输入反向：`term.onData` → `writeTerminal`（IPC 先进先出，主进程按到达顺序写 pty）。尺寸：`FitAddon` 在面板 `ResizeObserver` 触发时 `fit()`，`term.onResize` 防抖 40ms 后发 `resizeTerminal`（ConPTY 每次 resize 都重排，拖动时合并成最后一次）。

backlog 只留最近 256KB（`Backlog`）：超过上限 2 倍才裁剪，读取时收紧到上限，裁剪点后移到下一个换行开头（避免把转义序列从中间切开后在屏幕上留下乱码），没有换行时不切开代理对。代价：回放从行首开始，被裁掉部分里设置的颜色等状态不会带到回放里。

没有背压：输出特别大时（`cat` 大文件）主进程仍按 16ms 批次推送，渲染进程的 xterm 自己排队。**推测**：极端情况下内存会涨；v1 不处理。

## 渲染进程

- 配色、字体从 token 取：用一个探针元素让浏览器把 `var(--token)` 解析成 `rgb()`，`buildTerminalPalette` 推出 xterm 主题；设置里切主题（`<html data-theme>`）或系统深浅色变化时重新读。字体 `--font-mono`，字号 `--fs-code`；行高倍数 1.2 是字符网格的需要，不走 token。`minimumContrastRatio: 4.5`。
- 键盘：终端聚焦时按键归 shell。xterm 处理的按键会 `preventDefault + stopPropagation`，所以 `Esc` 和 `Ctrl+<字母>` 不会冒泡成全局快捷键（输入框"Esc 停止任务"监听 window，不会被终端里的 Esc 触发；**实测**见 e2e）。例外由 `attachCustomKeyEventHandler` 放行：Ctrl+反引号交给全局快捷键（收起面板、焦点回输入框）；有选区的 `Ctrl+C` 和 `Ctrl+Shift+C` 复制（并吞掉事件，免得触发对话流的"复制最后一条回答"）；`Ctrl+V` 不拦截，让浏览器触发 paste 事件由 xterm 处理。
- Ctrl+` 的三态、和任务条按钮/命令面板的纯显隐切换的区别见 spec §5.1。
- 滚动锚点：面板在输入框下方，对话区只是变矮，`useStickToBottom` 的 `ResizeObserver` 已处理（吸底的继续吸底，没吸底的阅读位置不动）。e2e 断言打开后仍吸底。

## 打包

- `electron-builder.yml`：`asarUnpack: node_modules/node-pty/**`（`.node`、`conpty.dll`、`OpenConsole.exe`、worker 脚本都要在真实文件系统里）；`files` 排除 node-pty 的源码、依赖库、其它平台的预编译件、`.pdb` 和测试文件；`npmRebuild: false`（node-pty 自带 N-API 预编译件 `prebuilds/win32-x64/{pty,conpty,conpty_console_list}.node`，Electron 44.9.0 里**实测**可直接加载；默认的重建会从源码编译，没有 VS 工具链的机器上会失败）。
- `electron.vite.config.ts` 不用改：主进程构建默认把依赖外部化，`node-pty` 保持 `import("node-pty")`，运行时从 `node_modules`（打包后从 `app.asar.unpacked`）加载；它是动态 import，加载失败只让终端打不开，不影响应用启动。
- CSP 不用放宽：xterm 的 DOM 渲染器不用 canvas、不用 `eval`；它注入的 `<style>` 在现有的 `style-src 'self' 'unsafe-inline'` 下可用，`script-src 'self'` 没动。**实测**（打包版，`isPackaged: true`）见下。

## 实测记录（2026-10-18）

- `npm run pack` 后用 Playwright `_electron.launch` 启动 `release\win-unpacked\omp-studio.exe`（`--user-data-dir` 指向临时目录、`PI_CODING_AGENT_DIR` 临时目录）：创建任务、Ctrl+反引号打开面板、输入 `echo packed-ok`，xterm 里出现 `packed-ok` 一行；cwd 是带空格和中文的项目目录。asar.unpacked 里有 `node_modules/node-pty/{lib,prebuilds/win32-x64,build/Release/conpty}`，没有其它平台的预编译件。
- `test/e2e/terminal.e2e.ts`（开发构建）：cwd = 项目目录（`项目 目录`，临时目录名带空格和中文）；命令输出；隐藏再打开恢复屏幕且是同一个 shell（`$x` 还在）；`exit` 显示提示、任意键重启（新 pid）；重启按钮结束旧进程；归档任务和退出应用后 shell 与子进程都不在；worktree 任务的终端在 worktree 里，丢弃 worktree 时目录能删掉；拖拽条 / 键盘调整高度的 120px 下限、70% 上限和持久化；命令面板切换终端；中英 × 深浅截图。

## 没做 / 未实测

- macOS / Linux：`shell.ts` 有分支，单测覆盖了选择逻辑，没有在这两个平台上跑过 node-pty（只带了 darwin 预编译件，`electron-builder.yml` 把它们从 Windows 包里排除了；做 macOS 版时要去掉这条排除）。
- 非 ASCII 输入法（IME）在 xterm 里的组合输入没专门测。
- 多终端标签（一个任务多个终端）、终端里的链接可点击（`@xterm/addon-web-links`）、搜索：不做，v1 每个任务一个终端。
- 终端输出的大流量背压（见上）。
