# 测试、e2e、探针和录制回放

命令总表在根文件 `AGENTS.md`。这里写测什么、怎么隔离、e2e 和回放的写法，以及只有踩过才知道的坑。

## 跑什么

只测这次改到的东西，不每次跑全量：

- **收工前**：`npm run check`（lint、格式、类型检查和仓库规则扫描，十几秒）。
- **单测**：`npx vitest related <改过的源文件> --run` 跑依赖它们的测试（顺着 import 关系往上找，`ipc.ts` 这类到处被引用的模块也一样，不用另跑全量）；新写或改了的测试文件直接 `npx vitest run <文件>`。改了录制（`fixtures/`）或假 omp（`test/fake-omp/`）时，跑用到它们的测试文件：它们是读文件、起子进程用的，不在 import 关系里。
- **e2e**：`npm run build` 后 `npx playwright test test/e2e/<功能>.e2e.ts`。e2e 跑的是 `out/`，没重新构建就是在测旧代码（Playwright 的 globalSetup 会检查 `out/` 是否比 `src/` 旧）。改了 `test/e2e/launch.ts` 里的某个辅助函数，就跑用到它的 spec；只有改了 `launchApp` 本身、preload、窗口或退出流程时才跑全量 `npm run test:e2e`。全量有失败时，修好后用 `npx playwright test --last-failed` 只重跑失败的，修复碰到的代码别的 spec 也用的话再加跑那几个。合并子代理的改动之后先 build 再跑一遍相关 e2e，子代理自己报的"通过"不算数。并行和 worker 数见下面「e2e 并行」。
- **发版脚本**只跑上一个 tag 以来改过的文件影响到的单测（`vitest --changed`）；录制、假 omp、依赖或 vitest 配置有改动时它自动跑全量（`vitest.config.ts` 的 `forceRerunTriggers`）。
- **真实 omp 冒烟**（默认跳过）：`STUDIO_REAL_OMP=1 npx vitest run test/task-real-omp.test.ts`，需要仓库根 `.env` 里的 `STUDIO_TEST_MODEL` 和 key；同类的还有 `test/*-real-omp.test.ts`。
- 改了主进程或协议处理，启动应用真的发一次 prompt，看到事件流跑完。只读代码不算验证。
- 能用回放（`fixtures/tsp/` + `test/fake-omp/`）复现的，不调真实模型。

## 收工检查的 hook

`scripts/check.ts` 由下面几处自动调用，配置都在仓库里，不碰用户目录下的配置。

| 入口 | 配置 | 实测（2026-10-30，仓库副本里放一个没格式化的文件） |
|---|---|---|
| git | `.githooks/pre-commit`（`--staged`，另查提交邮箱）、`.githooks/commit-msg`（`--commit-msg`），`npm install` 时 `scripts/postinstall.ts` 设 `core.hooksPath` | 暂存文件里的私人信息、提交信息里的客户端名都被拦，正常提交信息放行 |
| omp | `.omp/extensions/check-gate.ts`（`session_stop`，`--gate`），omp 对 block 不设上限，扩展自己数，连续拦 3 次后放行并提示 | omp 18.14.0 `-p`：拦满 3 次后结束，每次 agent 都收到检查输出。handler 超过 30 秒 omp 就不等了、放它结束（只打一行 `Extension error … handler timed out after 30000ms`，没有设置项能调）；检查热启动 10-15 秒，变慢到接近 30 秒时这道门会悄悄失效 |

## 测什么

- 每个测试要对应一个用户能观察到的失败；不测"函数被调用了""默认值等于默认值"。
- 回归测试要撤掉修复跑一次，确认会失败。断言"淡入了""没越界""焦点环不画"这类容易空过的，尤其要这样核对。
- 修越界前先在已有 e2e 里用 `test/e2e/launch.ts` 的 `expectNoOverflow` 写出会失败的断言（窄窗口 900 宽、中英文、长内容），失败了再改 CSS；复现不出来就不改。
- 关于 omp 行为的结论写明实测的 omp 版本，记进对应的 `docs/architecture/<功能>.md`；没实测的标成推测。
- 单测只 import 列在 `tsconfig.node.json` include 里的纯模块；碰 `window`、`Worker`、`URL.createObjectURL` 的渲染进程模块不写单测，靠 e2e；要测 `.tsx` 里的纯逻辑先拆到 `.ts`（`npm run typecheck` 会报漏加的 include）。
- 单测也在 GitHub 的 macOS / Linux 机器上跑：路径、环境变量名、大小写跟着 `process.platform` 写，见 [mac.md](mac.md)「CI」。

## 隔离用户数据、不留残留

- 开发和测试时 omp 的 `PI_CODING_AGENT_DIR` 指向临时目录，用完删。测试 key 和 `STUDIO_TEST_MODEL` 从 `.env` 以环境变量传入，不用 `--api-key`；`.env.example` 和 `.env` 的变量一起加，模板不写真实值。只有验证"读取终端版已有会话"时才连真实目录，而且只读。
- 用量读的是真实 `~/.omp/stats.db`，`PI_CODING_AGENT_DIR` 管不到，要连 `USERPROFILE` / `HOME` 一起指到临时目录（[tsp-real-omp-probes.md](tsp-real-omp-probes.md) §16）。
- agent 的常驻 shell 里，隔离变量只写成命令前缀（`PI_CODING_AGENT_DIR="$d" omp …`）或放进子 shell，不 `export`；读用户真实配置前先 `echo ${PI_CODING_AGENT_DIR:-unset} $HOME` 确认。`export` 过的变量会留着，后面的 `omp config get`、`omp search` 都读临时目录，结论全错，还可能把东西写进真实 `~/.omp`。子代理拿到的环境未必隔离，写探针前先 `echo` 一次。
- 启动应用的测试和脚本都设 `STUDIO_USER_DATA`：这样启动它的进程没了应用会自己退出（`window/orphan-guard.ts`，软退出 15 秒后 `app.exit(0)`）。查孤儿保护时 Windows 上要 `spawn(..., { detached: true })`（Node 子进程默认随父进程被杀），并看 userData 的 `logs` 里有没有 "the launching process exited"。
- 主进程里用到 `app.getPath("userData")` 的单例（`startupCache()` 之类）只能在第一次用到时建，不能在模块顶层建：`index.ts` 先 import 整条依赖链、后 `app.setPath("userData", STUDIO_USER_DATA)`，顶层建的单例拿到的是用户正在用的 `%APPDATA%\omp-studio`（2026-10-28，斜杠命令缓存让 e2e 读到了开发者真实缓存里的默认模型）。
- `launchApp` 只把白名单里的环境变量传给被测应用（`test/e2e/launch.ts` 的 `appEnv`）：agent 自己可能跑在 omp-studio 的任务里，shell 带着那个任务的 `STUDIO_*` / `PI_*` 和各家 key（omp 会把 agent 目录 `.env` 读进进程环境）。要用就经 `extraEnv` 显式传；单测里用 provider key 变量时用测试专用的变量名。所以 e2e 里没有任何 provider 凭据，真 omp 命令每次多花约 3 秒，连着调几次 omp 的用例要放宽超时（`settings-functional` 的 MCP 用例 120 秒）；每个要等一次 omp 命令（经服务进程或命令行，包括保存后经 omp 重读列表）才会变的断言写明超时（`{ timeout: 30_000 }`，MCP 用例里叫 `ompWait`），默认的 5 秒不够。
- 跑会起 Electron 的命令，输出不要接 `| head` 这类读够就退出的命令（管道一关测试进程就死，来不及清理），要截取就用 `grep` 或先写进文件；不要 `taskkill /F` 正在跑的测试。
- 删 `mkdtemp` 建的目录要删它返回的那一层，`rm` 加 `maxRetries`。启动助手里 `launchApp` 之后的任何步骤都放进 try，失败时先 `close()` 再抛（Playwright 的 globalTeardown 查残留）。
- 探针脚本连真实 omp 时，结束后删掉它在 `~/.omp/agent/sessions/` 里新建的 `-tmp-` 会话目录，脚本用完就删。
- 跑完 e2e 或探针检查残留：父进程已不在的 `electron.exe`（命令行带 `playwright-core\lib\server\electron\loader.js`）及其下的 `omp.exe`，临时目录里的 `omp-studio-e2e-*`（包括剪贴板锁文件）、`omp-studio-agent-*`。有残留先查原因再清理。用例超时后 worker 被结束，`finally` 来不及走完，它的临时目录会留下：先修超时。

## e2e 并行

- 按用例并行（`playwright.config.ts` 的 `fullyParallel`），默认 worker 数是逻辑核的八分之一（32 线程的开发机上 4 个）：跑 e2e 时机器还有人在用。临时要改就 `--workers N`。
- e2e 的进程都在"低于正常"优先级跑：`global-setup.ts` 先降 Playwright 主进程（worker、Electron 主进程、omp 都继承）；GPU 进程（"高于正常"）和渲染进程（"正常"）是 Chromium 自己设的、不继承，`launchApp` 起好应用后按 `app.getAppMetrics()` 逐个降回去。实测（2026-10-31，跑 `terminal.e2e.ts` 时隔 12 秒取样两次）：主进程、GPU、渲染、utility 四类进程都是"低于正常"，Chromium 没再改回。用户开着别的程序时，它们先拿 CPU。
- 实测（2026-10-31，211 个用例，机器上同时开着别的程序）：串行 1252 秒；4 个 worker 450–480 秒，被测进程（Electron + node）平均约 5 个核、峰值约 2 GB 内存，整机 CPU 平均 70% 多；8 个 worker 415 秒，但整机 CPU 一直 100%、空闲内存跌到 1 GB 左右，真 omp 的用例开始超时。时间主要花在每个用例自己起停应用（起约 1.4 秒、关约 1.9 秒）和真 omp 命令上，worker 再多也只是互相拖慢。
- 用例之间不能共享任何东西：临时目录用 `mkdtemp`，不用固定名字；端口取 0；不读写真实 `~/.omp`、`%APPDATA%\omp-studio`。新加整台机器共用的东西（全局快捷键、固定端口、固定文件）之前先想清楚并行时会不会撞。
- **系统剪贴板整台机器只有一个**：写剪贴板再读回来或粘贴的那一段，用 `launch.ts` 的 `lockClipboard()` 包住（拿锁、`finally` 里放锁），只包这一段；点复制按钮再读剪贴板的也算。锁文件是临时目录里的 `omp-studio-e2e-clipboard.lock`，持有者进程没了下一个等锁的会接手。锁只管得住用例之间：跑 e2e 时人在这台机器上复制东西，剪贴板用例可能读到它而失败（2026-10-31 一次读到不属于任何用例的 "python"，推测是这样来的），用例结束时恢复的旧内容也会盖掉人刚复制的东西。
- 机器忙时动画和真 omp 都会变慢：量位置前等动画放完（设置页换节有 view-in 上移动画，`omp-config.e2e.ts` 的 `sectionSettled`），等真 omp 命令结果的断言写明超时（见上面"真 omp 命令每次多花约 3 秒"），不靠默认的 5 秒。
- 主进程另外异步做的事，页面上量一次就断言会抢在前面：改字号后三键区高度（`shell.e2e.ts` 改成 poll）；`/tree` 前假 omp 还没报会话文件（`session-tree.e2e.ts` 的 `start` 先等 `getSessionTree` 有节点）。串行跑时碰不上，4 个 worker 的全量里各撞过一次（2026-10-31）。
- 没查清的一次（2026-10-31，第 6 遍全量）：`omp-config.e2e.ts`"自定义下拉"超时 60 秒，报错只有一句 `Test timeout ... exceeded`、不带步骤，接着 `Worker teardown timeout`，留下这个用例的两个临时目录。临时 agent 目录的 `config.yml` 里已经写进 `edit.mode: patch`，说明用例正文走到了最后几步；正文剩下的都是有超时的断言，没有超时的只有收尾的 `launched.close()`。用一个让 `before-quit` 永远拦住的探针复现出一模一样的报错，所以推测是应用退出卡住了（某个退出 hook 没结束），但主进程日志在启动后 4 秒就没有新行，没法确认是哪个 hook。同一个用例单独 4 个 worker 连跑 24 遍、其余 5 遍全量都没再出现。再碰到时先看留下的 userData 里 `logs/` 和 agent 目录。

## 给仓库所有者开一个开发版窗口

装好的 omp-studio 开着时，单实例锁跟着 userData 走：同一个 userData 时开发版拿不到锁，`app.quit()` 后只把装好的那个窗口带到前面，退出码还是 0，看着像正常结束。所以设 `STUDIO_USER_DATA` 指向临时目录（写 Windows 路径，bash 里不能靠 `cygpath`，它不一定在 PATH 上），在前台起 `npx electron .`，起来后查窗口进程还在不在。只复制 `settings.json` 和 `omp-studio-state.json`（接管选择），不复制 `tasks.json`，免得两个窗口对同一个会话各起一个 omp。经 `electron-vite preview` 放进后台服务起时也会刚起就退出（原因没查清）。

## e2e 写法

- **不拍截图**（仓库所有者 2026-10-23 决定：截图不和基准比对，挡不住回归；oxlint 拦 e2e 里的 `screenshot`）。改了界面用断言验证用户看得到的结果，越界用 `expectNoOverflow`，在窄窗口（900 宽）、中英文下各查一次。自己核对界面时可以临时截图，放系统临时目录，用完就删。
- 断言用户能看到的结果，用 `data-testid` 找元素，不用固定等待（`waitForTimeout`，oxlint 拦）或重试掩盖竞态。唯一的例外是"等一段时间确认某件事没发生"的反向断言：写 `oxlint-disable-next-line` 并注明在等什么。
- 悬停、量位置之前，先等上面异步加载的区块到最终状态（列表或空状态出来），否则布局还在挪，悬停落空（设置 → 集成的插件提示：先等 MCP、SSH、Skills、插件各节的 `*-empty`）。
- **窗口默认在后台**：`launchApp` 设 `STUDIO_E2E_BACKGROUND=1`，主窗口不进任务栏、显示时不抢焦点，Windows 上再用 DWM cloak 藏起来（`window/main-window.ts` 的 `e2eBackground`）：用户看不到、点不到，页面照常绘制，焦点由 Playwright 模拟（仓库所有者 2026-10-28 要求）。要看着跑就在命令前设 `STUDIO_E2E_BACKGROUND=0`。新增显示、聚焦窗口的代码也要走这个开关。
- `launchApp` 等到 `app-root` 出现才返回；进设置页某一节用 `launch.ts` 的 `launchSettings`（`Control+,` 是开关，多按一次就关；窄窗口下左侧导航不在，到了目标页再缩到 900）。
- 切语言和主题用 `launch.ts` 的 `setLocale` / `setTheme` / `setLocaleTheme`，不直接调 `studio.setLocale`、`studio.setTheme`（换主题是整窗交叉淡入，早了量到的是过渡中的画面；`scripts/check.ts` 的 `e2e-locale-theme` 查）。切完之后不再做键盘断言：焦点会离开弹层；要在几种语言下查弹层，先断言完 Esc，再切语言、重新打开。
- `locator.evaluate` / `page.evaluate` 传真函数，DOM 类型在回调里用 `globalThis as unknown as {...}` 取；不传函数源码字符串（会被当成表达式求值，函数不被调用，结果是 `undefined`），也不调回调外定义的辅助函数（回调只把自己序列化进页面）。
- **等一个动作完成**，不要用"出现某条 toast"当信号，前一次同样的动作留下的 toast 可能还在；用这次动作才会改变的界面状态，并且等接下来要操作的那块界面本身刷新完，别拿另一个面板的变化当信号。异步才改状态的受控勾选框用 `click()` + `toBeChecked()`，不用 `check()`。
- 点了 `ui/Menu` 的一项、马上又要点同一个按钮再开菜单，先等按钮的 `aria-expanded` 回到 `false`，不等 `getByRole("menu")` 数到 0：退出动画放完才卸载并通知父级，动画中点按钮是关菜单。
- 断言侧栏文件夹"展开 / 折叠"看切换按钮的 `aria-expanded` 和行是否 `toBeVisible`，不数 `task-row`：自动收起（减少动效下）时行还会在 DOM 里留 5 秒以上。
- 断言"鼠标操作时不画键盘焦点环"，要放在启动后还没有任何用户输入时程序放焦点的地方（准备页 / 首屏 `autoFocus`）：Chromium 的 `:focus-visible` 对程序焦点看上一次输入，刚鼠标点过时本来就不画，放在鼠标点开的对话框上撤掉修复也照样通过。
- 新用户路径（服务进程、设置页、首次启动）的改动，用真实 omp 跑时把所有 `*_API_KEY` / `*_TOKEN` 置空再跑一遍（`settings-functional.e2e.ts`「没有任何凭据」）。
- **原生视图下的点击**：`WebContentsView` 叠在界面上时，它下面的 DOM 控件用户点不到；Playwright 的鼠标事件直接发给应用页面的 webContents，不经过窗口里的命中，e2e 点得到不说明用户点得到。e2e 用位置关系断言（控件和视图不相交）；要确认真实的命中，用 `PostMessageW` 把 `WM_LBUTTONDOWN` / `WM_MOUSEMOVE` 发到主窗口 HWND。模拟滚轮（`WM_MOUSEWHEEL`，屏幕坐标，`MK_CONTROL` 放在 wParam 里 Chromium 就当按着 Ctrl）时，那个点上的顶层窗口必须是被测窗口，否则 Chromium 直接丢掉：e2e 窗口是 cloak 的，要在应用自己的进程里（`app.evaluate` 里 `createRequire` 载 koffi）取消 cloak 再 `SetWindowPos` 置顶不激活，跨进程取消不了。

## 录制回放（`fixtures/tsp/` + `test/fake-omp/`）

- 回放按录制的时间间隔除以 `--speed` 放帧，录制里几十秒的空档回放里只剩几秒。要断言"过一会儿才消失"的状态（omp 的 `todoClearDelay`、toast 的 ttl），先在录制里找删它的那一帧，算出回放里的窗口，在窗口开始后紧接着断言，切语言这类慢操作放到发送之前。
- 要断言"只在生成中出现"的东西，先算它在录制里持续多久：除以 `--speed` 后不到几百毫秒，就把录制里之后的帧整体推后，并在用例里写明（`composer-loop.jsonl` 第 105 行起推后 40 秒）。
- 要"按了键 omp 才有反应"（Esc 中断、方向键选择、括号粘贴图片），先确认录制里那个键有 `{"dir":"in","verb":"k","body":"…"}` 条目；没有就在 omp 对按键的第一帧前面补一条，否则假 omp 按时间自己放帧，按键和帧谁先到看负载。`PI_TUI_TSP_RECORD` 录的新录制只记 TSP 消息不记按键，进 `fixtures/tsp/` 前补 `k` 行、删掉 `in` 方向的 `r blobs`；手搓录制时 blob 的 id 写内容的 sha256（`test/fixtures-lint.test.ts` 查这两条）。
- 从探针录制裁 fixture 时，只删 `resize` 这类不触发 omp 回应的输入；`toggle`、`select`、`action` 等用户事件要留着，e2e 里照着做一遍，否则回放里 omp 就像自己做了这件事。
- 只在"必须让进程不退出"时才在录制末尾加 `hang`：它让假 omp 关了 stdin 也不退，每个用例收尾都要等 5 秒超时强杀。
- 拿回放做性能或闪烁探针时，提示文字从测试或录制里原样复制，不要重打：假 omp 只在收到和录制逐字相同的 `send` 后才往下放，差一个标点就一直停在开头，探针照样"通过"。数字先过一遍"这次回放真的跑了吗"（数一下节点有没有在长）。

## 探针（一次性脚本，用完就删）

- 截图探针要替换 `window.studio` 的某个调用时，在打开会用到它的界面之前装好：界面一出现就读的数据会先打到真实 omp，失败结果留在 store 里，后面的截图都带着它。
- 假服务（`test/fake-openai/server.ts` 这类）和 omp 在同一个 node 进程时，用异步 `spawn` 起 omp，不用 `spawnSync`：它阻塞事件循环，假服务回不了请求，看起来像 omp 卡住。`omp -p` 不处理斜杠命令，要测 `/force:` 这类命令用 `--mode rpc` 发 `prompt`。
- `spawn` 起 `omp -p` 时 stdin 设成 `"ignore"`（`stdio: ["ignore", "pipe", "pipe"]`），并给子进程一个超时强杀：stdin 是管道时 omp 不退出。
- 输入框胶囊显示不对（模型、思考强度）时，用一次性 e2e 起真实 omp（临时 agent 目录、假 key、`resumeSession` 一个造的会话文件），每 0.7 秒打一次 `listTasks()` 的 `model / thinkingLevels` 和胶囊 DOM，看清是哪一段时间、哪个字段错；vitest 的任务池看不到服务进程目录晚到的那一段。
- 要让模型胶囊的思考强度刻度画出来，用真实 omp + 临时 agent 目录里一个 `reasoning: true` 的模型：假 omp 不回 `get_available_models`，`thinkingLevels` 为空，刻度一直不画。
- 假 omp 的 e2e 测了 CDP / 协议转接之后，再用真实 omp 跑一次"刚建好、什么都没做"的状态：测试自己扮演的客户端只按我们以为的协议走，真实客户端（puppeteer）还有它自己的前提（[browser.md](browser.md)「CDP 转接」）。
- 用 Electron 把静态 HTML（设计样张）渲染成 PNG：`webPreferences: { offscreen: true }` + `capturePage()`，一个进程只渲染一个文件，脚本里设硬超时。隐藏窗口（`show: false`）里页面不超过视口时不出新帧，`Page.captureScreenshot` 和 rAF 都一直不返回；同一进程第二次 `loadFile` 同一个文件报 `ERR_FAILED (-2)`。
- 真实 omp 的盲区实测和方法：[tsp-real-omp-probes.md](tsp-real-omp-probes.md)。查卡顿和 CPU 的方法：[performance.md](performance.md)。
