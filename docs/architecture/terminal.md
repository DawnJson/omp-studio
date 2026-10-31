# 内置终端（阶段 6）

状态：**已实现（2026-10-18）。** 对应阶段 6"xterm.js + node-pty，每个任务的终端在它的 worktree 目录里打开"。界面规格见 `docs/design/spec.md` §4.26，安全边界见 [security.md](security.md)「preload 和 IPC」。

标注约定：**实测** = 本机亲手测的，写明版本；**推测** = 没有证据，只是推断。实测环境：Windows 11（10.0.26300）、Electron 44.9.0、node-pty 1.1.0、@xterm/xterm 6.0.0、@xterm/addon-fit 0.11.0、PowerShell 7.6.7（`pwsh.exe`）。

## 启动提示

shell 起来后到第一个输出字节之间（pwsh 加载 profile 要 3–5 秒，期间只有一个光标），终端区域第一行下面显示淡色的"正在启动 shell…"（`role="status"`，不拦截点击和键盘）。第一个输出字节（含缓冲和复用时非空的 backlog）或 shell 退出就撤掉；重启时重新显示。

## 组成

| 位置 | 做什么 |
|---|---|
| `src/main/terminal/terminal-manager.ts` | 按终端键（TaskId 或草稿键 `new:<projectId\|chats>`）管 pty：打开/复用、写、改尺寸、交接（rekey）、结束。不 import electron 和 node-pty，外部能力从 deps 进来（单测用假 pty） |
| `src/main/terminal/output-batcher.ts` | 输出合并：空闲后第一批下一轮事件循环就发，之后按 16ms 限速，攒够 64KB 立刻发（时机见 `src/main/platform/batch-timer.ts`） |
| `src/main/terminal/backlog.ts` | 最近 256KB 的回放缓冲 |
| `src/main/terminal/shell.ts` | 选 shell、拼环境变量（纯函数） |
| `src/main/terminal/input.ts` | IPC 参数校验（纯函数） |
| `src/main/terminal/runtime.ts` | Electron 接线：任务池、node-pty 按需加载、Job Object、`taskkill`、退出 hook |
| `src/main/terminal/active.ts` | 任务池结束任务终端的入口（避免 import 成环） |
| `src/main/ipc/terminal-handlers.ts` | 六个 invoke：`openTerminal` `writeTerminal` `resizeTerminal` `unsubscribeTerminal` `closeTerminal` `rekeyTerminal` |
| `src/renderer/src/features/terminal/` | 面板、xterm 会话、打开状态 store、焦点动作 |
| `src/shared/ui/terminal-model.ts` | 纯逻辑：高度夹取、输入分块、cwd 显示、从 token 推 xterm 配色 |

IPC（`src/shared/ipc.ts`）：

- `openTerminal(key, cols, rows) → { cwd, shell, reopened, backlog }`：`key` 是 `TerminalKey` = `TaskId` 或 `DraftKey`（`new:<projectId>`，无项目的草稿是 `new:chats`；`draftKey()` 生成，`parseDraftKey()` 解析，和草稿输入框的存储键是同一个字符串）。
- `writeTerminal(key, data)`：非空字符串，≤ 65536 字符（`limits.terminalInputMaxChars`）；没有终端时静默忽略。粘贴更大的文本时渲染进程按代理对边界分块发。
- `resizeTerminal(key, cols, rows)`：2–1000 的整数。
- `unsubscribeTerminal(key)`：面板卸载时发。shell 照跑，输出照进 backlog，但不再发 `terminalData`（2026-10-28 起；之前面板关着也一直往渲染进程推，渲染进程收到就丢）。下一次 `openTerminal` 重新订阅。没有终端时静默忽略。
- `closeTerminal(key)`：结束整棵进程树后才 resolve；没有终端时静默成功。
- `rekeyTerminal(from: DraftKey, to: TaskId) → boolean`：把草稿的终端交给新建的任务（同一个 pty、同一份 backlog）；草稿没有终端、或任务已有终端时返回 false 且什么也不动。草稿的终端还在起时先等它起好。
- 事件 `terminalData {key, data}`（只发给已订阅的：`openTerminal` 订阅，`unsubscribeTerminal` 退订）、`terminalExit {key, exitCode}`（不管订没订阅都发）。主动 `closeTerminal` 不发 `terminalExit`；交接之后事件带任务 id，订阅状态跟着终端走。
- 外壳状态 `ShellState.terminalHeight`（120–4000，默认 280，和侧栏宽度同一处持久化）。

## 生命周期

1. 用户打开面板（Ctrl+`、任务条按钮、命令面板），渲染进程创建 xterm、`fit()` 得到 cols/rows，调用 `openTerminal`。
2. 主进程：该键已有活着的终端 → **复用**：改成新尺寸，丢掉还没发出去的批次（已经在 backlog 里，否则界面收到两遍），重新订阅，返回 `reopened: true` 和 backlog；渲染进程 `reset()` 后写入 backlog 还原屏幕。否则 **新起**：解析目录、校验目录存在，起 shell，`reopened: false`（已订阅）。同一个键并发的 `openTerminal` 共用一次 spawn。
3. 渲染进程在 `openTerminal` 返回之前先订阅事件并缓冲：新起的终端，缓冲的输出照写；复用的，缓冲丢弃（backlog 已覆盖）。主进程里"取 backlog"和"返回结果"在同一个同步段，之后的输出才会走事件。
4. **隐藏面板 ≠ 结束 shell**：面板卸载只释放 xterm 并 `unsubscribeTerminal`，shell 继续在主进程里跑，输出继续进 backlog，但不经 IPC 发给渲染进程（没人显示）。再打开 = 第 2 步的复用，backlog 还原最近 256KB。卸载和再挂载的 IPC 按发出顺序处理（两个 handler 都只 await 同一个已就绪的管理器），先退订后订阅。新起的终端还没起好时到达的退订先记下，起好时不订阅；之后任何一次 `openTerminal`（包括并入同一次 spawn 的）把记下的退订清掉，所以 React StrictMode 在开发版里"挂载 → 卸载 → 挂载"最后仍是订阅的。面板的打开状态按终端键（任务或草稿）记在内存里（切到别的任务再回来仍是开着的），重启应用后默认收起。
5. shell 自己退出：主进程先把剩余批次发出去，再发 `terminalExit`，并把这个终端从表里摘掉；界面追加一行灰色提示，按任意键调用 `openTerminal` 在同一目录起新的（新屏幕，不保留旧输出）。重启按钮 = `closeTerminal` + `openTerminal`。
6. 结束：`closeTerminal`、任务归档（`TaskPool.archiveTask`）、丢弃 worktree（`discardWorktree`）、应用退出（`registerShutdownHook`）。任务池通过 `PoolDeps.beforeTaskClose` 在关 omp **之前**等终端被结束；丢弃 worktree 时这一步保证目录不再被占用。正在起的终端被结束时，等它起好再结束，不留孤儿。

## cwd 规则

终端目录由主进程按键解析（`runtime.ts` 的 `terminalCwd`），渲染进程不传路径：

- 任务键：任务的有效目录 `TaskPool.taskCwd(id)`：任务有 worktree 时是 worktree 根，否则是项目目录（和 omp 子进程用的是同一个）。
- 草稿键：草稿项目的项目目录；无项目的草稿（`new:chats`）是 chats 目录（`mkdir -p`，和 `ensureChatsProject` 同一个目录）。

目录已不存在（worktree 被手动删了）时 `openTerminal` 拒绝并给出明确错误，面板里显示这句话，按任意键重试；不替用户换目录。

## 草稿的终端

新任务草稿（空状态 + `DraftComposer`）也有终端按钮（顶栏只有它，没有分支工具）、Ctrl+`、命令面板命令，面板渲染在空状态下方。草稿还没有任务 id，终端键是草稿键：

- **第一条消息建出任务时**（`DraftComposer.send`，在 `selectTask` 之前）：渲染进程调 `rekeyTerminal(草稿键, 任务 id)`，主进程把 `Entry` 换到新键下，事件出口读 `entry.key`，之后的输出带新键；渲染进程同时把打开标记从草稿键挪到任务 id（`rekeyTerminalOpen`）。任务的面板挂载时 `openTerminal(任务 id)` 命中复用（`reopened: true`，backlog 还原屏幕），面板保持打开、还是同一个 shell。
- **开了工作树的任务**：任务目录是新建的 worktree，和草稿终端的目录不同，所以不交接，直接 `closeTerminal(草稿键)`，任务的面板重新起。
- **切换草稿项目**（草稿键变了，`useDraftTerminalCleanup`）：关掉上一个草稿的终端，它的目录属于上一个项目。建任务期间（`withDraftHandover`）项目列表刷新会改草稿键，这段时间不关。
- 离开草稿但没发消息：草稿的终端留着（和隐藏面板一样不杀 shell），回到同一个草稿再打开就是复用；应用退出时 `closeAll` 结束。

## Shell 和环境变量

- Windows：PATH 上有 `pwsh.exe` 用它（`-NoLogo`），否则 PATH 上的 `powershell.exe`，都没有时用 `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`。只看 PATH，不看当前目录（Windows 的 `CreateProcess` 会先找当前目录，项目里的 `pwsh.exe` 不能抢先）。其他平台：`$SHELL`，没有就 `/bin/bash`。
- 环境：进程环境 + 自管 omp 的 `bin` 前置到 PATH（`prependToPath`，同 `buildOmpLaunch`，所以终端里敲 `omp` 和 omp-studio 用的是同一个；非自管或 omp 还没就绪时不加，不等待发现流程）+ `TERM=xterm-256color` + `COLORTERM=truecolor`。值为 `undefined` 的项去掉（node-pty 在 Windows 上会把它拼成字符串 `undefined`）。用户环境里的 `NO_COLOR` 原样继承（PowerShell 会因此去掉输出里的颜色，是用户自己的设置）。
- `useConpty` 不传，用 node-pty 的默认（Windows 10 1809+ 走 ConPTY）。xterm 的 `windowsPty: { backend: "conpty" }` 只在 Windows 上设。

## 进程树

- shell 起好后在同一个同步段里放进**它自己的** Job Object（`assignToOwnJob`：每个 shell 一个新建的 `KILL_ON_JOB_CLOSE` Job，句柄存在 Entry 里）：主进程被强杀时句柄随进程关闭，系统回收整棵树；shell 退出或 `closeTerminal` 时（`taskkill` 之后）主动关句柄。放进去失败只记日志，终端照常可用（正常退出仍由 hook 结束）。**为什么不用 omp 的应用 Job（`assignToAppJob`）**：**实测**（Electron 44.9.0 的 `main.cjs` 小脚本，主进程本身在某个外层 Job 里；本机默认 shell 是商店版 `WindowsApps\pwsh.exe` 别名）：node-pty 起的商店版 pwsh 放进应用 Job 失败，`GetLastError` = 5（ACCESS_DENIED）；同一个 Electron 里 `powershell.exe` 和普通子进程都能放进去。**推测**原因：商店版 pwsh 在系统给的另一条 Job 链里，应用 Job 已经挂在主进程的 Job 之下，嵌套链不兼容。给每个 shell 新建一个空 Job 则**实测**总能成功（`IsProcessInJob` 为真）：空 Job 会随这个进程挂到它现有的 Job 链下面。旧日志里的 `(error 0)` 是 koffi 的 `errno()` 读的是 C 运行库的 errno，Win32 错误要调 `GetLastError`，现已改正。
- 正常结束时 Windows 上用 `taskkill /T /F /PID <shell>` 结束整棵树，**然后**才 `pty.kill()`（shell 先死的话子进程被重新挂靠，按父子关系就找不到它们了）。**实测**：只调 node-pty 的 `kill()` 时，shell 用 `Start-Process ping.exe -t` 起的子进程不会被结束，归档任务后它的 cwd（项目目录）一直被占用，测试清理 `rmdir` 报 `EBUSY`；加上 `taskkill /T` 后 shell 和子进程在归档后 15 秒内都消失（`test/e2e/terminal.e2e.ts`）。
- **行为后果**：shell 退出（用户输入 `exit`）或关闭终端时句柄随之关闭，从该终端启动的程序（`code .`、`start …` 等）也会被一并结束，不再活到应用退出。
- 退出：`registerShutdownHook` 里 `closeAll()`（等所有 `taskkill` 完成，单个超时 5 秒）。**实测**：开着终端退出应用后 shell 的 pid 不再存活。

### POSIX（macOS / Linux）的进程结束和看门狗（mac 没有实测（推测）；Linux 见 `linux.md` 的 CI 实测）

- **结束进程树**（对应 `taskkill /T /F`）：`platform/posix/process-tree.ts`。`ps -A -o pid=,ppid=,pgid=` 取进程表，`collectTreePids` 算出 root 的全部后代，再加上 root 开的进程组（`pgid === root`）里的成员（父进程先死后被 launchd / init 收养的孙进程还留在组里），逐个 `process.kill(pid, "SIGKILL")`；`ESRCH` 忽略，别的错误记日志。root 不是组长时不碰它的组（那可能是 Electron 自己的组）；pid ≤ 1 和主进程自己永远不杀。`ps` 失败时记日志，退化成只杀 root。顺序同 Windows：先列表、杀树，再等退出事件，最后才 `pty.kill()`（先杀 root 会让孙进程被收养、按父子关系找不到）。调用方：`tsp-session.ts` 的 `killProcessTree`（TSP 和内置终端共用）、`omp-connection.ts`、`git/exec.ts`。
- **主进程被强杀时的兜底**（对应 Job Object 的 `KILL_ON_JOB_CLOSE`）：mac 没有 Job Object，Linux 的 `PR_SET_PDEATHSIG` 要在子进程里设（node 的 `spawn` 和 node-pty 都没有入口），两边都用看门狗（`platform/posix/watchdog.ts`，入口仍是 `job-object.ts` 的 `assignToAppJob` / `assignToOwnJob`，调用方不分平台）。每个 omp 子进程起一个 `/bin/sh -c <脚本> … <主进程 pid> <pgid>`（`detached: true`、`stdio: "ignore"`、`unref`，自己在独立进程组里，主进程死后不受影响）：每秒 `kill -s 0 <主进程>`，主进程不在了就先 `kill -s STOP -- -<pgid>`（组里不再起新进程），用 `ps` + `awk` 按父子关系收齐组成员的所有后代，再 SIGKILL 整个组和这些后代。只杀组不够：omp 的 bash 工具让命令自己开进程组（2026-10-26 WSL 实测，omp 18.12.6），只杀组时这些命令被 init 收养留下来；规则和正常退出用的 `collectTreePids` 一样是"组成员连同后代"。组已经空了（子进程正常结束）它自己退出；`assignToOwnJob` 的释放函数也会直接结束看门狗。刚 spawn 时组可能还没建好，一次都没见过组时容忍 5 秒。
- **`kill` 的写法**：Debian / Ubuntu 的 `/bin/sh` 是 dash。dash 的 `kill -0 -- -<pgid>` 把 `--` 当成 pid，报 `Illegal number` 并让整个脚本退出（dash `src/jobs.c` 的 `killcmd`：`-<信号>` 这种写法之后不再解析选项），看门狗一启动就没了；`kill -s <信号> -- …` 走选项解析、认 `--`。bash（mac 的 `/bin/sh`）两种都认。`test/posix-process-tree.test.ts` 的"看门狗脚本"真的跑一遍脚本，Linux CI（dash）上通过（2026-10-26）。
- **进程组**：pty 的子进程是 session leader（node-pty 的 forkpty 会 `setsid`），pgid = pid；rpc-ui 的 omp 用 `spawn` 起，darwin / linux 上加 `detached: true` 让它自成进程组（Windows 不加）。`detached` 之后 stdin 关闭、管道的行为不变；终端里的 Ctrl+C 不会再到达它（本来也是我们经 rpc 控制它）。
- **需要在 mac 上验证**：`ps` 输出格式；强杀主进程后 omp 及其孙进程在约 1 秒内消失；正常关闭任务后没有残留的 `sh` 看门狗；node-pty 起的 pty 子进程确实 pgid = pid。

### macOS / Linux 的 PATH

- 从 Finder 启动时 PATH 只有 `/usr/bin:/bin:/usr/sbin:/sbin`；Linux 从桌面启动时 PATH 来自桌面会话，通常没读过 `~/.bashrc` / `~/.zshrc`，bun 这类写进 rc 文件的目录不在里面。`platform/darwin/login-path.ts`：`app.whenReady` 之后、`registerIpcHandlers` 之前 `await fixLoginPath()`：`$SHELL`（没有就 mac 的 `/bin/zsh`、Linux 的 `/bin/bash`）`-ilc` 打印带前后标记的 `$PATH`，标记之间的内容合并进 `process.env.PATH`（登录 shell 的条目在前，去重）。最多等 3 秒，超时或失败记日志后继续用原 PATH。Windows 不执行。mac **没有实测（推测）**；Linux 见 `linux.md`。
- 内置终端的 shell 在 POSIX 上带 `-l`（登录 shell），读 `~/.zprofile` 等。

## 数据通路

pty `data` → 写进 backlog（立即）+ 有面板订阅时进 `OutputBatcher`（空闲后第一批下一轮事件循环就发，连续输出时距上一批满 16ms 再发，攒够 64KB 立刻发 `terminalData`）→ 渲染进程 `term.write`。没订阅时只进 backlog。输入反向：`term.onData` → `writeTerminal`（IPC 先进先出，主进程按到达顺序写 pty）。尺寸：`FitAddon` 在面板 `ResizeObserver` 触发时 `fit()`，`term.onResize` 防抖 40ms 后发 `resizeTerminal`（ConPTY 每次 resize 都重排，拖动时合并成最后一次）。

backlog 只留最近 256KB（`Backlog`）：超过上限 2 倍才裁剪，读取时收紧到上限，裁剪点后移到下一个换行开头（避免把转义序列从中间切开后在屏幕上留下乱码），没有换行时不切开代理对。代价：回放从行首开始，被裁掉部分里设置的颜色等状态不会带到回放里。

没有背压：输出特别大时（`cat` 大文件）主进程仍按 16ms 一批推送，渲染进程的 xterm 自己排队。**推测**：极端情况下内存会涨；v1 不处理。

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
- `test/e2e/terminal.e2e.ts`（开发构建）：cwd = 项目目录（`项目 目录`，临时目录名带空格和中文）；命令输出；隐藏再打开恢复屏幕且是同一个 shell（`$x` 还在）；`exit` 显示提示、任意键重启（新 pid）；重启按钮结束旧进程；归档任务和退出应用后 shell 与子进程都不在；worktree 任务的终端在 worktree 里，丢弃 worktree 时目录能删掉；拖拽条 / 键盘调整高度的 120px 下限、70% 上限和持久化；命令面板切换终端。

## 没做 / 未实测

- macOS：`shell.ts` 有分支，单测覆盖了选择逻辑；mac CI 跑过起 pty 的单测，没有在真机上开过内置终端。Linux：CI 上跑过起 pty 的单测（node-pty 从源码编译，见 `linux.md`），内置终端的 e2e（`terminal.e2e.ts`）里的命令按 PowerShell / zsh 写，没在 Linux 上跑。
- 非 ASCII 输入法（IME）在 xterm 里的组合输入没专门测。
- 多终端标签（一个任务多个终端）、终端里的链接可点击（`@xterm/addon-web-links`）、搜索：不做，v1 每个任务一个终端。
- 终端输出的大流量背压（见上）。
