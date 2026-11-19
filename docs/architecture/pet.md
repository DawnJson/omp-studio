# 桌面宠物

桌面上的一只像素宠物。它跟着任务状态换表情，会随使用成长、进化，偶尔说一句话。做法参照 Claude Code 的 `/buddy`：骨按种子确定性生成，魂交给 LLM 写一次。

仓库所有者定的事（2026-11-11）：

- 放在桌面上，可以拖到任何位置，不固定在 studio 窗口里。
- 宠物在原地动，不会自己在屏幕上走。
- 说话不发任务和对话内容（2026-11-19 起只在被摸、升级、进化时说，任务事件不说）。
- 显示和说话两个开关都默认开。
- 进化的每个阶段都画一套新的像素图（2026-11-19 起：48×48，7 个阶段，成年分两条路线，16 个物种）。
- 不按历史用量补算经验，所有宠物都从蛋开始。
- 保留"重新孵化"，执行前要二次确认。
- 提供 `/pet` 命令。
- 不做"喊名字由宠物回答"。

界面见 spec §4.32。

## 代码

| 位置 | 作用 |
|---|---|
| `src/shared/pet/model.ts` | 物种表和属性（元素）、阶段、路线、表情，`PetView`、`PetReaction` 等类型 |
| `src/shared/pet/bones.ts` | `rollBones(seed)`：FNV-1a 加 Mulberry32，按固定顺序抽出稀有度、物种、（空抽一次）、帽子、闪光、属性 |
| `src/shared/pet/growth.ts` | 经验规则、每日上限、连续签到、等级、阶段、属性成长（纯函数） |
| `src/shared/pet/mood.ts` | `summarizeMood`（汇总所有任务）和 `PetTaskTracker`（从状态变化里认出成长事件） |
| `src/renderer/src/pet/sprites/`、`sprite-meta.ts`、`sprites.ts` | 16 个物种 × 10 张 48×48 PNG，每张的眼睛方框和头顶；`scripts/pet-sprites.ts` 从美术目录导入 |
| `src/renderer/src/pet/elements.ts` | 每种属性的粒子和光圈颜色、按等级算气势 |
| `src/shared/pet/pet-ipc.ts` | 宠物窗口的 `PetApi` 和通道名 |
| `src/main/pet/pet-window.ts` | 窗口的创建、安全设置、拖动、鼠标穿透、把位置夹回屏幕、宠物窗口的 IPC |
| `src/main/pet/pet-service.ts` | 开关窗口、接收任务状态、记成长、孵化、说话、右键菜单、改名、重新孵化 |
| `src/main/pet/pet-store.ts` | `userData/pet.json` 的读取、校验和串行原子写 |
| `src/main/pet/pet-voice.ts` | 起名和说话：`omp -p` 的提示词和对输出的解析 |
| `src/main/ipc/pet-handlers.ts` | 主窗口用的 `setPetEnabled` / `setPetTalk` / `petAction` / `renamePet` / `getPetSpend` |
| `src/preload/pet.ts` | 宠物窗口的 preload（打包成 `pet.cjs`） |
| `src/renderer/pet.html`、`src/renderer/src/pet/` | 宠物页面（第二个 HTML 入口） |
| `src/renderer/src/features/pet/pet-slash.ts` | `/pet` |

## 窗口

- 用独立的 `BrowserWindow`：透明、无边框、置顶（`floating`）、不进任务栏、不可聚焦（点宠物不会抢走正在打字的窗口）、不可调大小。
- **置顶**：
  - mac 上是 `type: "panel"`（NSPanel）+ `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })`：所有桌面（Space）和别的应用的全屏里都能看到，应用照常有 Dock 图标、菜单栏、在强制退出列表里（#16）。实测（GitHub 的 macOS 15 机器，Electron 44，2026-11-13；临时探针分支用 `screencapture` 截图 + `CGWindowListCopyWindowInfo` 查屏上窗口 + `lsappinfo` 查应用类型，另起一个 Electron 进程全屏）：普通窗口不加 `skipTransformProcessType` 时 Electron 把整个进程改成 UIElement（没有 Dock 图标），而且照样浮不到别的应用的全屏上，`screen-saver` 层级也一样；加上它、不用 panel，Dock 回来了但全屏上看不到宠物；只有 panel 两样都有。
  - Windows 上置顶窗口之间按激活先后排：后激活的置顶窗口（如开了“总在最前”的编辑器）会盖住宠物，而宠物不可聚焦、自己不会被激活（#18）。所以主进程用 `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)`（`platform/win32/ffi.ts` 的 `onForegroundChange`）监听前台窗口变化，每次变化都 `moveTop()` 把宠物提回置顶层最上面，不抢焦点、不轮询。实测（本机，2026-11-13）：另一个置顶窗口 `SetForegroundWindow` 之后，有监听时宠物在它上面，去掉监听时在它下面；宠物自己的确认框（临时可聚焦）、主窗口最小化再还原都不会丢掉置顶。没写成 e2e：要让别的窗口真的变成前台，会抢走正在用这台电脑的人的键盘焦点。
- 窗口大小固定，整个留在屏幕工作区里（`pet-window.ts` 的 `arrange`）。宠物平时画在窗口底部正中，上方留给属性卡和气泡；宠物贴近屏幕上边、上方放不下时，窗口改成宠物在顶边、浮层在下方；贴近左右边时窗口夹在屏幕里，宠物偏到窗口一侧。宠物在窗口里的位置（`PetLayout`）由主进程算好推给页面（`getLayout` / `layout` 事件）。`pet.json` 存的位置始终是"宠物在底部正中时窗口的左上角"，夹回屏幕只保证宠物本身完整可见。拖动中不重新摆（宠物和窗口一起跟着光标），松开后再摆；靠边松手时窗口挪动和页面换位置不是同一帧，宠物可能闪一下（推测，未实测）。窗口尺寸写在 `pet-window.ts` 的 `PET_WINDOW` / `SPRITE` 和 `pet.css` 的 `--pet-w` / `--pet-h`，两边要一致。
- 鼠标穿透：窗口默认 `setIgnoreMouseEvents(true, { forward: true })`。页面根据转发来的 mousemove 判断指针是否在带 `data-pet-hit` 的元素上，在的时候调 `setInteractive(true)`。拖动过程中不改穿透状态，否则松开鼠标的事件到不了页面。Linux 不支持 `forward`，那里透明区域的点击会被窗口挡住（推测，未实测）。
- 拖动不用 `-webkit-app-region: drag`，因为 Windows 上拖动区会吃掉单击和右键。做法是：按下时调 `dragStart`，主进程每 10ms 按 `screen.getCursorScreenPoint()` 用 `setBounds` 移动窗口（不用 `setPosition`：在缩放比例不同的两块屏之间拖时，它会把窗口尺寸也改掉）。松开时调 `dragEnd`，主进程把位置夹回屏幕并写进 `pet.json`。按下后移动不到 4px 算单击，单击延迟 260ms 生效，以便和双击区分开。
- 拔掉显示器、改分辨率（`display-removed` / `display-metrics-changed`）时重新夹回屏幕。还没摆过的宠物放在主屏工作区右下角。
- 改名时临时让窗口可聚焦（`setEditing`），改完恢复不可聚焦。
- 退出走 `shutdown.ts` 的 hook：取消进行中的 omp 调用，销毁窗口，等 `pet.json` 写完。`hide-on-close.ts` 跳过宠物窗口（它不该被当成主窗口隐藏）。
- 主窗口第一次淡入后才启动宠物（`index.ts` 的 `afterFirstReveal`），避免和首帧抢资源。

## 安全

`security.md` 的「窗口和页面」规则对宠物窗口同样适用：开沙箱和上下文隔离，只加载 `app://studio/pet.html`，禁止导航和新开窗口，页面套同一份 CSP。

preload 用单独的 `pet.cjs`，只暴露 `PetApi`；页面上没有 `window.studio`（e2e 会检查）。主窗口的 `assertTrustedSender` 只认主窗口，所以宠物窗口调不动任何 `studio:*` 通道。`pet:*` 通道只认宠物窗口的顶层页面（`isPetUrl`），改名的参数在主进程校验。

## 状态

`runtime.ts` 每收到一次 `state` / `taskRemoved` 事件，就带上最新的任务列表调用 `petOnTaskState` / `petOnTaskRemoved`。

- 表情的优先级：有任务等你（`waiting`）> 有任务出错（`error`）> 有任务在跑（`running`，`starting` 也算）> 空闲（`idle`）。任务跑完一轮后，只要没有更高优先级的状态，就显示 4 秒 `done`。
- 成长事件（`PetTaskTracker`）：
  - `running → idle` 算跑完一轮（turn）。如果这个任务之前出过错，再算一次修好（recovered）。
  - 从 `needs_you` 变成 `stopped` / `error` 以外的状态，算处理掉一个门（gate）。
  - 变成 `error` 算出错。
  - `starting → idle`（启动、恢复）不算任何事件。
  - 输出 token（output）：`sessionUsage.tokens.output` 是会话累计输出，主进程每结束一次模型请求就重读会话文件更新它（`tsp-composer-observer.ts` 的 `#refreshTotals`），所以每次请求后几秒内就到。每个任务第一次读到有用量的值只当基准（`--resume` 的旧会话一上来就是整段的累计）；之后涨多少记多少；变小 = 换了会话（`/new` 等），重新当基准；`null` 或全 0（还没读到）不算。代价是新会话第一次请求写出的 token 不计经验（分不清"新会话第一条"和"刚恢复的旧会话"）。
  - 成就：一个待办阶段的条目全部完成（放弃的算完成，至少一条真完成）、`prNumber` 从无到有。只在 agent 干活时算（这次或上一次状态是 `running`）：打开 / 恢复旧任务时，旧待办和标题后缀里分支已有的 PR 号是在 `starting` / `idle` 里读出来的，只当基准；代价是用户空闲时在待办板上手动勾完的阶段不算。目标完成走另一条路：`tsp-runner.ts` 的 `goal_complete` 通知（`petOnTaskNotice`）。
  - 成就当天超过上限时只记 key、不撒彩纸，免得一口气做完很多阶段时撒个不停。

## 成长

规则在 `growth.ts` 的 `rules`，每种事件每天有次数上限：

| 事件 | 经验 | 每天上限 | 属性 |
|---|---|---|---|
| 输出 token | `94 × log2(1 + 当天输出 ÷ 5 万)`，每次给曲线涨出来的那一截 | 无（对数封顶） | 无 |
| 跑完一轮 | 0 | 30 次 | 每 10 次智慧 +1 |
| 处理掉一个门 | 12 | 20 次 | 每 3 次耐心 +1 |
| 出错后修好 | 59 | 4 次 | 每次调试 +1 |
| 出错 | 0 | 3 次 | 每次混乱 +1 |
| 摸一下 | 2 | 10 次 | 每 5 次毒舌 +1 |
| 一个待办阶段做完 | 70 | 10 次 | 每 2 次耐心 +1 |
| 目标完成 | 282 | 3 次 | 每次智慧 +1 |
| 开了 PR | 235 | 5 次 | 每次调试 +1 |
| 签到（当天第一次有事件） | 70 + 12 × 连续天数（最多算到 11 天） | 1 次 | 无 |

- 数值按"正常每天用约一年满级"定：正常每天约 350–700 点，按 530 点算满级（192,080 点）约 363 天。加快时只放大每个事件给的经验（约 ×2.35），升级曲线不变，已有宠物的等级不跳（仓库所有者 2026-11-19 定）。
- 经验来自"干了多少活"（输出 token），不来自"跑了几轮"，也不按 token 总数或花费：总数 97–99% 是缓存读取，跟上下文长短走，不跟干了多少走；花费随模型价格变（仓库所有者 2026-11-11 定）。一天写 20 万 token 约 218 点，100 万约 412，350 万约 577。
- 待办阶段和 PR 带 key（`todo:<任务>:<阶段名>`、`pr:<cwd>#<号>`），记在 `growth.achieved` 里（留最近 200 个），同一项只算一次，跨重启也不重复。成就时宠物窗口撒一阵彩纸（`celebrate` 动作）。
- 第 L 级累计需要 `20 × (L − 1)²` 点经验，最高 Lv99。阶段：Lv1 蛋、Lv5 幼年、Lv12 少年、Lv25 青年、Lv45 成年、Lv70 完全体、Lv85 觉醒（`growth.ts` 的 `stageLevels`，注释里有按每天经验估的时间）。
- 成年那一刻按属性定路线（`branchOf`）：混乱、毒舌里高的那项严格高过调试、耐心、智慧里最高的就走捣蛋（`-b` 那套图），否则稳健（`-a`）。定下后存进 `pet.json`，以后属性再变也不换。读到已经过了成年、还没定路线的记录（老文件）时，启动时按当时属性补定。
- 属性 = 出生值 + 成长值，上限 100。属性只影响说话的语气，不影响 omp 干活。
- 升级和进化时冒一个提示，并强制说一句话（不受下面的说话间隔限制）。每天第一次事件会给签到经验，所以 Lv1 的宠物第一次被摸就会升到 Lv2（e2e 依赖这一点）。

## 像素画

- 每个物种 10 张 48×48 透明 PNG：`egg`、`baby`、`child`、`teen`，`adult` / `final` / `awakened` 各有 `-a`（稳健）和 `-b`（捣蛋）。图是 AI 生成后缩成 48 格、每格一个颜色，再人工检查的；不用现成素材（许可证不干净），设计不照搬任何游戏的角色。
- 导入：`node scripts/pet-sprites.ts <美术目录>`。目录下每个物种的 `48/` 里放 10 张 PNG 和 `meta.json`（每张两只眼睛的方框、头顶位置）；脚本复制 PNG、生成 `sprite-meta.ts`，缺图或眼睛不是恰好两只（蛋必须没有）就报错。生成用的提示词和缩图脚本不进仓库。
- 眼睛的方框给表情用（spec §4.32）：脸色和墨色在宠物窗口里第一次加载这张图时从像素里取，不存。

## 存储

- `userData/pet.json` 存种子、物种、路线、魂、成长、位置和花费；骨的其余部分不存，每次启动从种子重新计算。经验写得频繁，所以不放进 `settings.json`。只有主进程写这个文件，串行原子写。
- 物种孵化时抽出来就存下：物种表以后再加物种，已经孵出来的那只也不变。没有 `species` 字段的老文件按最早的 7 种（`firstSpecies`）重抽，抽出的就是原来那只；抽物种之后的那一抽（原来抽眼睛样式）照抽不用，所以帽子、闪光、属性也不变。
- 重新孵化：右键菜单 → 宠物窗口里弹 studio 样式的确认框（`confirmRehatch` 动作，确认后 `PetApi.rehatch`；不用系统对话框，仓库所有者 2026-11-11 定）→ 换新种子、按完整物种表抽物种，清空路线、魂和成长，位置和花费保留（花费是这台机器的钱，不属于某一只）。

## 说话

起名和说话都用一次性的 `omp -p`，参数和可执行文件都和提示词优化（`prompt-enhance.md`）相同，cwd 是 `serviceCwd()`，不落会话，花的是用户自己在 omp 里登录的 provider 额度。模型（`chooseVoiceModel`）：配了 tiny 角色就用 `@tiny`，没配退到 `@smol`，读不到配置时交给 omp 自己解析 `@smol`（仓库所有者 2026-11-11 定：一句俏皮话用最小的模型）。思考强度跟着角色的 `:level` 后缀走。未打包时可以用 `STUDIO_TEST_PET_OMP` 换成假 omp（`fake-omp-print.ts` 的 `pet` 模式）。

- 只在三种时候说话（仓库所有者 2026-11-19 定）：被摸、升级、进化。任务跑完、出错、等你确认、成就都不说话，只换表情、撒彩纸。
- 发给模型的内容只有：宠物的物种、稀有度、属性、名字、性格，加上"被摸了""升到 N 级""进化成某阶段"。不带任务、对话、文件和工具。
- 孵化：模型输出 `{"name","personality"}` JSON；解析失败或超长时这次不存，下次打开窗口（启动、关掉再打开、重新孵化）再试。同时只有一次在孵。还没孵化好时也可以先改名，这时性格留空。
- 说话的间隔：被摸至少隔 20 秒才再说一句，间隔内只冒爱心；升级、进化不看间隔。一次状态变化里连升几级只说第一句；进化那一级说进化，不再说升级。
- 说话开关关着、还没孵化好、或宠物窗口没开时，都不调用模型。失败只记日志，不弹提示。

实测（omp 在 PATH 上，临时 agent 目录，`STUDIO_TEST_MODEL`，2026-11-11）：中文起名和说话各一次都正常返回，每次约 3 秒。例：名字"小耐"；任务"修复登录页的样式"跑完后说"登录页修完啦，要是你桌面也这么整齐我就敢动了。"

## 花费

- 起名和说话都带 `--mode json` 调 omp，从 assistant 消息的 `message_end` 取文字和 `usage`（`parseJsonOutput`）：token 用 `usage.totalTokens`，钱用 `usage.cost.total`（omp 自己按模型价格算；2026-11-11 实测的事件格式）。`--no-session` 的调用会不会进 `omp stats` 没核实。
- 每次调用结束、只要 omp 报了用量就记账，失败的调用也记（可能已经花了钱）；被取消的调用拿不到用量，不记。
- `pet.json` 的 `spend`：`total` 累计，`today` 只记 `day` 那一天（本地日期），跨天后第一次记账时清零；设置页读的时候 `day` 不是今天就显示 0。
- 不带 MCP 工具：omp 没有关 MCP 的参数，`--no-tools` 只关内置工具；`--tools <名字>` 也挡不住，MCP 会挂成 `xd://` 设备，还可能多出 `write`。所以宠物的调用设 `OMP_MCP_TIMEOUT_MS=1`（omp 文档里的环境变量，只给这个子进程）：1ms 内没就绪的服务器这次不用，stderr 一条警告，MCP 子进程照常收掉。不写 `~/.omp`，终端版 omp 不受影响。2026-11-11 实测，装了 3 个 MCP 服务器的机器上，回一个 `ok` 从 6,895 token 降到 469；宠物说一句真话约 700 token、$0.00015，大头是输出。
- `--thinking off` 不用加：tiny 角色（`:low`）下一句话没有思考块，实测差不多。

## 入口

- 设置 → 通用 → 桌面宠物：显示、说话两个开关，今天和累计的花费。
- 右键菜单：摸摸、属性卡、说话（勾选项）、重新孵化…、打开 omp-studio、隐藏宠物。
- `/pet`：任务和草稿页都能用。不带参数或带 `card` 打开属性卡；`pet` 摸一下；`mute` / `unmute` 开关说话；`on` / `off` 开关显示；`rename <名字>` 改名。参数不认识时提示用法。宠物没显示时，`petAction` 会先把它显示出来。
- 双击宠物：打开 studio，有任务在等你时直接切到那个任务（`focusTask`）。

## 验证

- `test/pet-model.test.ts`：骨的确定性和稀有度分布、帽子不越级、每日上限、连续签到、输出 token 的对数经验（分几次给和一次给一样、跨天重算）、成就 key 去重、属性成长、7 个阶段的阈值、成年路线、老文件补物种、表情汇总、事件识别（输出 token 的基准和换会话、待办阶段、PR）、`pet.json` 的容错、说话用哪个模型、json 输出的解析、花费跨天清零和重新孵化不清。
- `test/e2e/pet.e2e.ts`：
  - 宠物窗口置顶、不可聚焦，页面上没有 `window.studio`。
  - 孵化后得到名字。
  - 重新孵化的确认框：Esc 和取消不动种子，确认后换新种子并重新起名。
  - 孵化和说话的花费记进 `pet.json`，设置页显示今天和累计。
  - 摸一下：经验写进 `pet.json`，出现升级提示和气泡。
  - `petAction("card")` 打开属性卡。
  - 任务停在等你确认时，表情变成 `waiting`。
  - 关掉再打开，窗口回到原来的位置。
  - 屏幕外的位置会被夹回屏幕，种子保持不变。
  - 满级的老文件（没有物种、路线）：补存物种和路线，觉醒形态带 6 颗粒子和光圈，属性卡名字前有 ★、显示陪伴天数。
- e2e 默认不启动宠物（`launch.ts` 设 `STUDIO_E2E_NO_PET=1`），因为多出来的窗口会干扰按"第一个窗口""所有窗口"取窗口的用例。测宠物的用例传 `"0"`。
- 没有自动测的部分：真实光标拖动（Playwright 移不动系统光标）、跨不同缩放比例的屏幕拖动、透明区域的鼠标穿透、眼睛跟光标（主进程每 200ms 读一次 `screen.getCursorScreenPoint`）。这些要在真机上手动看。
- 没有在真 omp 上测的：`sessionUsage.tokens.output` 是否包含子代理的 token（读代码推测只算主会话）；待办阶段和 PR 两个成就只在单测里用构造的状态测过，目标完成（`petOnTaskNotice`）没有自动测。
