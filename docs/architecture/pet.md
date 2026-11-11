# 桌面宠物

桌面上的一只像素宠物。它跟着任务状态换表情，会随使用成长、进化，偶尔说一句话。做法参照 Claude Code 的 `/buddy`：骨按种子确定性生成，魂交给 LLM 写一次。

仓库所有者定的事（2026-11-11）：

- 放在桌面上，可以拖到任何位置，不固定在 studio 窗口里。
- 宠物在原地动，不会自己在屏幕上走。
- 说话时只发任务状态和任务标题，不发对话内容。
- 显示和说话两个开关都默认开。
- 进化的每个阶段都画一套新的像素图。
- 不按历史用量补算经验，所有宠物都从蛋开始。
- 保留"重新孵化"，执行前要二次确认。
- 提供 `/pet` 命令。
- 不做"喊名字由宠物回答"。

界面见 spec §4.32。

## 代码

| 位置 | 作用 |
|---|---|
| `src/shared/pet/model.ts` | 类型：骨、魂、表情、`PetView`（宠物窗口每次重画用的全部数据）、`PetReaction`（一次性动作） |
| `src/shared/pet/bones.ts` | `rollBones(seed)`：FNV-1a 加 Mulberry32，按固定顺序抽出稀有度、物种、眼睛、帽子、闪光、属性 |
| `src/shared/pet/growth.ts` | 经验规则、每日上限、连续签到、等级、阶段、属性成长（纯函数） |
| `src/shared/pet/mood.ts` | `summarizeMood`（汇总所有任务）和 `PetTaskTracker`（从状态变化里认出成长事件） |
| `src/shared/pet/sprites.ts` | 7 个物种 × 4 个阶段的 16×16 像素图 |
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

- 用独立的 `BrowserWindow`：透明、无边框、置顶（`floating`）、不进任务栏、不可聚焦（点宠物不会抢走正在打字的窗口）、不可调大小。在 mac 上所有桌面（Space）和全屏应用里都能看到（未在 mac 上实测）。
- 窗口大小固定，宠物画在窗口底部正中，上方留给属性卡和气泡。拖到屏幕边缘时只保证宠物本身完整可见，窗口上方的透明部分可以伸出屏幕。窗口尺寸写在 `pet-window.ts` 的 `PET_WINDOW` / `SPRITE` 和 `pet.css` 的 `--pet-w` / `--pet-h`，两边要一致。
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

## 成长

规则在 `growth.ts` 的 `rules`，每种事件每天有次数上限：

| 事件 | 经验 | 每天上限 | 属性 |
|---|---|---|---|
| 跑完一轮 | 10 | 30 次 | 每 10 次智慧 +1 |
| 处理掉一个门 | 5 | 20 次 | 每 3 次耐心 +1 |
| 出错后修好 | 25 | 4 次 | 每次调试 +1 |
| 出错 | 0 | 3 次 | 每次混乱 +1 |
| 摸一下 | 1 | 10 次 | 每 5 次毒舌 +1 |
| 签到（当天第一次有事件） | 30 + 5 × 连续天数（最多算到 11 天） | 1 次 | 无 |

- 第 L 级累计需要 `20 × (L − 1)²` 点经验。阶段划分：Lv1 是蛋，Lv5 破壳成幼年，Lv15 成年，Lv30 完全体。按每天 150–250 点经验估算：两天破壳，约三周成年，约三个月到完全体。
- 属性 = 出生值 + 成长值，上限 100。属性只影响说话的语气，不影响 omp 干活。
- 升级和进化时冒一个提示，并强制说一句话（不受下面的说话间隔限制）。每天第一次事件会给签到经验，所以 Lv1 的宠物第一次被摸就会升到 Lv2（e2e 依赖这一点）。

## 存储

- `userData/pet.json` 存种子、魂、成长、位置和花费；骨不存，每次启动从种子重新计算。经验写得频繁，所以不放进 `settings.json`。只有主进程写这个文件，串行原子写。
- 文件损坏时逐字段回落：种子坏了就换一个新种子（等于重新孵化），其余字段坏了各自回到默认值，不会导致应用起不来。第一次启动时立即把新种子写盘。
- 重新孵化：右键菜单 → 弹出系统确认框（`warning`，默认按钮是取消）→ 换新种子，清空魂和成长，位置和花费保留（花费是这台机器的钱，不属于某一只）。
- 设置 `petEnabled` / `petTalk` 放在 `settings.json`，和其他设置一样推送给界面。

## 说话

起名和说话都用一次性的 `omp -p`，参数和可执行文件都和提示词优化（`prompt-enhance.md`）相同，cwd 是 `serviceCwd()`，不落会话，花的是用户自己在 omp 里登录的 provider 额度。模型（`chooseVoiceModel`）：配了 tiny 角色就用 `@tiny`，没配退到 `@smol`，读不到配置时交给 omp 自己解析 `@smol`（仓库所有者 2026-11-11 定：一句俏皮话用最小的模型）。思考强度跟着角色的 `:level` 后缀走。未打包时可以用 `STUDIO_TEST_PET_OMP` 换成假 omp（`fake-omp-print.ts` 的 `pet` 模式）。

- 发给模型的内容只有：宠物的物种、稀有度、属性、名字、性格，加上事件本身（任务状态 + 任务标题，或者"被摸了""升到 N 级""进化了"）。不带对话、文件和工具。
- 孵化：模型输出 `{"name","personality"}` JSON；解析失败或超长时这次不存，下次打开窗口（启动、关掉再打开、重新孵化）再试。同时只有一次在孵。还没孵化好时也可以先改名，这时性格留空。
- 说话的间隔：任务事件触发的一句至少隔 45 秒；被摸至少隔 20 秒才再说一句，间隔内只冒爱心。一次状态变化最多说一句：升级 / 进化那句（不看间隔）优先，其次是出错后修好的那句（不看间隔，`eventToVoice`），再次是跑完一轮或出错。在等你确认的那一刻说一次。
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

- `test/pet-model.test.ts`：骨的确定性和稀有度分布、帽子不越级、每日上限、连续签到、属性成长、进化阈值、表情汇总、事件识别、`pet.json` 的容错、说话用哪个模型、json 输出的解析、花费跨天清零和重新孵化不清。
- `test/e2e/pet.e2e.ts`：
  - 宠物窗口置顶、不可聚焦，页面上没有 `window.studio`。
  - 孵化后得到名字。
  - 孵化和说话的花费记进 `pet.json`，设置页显示今天和累计。
  - 摸一下：经验写进 `pet.json`，出现升级提示和气泡。
  - `petAction("card")` 打开属性卡。
  - 任务停在等你确认时，表情变成 `waiting`。
  - 关掉再打开，窗口回到原来的位置。
  - 屏幕外的位置会被夹回屏幕，种子保持不变。
- e2e 默认不启动宠物（`launch.ts` 设 `STUDIO_E2E_NO_PET=1`），因为多出来的窗口会干扰按"第一个窗口""所有窗口"取窗口的用例。测宠物的用例传 `"0"`。
- 没有自动测的部分：真实光标拖动（Playwright 移不动系统光标）、跨不同缩放比例的屏幕拖动、透明区域的鼠标穿透。这些要在真机上手动看。
