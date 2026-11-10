# 后台运行（关窗口后任务继续跑）

应用常驻托盘：点窗口 × 只隐藏窗口，主进程、任务和 omp 子进程继续跑；退出只有明确的入口（仓库所有者定，2026-10-18）。没有"常驻 / 收尾"开关（所有者选了常驻，不加设置项）。

标注约定：**实测** = 本机亲手测的，写明版本；**文档** = 官方文档原文，附链接；**推测** = 没有证据。下文 omp 实测是 omp 18.12.1、模型 `deepseek/deepseek-v4-flash`、Windows 11、Node 24。

## 行为

- 窗口 ×（含 Alt+F4、mac 的 ⌘W）：`hide-on-close.ts` 拦下 close，`concealWindow` 淡出后 `hide()`（时长见 `spec.md` §2.6“窗口出现 / 消失”），不销毁、不确认。第一次关窗口发一条系统通知"仍在托盘运行"，之后不再提示（`userData/window-state.json` 的 `trayNoticeShown`，不是 omp 配置，也不进 `StudioSettings`）。Linux 另有 `Ctrl Q` 退出（`spec §5.1`）。
- 托盘（`window/tray.ts`，图标 `resources/tray.png`，由 `npm run icons` 生成，见 `spec.md` §3.1“标志”；打包经 `extraResources`）：悬停提示带运行中 / 等你确认的个数；左键显示窗口；右键菜单 = 打开 / 摘要行 / 在忙的任务（点击定位）/ 退出。托盘由系统绘制，自动化测试点不到，所以菜单模板是纯函数（`tray-model.ts`）单测。
- 再次启动（`second-instance`）、mac `activate`、点通知、点托盘都走 `showMainWindow()`（`show-window.ts`）：最小化的先还原，隐藏的淡入（`revealWindow`），窗口不在了才重建。
- 通知（`tasks/gate-notifier.ts`）："等你确认"在窗口没焦点时发；窗口看不见（托盘、最小化）时任务跑完或出错也发，窗口可见时不发（侧栏已有状态）。开关是 omp 自己的 `ask.notify` / `completion.notify` / `error.notify`，studio 不另设（见 `omp-settings.md`「studio 的系统通知遵守 omp 的 `*.notify`」）。点通知显示窗口并定位到该任务。
- 真正的退出：托盘"退出"、应用菜单退出、自动更新"重启并安装"（`finishShutdown()` 后 `quitAndInstall`）、系统注销 / 关机（窗口 `session-end` → `finishShutdown()`）。都经过 `shutdown.ts`：置 `isQuitting()` 后 `hide-on-close.ts` 放行 close，不会吞掉 `quitAndInstall` 触发的退出。退出流程见 `task-model.md`"进程上限和回收"：并行关所有任务的 omp，服务进程和项目 rpc-ui 池关 stdin，超时强杀，Job Object 兜底。退出时窗口淡出与这些 hook 并行。
- `index.ts` 给 `window-all-closed` 装空监听，关掉 Electron "最后一个窗口关了就退出"的默认行为。
- 托盘"退出"和更新安装直接中止在跑的任务，不二次确认（所有者定的"退出才中止"语义，2026-10-18）。中止会丢掉那一轮（见实测 A）。

**为什么隐藏而不销毁窗口**：常驻模式下用户会反复调出窗口，隐藏能原样保留草稿、滚动位置、展开状态，也省掉"重建窗口后渲染进程订阅事件的时序"一类问题。代价是常驻一个渲染进程的内存（**未实测**）。

**为什么不做独立后台服务**：omp 的会话绑在 stdin 上（实测 A），后台运行只能靠某个进程一直握着管道；主进程留在托盘是改动最小的一种，"会话绑 stdin、退出时关子进程、Job Object 兜底"三条规则都不用改。独立服务（见下"放弃的方案"）买到的是"更新和主进程崩溃时任务不断"，连 Tern 在 Windows 上都没做到。

## omp 实测（18.12.1）

方法：`omp --mode rpc-ui --approval-mode yolo`，临时 `PI_CODING_AGENT_DIR` 和 cwd；让模型用 bash 跑一条 20 秒后才写标记文件的 `node -e`，看命令有没有跑完。

- **A 工具执行中关 stdin**：85 ms 内进程以 0 退出，标记文件没生成，会话文件末尾 `toolResult` 是 `Command aborted`；关 stdin 后仍收到 `tool_execution_end`、`message_*` 收尾帧。`omp://rpc.md` 的"stdin 关闭 → 排空 → 释放会话 → 退出"成立，**而且会中止正在跑的工具**。所以不存在"让 omp 脱离 stdin 继续跑"的办法。
- **B 工具执行中强杀（`taskkill /T /F`）再恢复**：会话文件只有用户消息和带工具调用的 assistant 消息，没有 toolResult；新进程 `switch_session` 成功，`isStreaming:false, isSettled:true`，**不会自动接着跑**，再发一条 prompt 能正常完成。主进程被杀 / 关机 / 更新时任务的下限就是"那一轮丢了，要用户再发一句"。（未测：模型收到"继续"后怎么处理悬空的工具调用。）
- **C 独立 detached 进程握着 omp，父进程被杀**：holder 用 `spawn(..., {detached:true, stdio:'ignore'})` + `unref` 起，`taskkill /PID <父> /F`（不带 `/T`）后 holder 和 omp 都活着、命令跑完。**带 `/T` 时 holder 也被一起杀**（detached 子进程仍记着父 PID）——将来做任何"按进程树杀"的地方都要注意这点。
- omp 没有 daemon / attach 类托管模式：`--mode` 只有 `text/json/rpc/acp/rpc-ui`；`omp ps` 是 omp 自己的后台进程监管，与会话托管无关（文档，未实测 `ps`）。
- 扩展 UI 请求（审批、ask）没人答时一直等：读 omp 18.12.6 源码（`modes/rpc/rpc-mode.ts`），只有扩展自己传了 `timeout` 才超时。所以后台期间等审批的任务会一直停着，这是要发"等你确认"通知的原因。这条只针对任务里的 omp；studio 自己的 rpc-ui 进程由 `OmpConnection` 对无人认领的对话框回 `cancelled:true`（见 `omp-rpc.md`），不会挂住。

## 别家怎么做（2026-10-18 调研）

| 产品 | 关窗口后本地任务继续跑？ | 机制 | 更新时 |
|---|---|---|---|
| Codex 桌面版 | 文档要求"app running"；Windows 上关窗口后残留进程是 bug（[openai/codex#13970](https://github.com/openai/codex/issues/13970)） | 主进程拉 `codex app-server` 子进程，stdio JSON-RPC（[InfoQ](https://www.infoq.com/news/2026/02/opanai-codex-app-server)） | 未查到 |
| Claude Code 桌面版（本地） | 文档："only fires while the app is open"（[desktop-scheduled-tasks](https://code.claude.com/docs/en/desktop-scheduled-tasks)） | 主进程持有会话 | 未查到 |
| Claude Code 桌面版（SSH 远端） | 继续：远端 helper 进程 + 每会话 16 MiB 输出缓冲；Windows 版退出后不重新接回（[desktop](https://code.claude.com/docs/en/desktop)） | 远端 helper | 新 helper 替换旧的可能断任务；Desktop 自己更新时等任务做完 |
| Tern 0.9.4（Windows，实测日志和进程表） | 窗口和 daemon 分离，窗口重连不影响 pane | 独立 daemon + 命名管道，pane 里是 PTY 子进程 | Windows 上替换 daemon，pane 里的 omp 靠 `omp --restore` 重拉，运行中命令的输出丢失 |

没有一家做到"本地、关窗口继续跑 + 更新不断任务"。Codex 的残留进程 bug 也是 `omp-boundaries.md`「进程」要求不留孤儿进程、用 Job Object 兜底的原因。

## 放弃的方案

- **收尾模式**（关窗口后任务都安静了就自动退出）：所有者选了常驻（2026-10-18）。关窗口时的确认弹窗、更新前"后台有任务"的确认也随之不做。
- **独立后台服务进程，窗口附着**（Tern 的做法）：实测 C 证明可行，但 `StudioApi` 全部任务函数和事件要走自定 IPC（协议、鉴权、版本协商），服务和窗口版本会漂移（Tern 日志里 7 次 `client protocol level differs`），要发系统通知就得是完整 Electron 进程，NSIS 安装器会把同名 exe 当成运行中的应用结束掉 [推测]，Job Object 和 `omp-boundaries.md`「进程」规则都要重写。工作量约 2–3 周。
- **每个 omp 配一个薄 holder 进程，只中继字节**：范围比独立服务小，适合将来解决"更新 / 主进程崩溃时任务不断"时作为增量；任务进程现在在伪终端里，这条路要在 pty 上重新验证（未测）。
- **销毁窗口、靠快照冷启动恢复**：省渲染进程内存，但常驻模式下用户频繁调出窗口，草稿和滚动状态会丢，见上"为什么隐藏"。

## 未实测

- 真机系统注销 / 关机时 `session-end` 是否触发；不触发时 Job Object 仍会收掉 omp，会话按实测 B 可恢复。
- Win11 把托盘图标折叠进"隐藏的图标"后的发现性（所以首次关窗口发提示）。
- 常驻渲染进程的内存基线。
- 安装包里托盘图标能否从 `resources/tray.png` 加载（e2e 跑的是未打包版本）。
- `electron-updater` 的 `autoInstallOnAppQuit`：项目没设，库默认 `true` [推测]，托盘"退出"时可能静默安装。
