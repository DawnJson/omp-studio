# omp-studio 计划

> 工作名，公开前再定正式名（不用 "Oh My Pi" 作产品名，避免被当成官方）。
> 记录日期：2026-10-17。来源：一次 grill-me 访谈，决策都经过确认。

## 1. 目标与定位

- **目标**：做成有人用、长期维护的开源项目（MIT）。
- **是什么**：oh-my-pi（omp）的桌面端，形态对标 Codex 桌面版、Claude Code 桌面版。
- **招牌（首发只靠这一点让人记住）**：设计和手感。功能不比竞品多，但每一处都更克制、更顺。
- **后续的差异点**：评审闭环、omp 专属能力（子代理、多模型角色）、中文用户。
- **投入**：每周 15 小时以上。
- **主平台**：Windows 优先打磨，macOS 后补。

### 竞品现状（2026-10 调研）

| 项目 | 栈 | 现状 |
|---|---|---|
| **[Tern](https://github.com/theblazehen/awesome-tern)（头号竞品）** | Stencil 官方，Rust 原生 | 终端 + 多路复用器，不是任务式桌面端。omp 对话在终端面板里原生渲染，有批准按钮、语音输入、浏览器画中画、git 视图；桌面、iOS、网页都能连同一个会话；关掉窗口会话也不断。负责安装和更新用户的 omp。omp 重度用户（内测对象）很可能已经在用 |
| [gooey-pi](https://github.com/am-will/gooey-pi) | Electron | 布局最像 Codex，但粗糙；同时服务 Pi/OMP/Prime，omp 特性没做透 |
| [oh-my-pi-gui](https://github.com/nornzach/oh-my-pi-gui) | Electron，自带 fork 的 omp | 像后台管理系统：侧栏 9 个功能入口压住会话列表，遥测常驻 |
| [omp-desktop](https://github.com/apoc/omp-desktop) | Tauri 2 | 黑客终端风，遥测栏占 1/5 屏，工具卡片和 diff 全部展开在对话流里 |

三个第三方桌面端的共同问题：过程优先而不是结果优先，遥测常驻，导航层级混乱。

Tern 不触发止损（它是终端，不是 Codex 式桌面端），但 omp-studio 必须回答：**已经在用 Tern 的人，为什么还要装它**（见第 9 节）。

## 2. 设计原则

1. **结果优先**：每一轮先给一句结论、几条要点、一张改动卡片（文件数、测试结果、审查 / 提交 / 开 PR）。
2. **过程默认折叠**：工具调用收成一行"已工作 X 分 · N 次工具调用 · M 个子代理"，点开才看。
3. **diff 有专属位置**：评审是独立的全屏模式，不塞进对话流。
4. **一个主导航**：侧栏只放任务（带状态点：进行中 / 等你确认 / 完成）；命令、用量、设置收进 `Ctrl K` 和设置页。
5. **用量直接可见，其余遥测克制**：本会话消耗、上下文占用默认显示在输入框下方（仓库所有者 2026-10-18 改定，原为"默认不显示"）；速度等其他指标默认不显示；子代理费用只在详情里出现。
6. **打磨标准参照 magpie**（[gui-shell 文档](https://github.com/yetone/magpie/blob/main/docs/subsystems/gui-shell.md)）：弹簧动效、遵守 reduced-motion、自绘覆盖式滚动条、窗口缩放时保住阅读位置、每个交互细节都有测试。
7. **omp 的设置就是 omp-studio 的设置，omp-studio 只做交互**（仓库所有者 2026-10-18 定）：omp 已有的配置（审批模式、默认模型、思考强度等）一律读写 omp 自己的配置（经 `omp config` / RPC），omp-studio 不另存一份、不在启动参数里偷偷覆盖；omp 已有的能力直接用，不自己重新实现。omp-studio 自己只保存 omp 没有的纯界面偏好（语言、主题、减少动效、运行中 Enter 的行为、通知、进程上限）。

三张线框图（主界面 + 对话流、diff 评审、子代理泳道）在本次对话里定稿，阶段 1 转成高保真稿。

## 3. 已定的技术决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 起点 | 从零写，只参考别人的代码 | fork 会继承竞品的设计包袱。RPC 对接、Windows 进程管理可以参考 omp-desktop、gooey-pi 的实现（都是 MIT） |
| 外壳 | **Electron** | Codex 和 Claude 桌面版在 Windows 和 macOS 上都是 Electron；两个平台同一个 Chromium，打磨一次就行。Tauri 在 mac 上换成 WKWebView，要再调一遍 |
| 接 omp 的方式 | 子进程 `omp --mode rpc-ui`，NDJSON over stdio，协商协议 v2 | omp 的 SDK 要求 Bun，Electron 主进程是 Node，用不了 SDK |
| omp 来源 | **安装包不带 omp。** PATH 上已经有 omp 就直接用（见下一行）；没有时才照 Tern 的做法自己管理一份官方 omp：从官方构建服务（`build.stencil.so`）下载原版 exe 并校验 sha256，放进应用数据目录的 `omp/versions/<版本>.exe`（保留最近 3 个），`omp/bin/omp.exe` 是当前版本，写 `omp/manager.json`；**自管的 omp 由 omp-studio 自己检查和更新，从不对它执行 `omp update`**（阶段 0 实测：`manager.json` 只在 exe 是 PATH 上的 `omp` 时才拦得住 `omp update`）；后台跟最新稳定版，优先下载差量补丁（omp-studio 自带 HDiffPatch 实现，补丁不可用时退回全量）；装好后直接把 `bin` 放到用户 PATH 最前面（2026-10-18 改定，原为"问一次"）。和终端共用 `~/.omp` | Tern 就是这么做的（本机实测，细节见 `problem.md` 第 2 题）。安装包小 |
| 已有 omp | **用户自己装的和有别的管理者的（如 Tern），都照 Tern 问一次要不要接管**（仓库所有者 2026-10-18 确定）。用户自己装的（install.ps1、bun、npm、brew 等）和有管理者的（exe 上两级目录有 `manager.json`，比如 Tern）首次发现时用同一个弹窗问一次要不要由 omp-studio 接管：同意就按上一行自己管理一份，并把它的 `bin` 放到用户 PATH 最前面，原来那份（含 Tern 的目录和 `manager.json`）不删不改；拒绝就继续用原来那份（脚本形式的 `omp.cmd` 启动不了，拒绝时提示这种安装方式用不了）：用户自装的升级按钮执行 `omp update`，Tern 的由 Tern 更新 | 和 Tern 一致：Tern 能识别 Homebrew、Mise、Npm、Bun、install.ps1 几种来源，先问再接管，接管后放到 PATH 最前面（本机日志和 `tern.exe` 里的文字）。和 Tern 并存时各自的终端用各自那份（`docs/architecture/omp-install.md`） |
| 上游策略 | 只用官方正式版；缺的能力用自己写的 omp 插件补；补不了就给官方提 PR；**不 fork，也不打补丁** | 跑的是官方原版 exe，复用 Tern 时还是别人管理的 exe，补丁没地方打 |
| 界面语言 | 中英双语，第一天就做 | 设计规范同时覆盖两种字体和文案长度 |
| 仓库 | 独立仓库 `E:\work\code\omp-studio`，内测期间私有，公开时 MIT | |

### 已核实的 omp 能力（来自 omp 文档 `rpc.md`、`extensions.md`）

- RPC 有 wire schema，自动生成 TypeScript、Python、Rust、Go 类型；服务端的命令或事件没被 schema 覆盖时，omp 自己的 `bun check` 会失败。这说明协议是有人维护的契约。
- 子代理：`set_subagent_subscription`（`off` / `progress` / `events`），以及 `get_subagents`、`get_subagent_messages`、`cancel_subagent`、`steer_subagent`。泳道图的数据现成。
- 交互：`extension_ui_request`（select、confirm、input、editor、ask）走 RPC 往返；还有 host tools、host URI。
- extension API：`pi.on(...)` 生命周期事件、`sendMessage`，以及 `ctx.annotations.submit(...)`（"/annotate as an API, for boards and remote clients"），可以用来把逐行评论发给 agent。

```mermaid
flowchart LR
  UI[渲染进程<br/>React] <-- IPC --> Main[Electron 主进程]
  Main -- stdin NDJSON --> OMP[受管的官方 omp<br/>--mode rpc-ui]
  OMP -- stdout 事件 / UI 请求 --> Main
  OMP --- EXT[omp-studio 插件<br/>补缺失能力]
  OMP --> FS[(~/.omp<br/>和终端共用)]
  Main --> GIT[git / gh]
```

## 4. 首发范围

全部做完才公开（理由：第一印象只有一次）：

1. 主界面 + 对话流（结果优先、过程折叠、审批和 ask 对话框）
2. diff 评审：逐行评论攒起来，一次性发给 agent，agent 在同一个 worktree 里继续改
3. 子代理泳道视图
4. worktree 生命周期：新建、合并回主分支、清理
5. commit、开 PR（git + gh）
6. 内置终端
7. 应用内登录和模型设置

## 5. 阶段

阶段顺序是我的建议，可以调整。每个阶段做完后发给内测用户。

### 阶段 0：技术验证

在 Windows 上把下面几件事各跑通一次，每一项都给出能复现的结论。背景、验证方法、备选方案和结论都在 `problem.md`（每项后面括号里是对应的题号）：

- [x] Electron 主进程启动官方 omp exe（`--mode rpc-ui`），协商 v2，发一个 prompt，完整收到流式事件，直到 `prompt_result`。（第 4 题；另发现主进程被强杀时会留下孤儿进程，已定：Job Object 兜底，同时查原因给 omp 提 PR）
- [x] 从官方构建服务下载 Windows exe，放在应用数据目录下运行，确认原生 addon 解压和 grep、bash 等工具都正常。（第 2 题）
- [x] 确认 `rpc-wire.generated.ts` 能不能从 npm 包直接引用；不能就自己从 omp 仓库生成或拷贝，随 omp 升级一起更新。（第 3 题，部分通：类型能引用，运行时代码不能；已定：从 omp 的 tag 拷贝）
- [x] 打开 `set_subagent_subscription: "events"`，跑一个会派子代理的任务，确认泳道图需要的开始时间、结束时间、模型、工具调用都拿得到。（第 5 题；帧里没有时间戳，用主进程接收时间）
- [x] 写一个最小的 omp 插件，在 RPC 模式下调用 `ctx.annotations.submit`，确认能带上文件和行号，agent 也能收到。（第 1 题，部分通：只能带单行，没有行范围；已定：改用宿主自己格式化消息）
- [x] 能找到 PATH 上的 omp，读出版本和管理者（`manager.json`），并能直接用 Tern 管理的、install.ps1 装的 omp 跑通上面的流程。（第 2 题；Tern 的在 Electron 和 Node 脚本里都跑过，install.ps1 的 18.8.7 只在 Node 脚本里跑过）

**出口条件**：任何一项不通，先回到这份计划重新评估（比如要等上游合并 PR，或者换一种实现方式）。

### 阶段 1：设计规范

- [x] 设计 token：中英文字体栈、字号层级、间距、颜色（深色和浅色）、圆角、动效曲线和时长、reduced-motion 下的处理。（`src/renderer/styles/tokens.css`、`docs/design/spec.md` 第 2 章）
- [x] 组件清单：任务行、状态点、消息、折叠的过程行、改动卡片、输入框和它的选项胶囊、审批对话框、diff 行、评论框、泳道。（`docs/design/spec.md` 第 4 章；diff 行、评论框、泳道只有规范，阶段 3/5 实现）
- [ ] 主界面、对话流、diff 评审、子代理泳道四个界面的高保真稿，中英文各一套。
- [x] "手感"检查清单，参照 magpie：滚动、流式渲染不跳动、窗口缩放保住阅读位置、快捷键、焦点管理。后面每个阶段都按这份清单验收。（`docs/design/spec.md` 第 7 章）

### 阶段 2：骨架和对话

- [x] 主进程 omp 连接：找 PATH 上的 omp 并读管理者、启动、协商 v2、`rpc_chunk` 重组、按 id 对应应答、等 `prompt_result`、关闭和按进程树结束（`docs/architecture/omp-rpc.md`）
- [x] 验证工具：RPC 录制回放的假 omp（`docs/architecture/rpc-replay.md`）
- [x] 验证工具（先于界面代码）：Playwright 启动 Electron 并截图
- [x] 应用外壳、单实例、窗口状态记忆、i18n 基础设施
- [x] omp 子进程放进 Windows Job Object，主进程崩溃或被强杀也不留孤儿进程（`problem.md` 第 4 题；决策 D2：koffi。`test/job-object.test.ts` 用 fake-omp 的孙进程验证强杀后无残留；真实 omp 的 bash 工具强杀场景还没跑）
- [x] 查清 omp 在宿主被强杀时为什么不结束 bash 等子进程（`problem.md` 第 4 题）：宿主被强杀时 omp 是被系统（libuv 的 Job）直接结束的，来不及清理孙进程，不是 omp 的缺陷，不提 PR（对 libuv 一半已实测，孙进程不受 libuv Job 管；真实 omp 没单独验证，见 `docs/architecture/task-model.md`）
- [x] 侧栏任务列表（按项目分组、状态点、跨项目显示"等你确认"）
- [x] 对话流：流式 Markdown、过程折叠、结论、改动卡片（改动卡片的数字从工具事件推算，不是 git 结果）
- [x] 输入框：模型、思考强度、worktree、审批模式；steer 和 follow-up 消息队列（worktree 胶囊在草稿输入框，创建被拒绝时禁用并写明原因；e2e 验证，见 `git-worktree.e2e.ts`）
- [x] 审批和 ask 对话框（`extension_ui_request`）（带超时的门和 ask 门只有单测，没有回放 fixture 覆盖）
- [x] 会话历史：读 `~/.omp`，能接着终端里的会话继续（恢复走 `resume-history` 回放验证；真实终端会话恢复没实测）
- [x] 应用内登录和模型设置，含 omp 全部设置（555 项，经 `omp config`）（OAuth 没有真实账号实测）
- [x] omp 管理：PATH 上已有 omp 时的版本检查和升级提示；PATH 上的 omp 是脚本时询问是否接管；没有 omp 或用户同意接管时的首次下载和校验、放进 PATH、后台更新（差量补丁、多进程加锁、替换正在运行的 exe）（差量补丁用自带的 HDiffPatch TS 移植，补丁失败退回全量；实测 2026-10-18 真实构建服务 18.12.0 → 18.12.1 走补丁、sha256 一致；`omp update` 没实测）
- [x] 审批模式跟随 omp 自己的配置（仓库所有者 2026-10-18 要求，推翻 spec 决策 1"每次显式传 write"；同日再定：完全按 omp 设置来，omp-studio 不另存默认值）：启动时从不传 `--approval-mode`；输入框胶囊显示 omp 配置的 `tools.approvalMode`（没设置显示 omp 默认 `yolo`），选择即 `omp config set`；去掉设置页的"新任务的审批模式"和任务记录里的 `approvalMode`（实测 omp 18.12.1：胶囊从"全部自动"改成"每次询问"后 agent 目录 `config.yml` 写入 `always-ask`，新任务的 write 工具弹出审批门）
- [x] omp-studio 管理 omp 时和 Tern 一样做管理者：自己管的那份（PATH 上没有 omp 时下载的，或用户同意接管后下载的）装好后**直接**把 `bin` 放到用户 PATH 最前面，不再单独问"要不要加进 PATH"（去掉 `askAddToPath`）（仓库所有者 2026-10-18 要求；改时同步 `docs/architecture/omp-install.md`、`src/main/omp-manager/`）（IPC `answerAddToPath` 换成设置页用的 `addManagedOmpToPath`；真实下载写注册表只在单测里用假 PATH 验证）
- [x] 有别的管理者（如 Tern）时也问一次要不要接管，和用户自装的同一个弹窗；同意后自己管一份并放到 PATH 最前面，Tern 的目录和 `manager.json` 不碰；拒绝就继续用 Tern 的（仓库所有者 2026-10-18 定）。开工前先实测：omp-studio 的 bin 排在前面后，Tern 会不会把自己再放回最前面、Tern 自己的终端里用的是哪个 omp、Tern 的"接管"提示会不会把 omp-studio 那份当成别人的 omp 来处理（三个问题按 Tern 0.9.4 的日志、`state.json` 和 `tern.exe` 文字回答，没在真实 PATH 上排序后实测，结论和推测见 `docs/architecture/omp-install.md`"和 Tern 并存"；拒绝路径在开发机的 Tern 上 e2e 跑过）

### 阶段 2.5：工程基础（2026-10-18 盘点，内测前完成）

成熟软件的版本迭代和问题追查需要这些；都不涉及界面设计。前 5 项优先。

- [x] 版本号：SemVer，内测期用 `0.x`。当前第一版定为 `0.1.0`；修 bug 升第三位，加功能升第二位，公开发布定 `1.0.0`。每次发版打 git tag `v<版本>`，设置页"关于"显示版本号（`getAppInfo` 已能读到 `app.getVersion()`）（规则写在 `CHANGELOG.md` 开头，tag 由发版脚本打；0.1.0 还没发，没打 tag）
- [x] `CHANGELOG.md`：每个版本列新增、修复、变更，面向用户、中文；以后在线更新的"有新版本"提示从这里取（`npm run feed` 把该版本一节写进 `latest.yml` 的 `releaseNotes`；界面还没显示它）
- [x] 发版流程：改版本号、写 CHANGELOG、打 tag、打包，写成一个脚本，步骤写进 AGENTS.md 的命令表（`npm run release -- <版本>`；在临时克隆里完整跑过 0.1.0：单测、提交、tag、安装包、`latest.yml` 带说明）
- [ ] CI（GitHub Actions）：每次 push 跑 typecheck、单测、e2e；以后发版也在 CI 里打包（会用仓库所有者的 Actions 额度，开工前确认）（仓库所有者 2026-10-18：暂不接，等开发得差不多再开始）
- [x] 主进程日志：写到 `userData\logs\`，按天轮转，设置页能打开日志文件夹；不得记录 key，路径里的用户名要换掉（用库还是手写，开工前确认）（仓库所有者 2026-10-18：手写。`src/main/log/`，保留 14 天，脱敏规则见 `docs/architecture/logging.md`）
- [x] 代码格式和静态检查：`tsc` 只查类型，查不出 React hooks 用错（依赖数组漏写、条件里调用 hook）这类问题，也不管格式；多个 agent 写代码时格式不统一，diff 里会混进无关改动，干扰评审。~~Prettier + ESLint（typescript-eslint + react-hooks）~~ **改定（仓库所有者 2026-10-18）：Prettier（格式，行宽 120）+ Oxlint（静态检查）**。原因：typescript-eslint 8.71 要求 typescript <6.1，TS 7.0 的 npm 包没有编程 API，装上就崩（typescript-eslint issue #12518）；Oxlint 不依赖 typescript 包，自带 rules-of-hooks / exhaustive-deps。规则：correctness 全开 + 两条 hooks 规则；React Compiler 那批里 `preserve-manual-memoization`（不用 Compiler 时没意义）、`set-state-in-effect`、`refs`、`immutability`（把事件处理里改 `el.scrollTop` 这类 DOM 操作也算进去）关掉。命令 `npm run lint` / `npm run format` / `npm run format:check`；全仓格式化单独一个提交。CI 里一起跑（CI 还没接）
- [x] "导出诊断信息"按钮（版本号、omp 版本、最近日志，打包成一个文件）；在线崩溃上报以后再说（设置 → 关于 → 问题排查；一个脱敏后的 `.txt`，不压缩，免得新增依赖）
- [x] `LICENSE`（PLAN 定的 MIT）（版权人写的是仓库所有者的 GitHub 名 DawnJson）
- [x] README：是什么、怎么装、怎么开发
- [x] "帮助与反馈"改指向本仓库 Issues，加 bug 模板（要求附版本号和日志）（`.github/ISSUE_TEMPLATE/bug.yml` 要求填版本、附诊断信息；仓库私有期间内测用户要先被加为协作者才能提 issue）
- [x] Dependabot 每月提依赖升级；Electron 每 8 周一个大版本，要跟上安全更新（`.github/dependabot.yml`：npm 每月，分 electron / 开发依赖 / 运行时依赖三组）
- [ ] `main` 分支保护：CI 不过不能合并（CI 有了之后）

### 阶段 2.6：界面返工（仓库所有者 2026-10-18 反馈，先记录，未动）

总评：整体不满意。颜色和布局太像 Claude Code，可以借鉴，不能照抄，要有 omp-studio 自己的设计元素；界面要重新好好打磨。**已定：动手前先出新的设计方向给仓库所有者确认。**

**主界面**

- [x] 去掉输入框下方的历史会话列表；历史只在左侧侧栏（删除 ContinueList；空状态只留项目头 + 最近 3 个任务；侧栏搜索框可搜历史会话）
- [x] 输入框默认贴在主区底部（现在空状态时居中/偏上）（空状态和对话同一位置）
- [x] 输入框里的模型、思考强度控件：上边距太小，和上方贴得太紧；模型太多，选择器不好用。考虑改成单独弹窗：分组和搜索、思考模式、omp 里各模型的参数（上下文长度、能力等）（输入框分上下两层加 1px 分隔线；模型选择改为模态对话框：provider 分组 + 搜索，右栏上下文窗口/最大输出/图片/推理/价格，底部思考强度）
- [x] 显示上下文窗口占用（位置和样式待设计方向确认后调整）
- [ ] 加 plan 模式（和 auto 并列的执行模式）。**已查（omp 18.12.1 实测，2026-10-18）：RPC 没有进入 plan 模式的命令，也没有计划审阅的事件**。rpc-ui 下 69 个可用斜杠命令里没有 `/plan`，发 `/plan` 会被当成普通文本交给模型；`get_state` 里没有 plan 字段；`plan.defaultOnStartup: true` 被忽略（直接写了文件）。唯一能用的是启动参数 `--plan-yolo`：只读规划 -> **自动批准** -> 切到执行模型实现，用户看不到也改不了计划。计划审阅（`plan_review_requested` / `resolvePlanReview`）只在插件 API 里，由交互式 TUI 打开。可选路线：用 `--plan-yolo` 做"先规划再执行"（不能审阅）；写 omp-studio 自己的插件试接计划审阅（未验证 rpc-ui 下会不会打开）；给官方提 PR 加 RPC 命令。等仓库所有者选
- [x] 输入框下方**默认显示**本会话的消耗（omp 有用量数据，如 `get_session_stats`）。已定（2026-10-18），设计原则第 5 条已随之修改（位置和样式待设计方向确认后调整；`get_session_stats` 每次刷新状态时取，真实 omp 18.12.1 录了 `fixtures/rpc/session-stats`）
- [x] 主区内容面板的圆角不一致：左边有圆角，右边没有（临时方案：四角都圆，右/下留 8px）
- [x] 侧栏：新任务按钮上方加搜索框；"添加项目"移到上方（搜索框 → [新任务][添加项目] → 项目列表；搜索过滤任务并列出匹配的历史会话）
- [ ] 顶栏（状态栏）几乎照抄 Claude 桌面版，要重新设计，加入自己的元素
- [x] 设置按钮的图标是太阳，换掉（重画为带齿齿轮）
- [x] "帮助与反馈"链接指向的是 omp 官方仓库，改成本仓库（和阶段 2.5 的反馈渠道一项一起做）（指向 `issues/new/choose`）

**设置页**

- [ ] 整体杂乱，重新设计信息架构和排版
- [ ] 右侧内容框离窗口右边界太远，宽度利用不好
- [ ] 现在全是竖排，有的行中间大片留白；重新排版（标签和控件的对齐、行内布局、密度）
- [x] "模型与账号"每次进入都要等刷新：缓存上次结果，先显示再后台刷新（已做：缓存上次结果，进入先显示、后台刷新；e2e 验证）
- [ ] 自定义模型：现在第三方 API 要手写 `~/.omp/agent/models.yml`，改成在设置里直接添加和编辑 provider（base URL、key、模型）。一键拉取：填入第三方 URL（+ key）后，一键列出这个地址能访问的模型，勾选加入。先查 omp 的 `models.yml` 格式（`omp://models.md`）以及有没有对应的 RPC/命令；写入仍只能经 omp，没有写入接口就停下来问（已查 2026-10-18：omp 没有写 `models.yml` 的命令/RPC，未实现，等仓库所有者在 `login.md` 的四个方案里选）
- [x] omp 更新：可手动"检查更新"；自动检查改为每小时一次（已做：设置 → omp 所有来源都有"检查更新"，自管的直接装、自装/他人管理的只提示"有新版本"；ready 后马上查一次、之后每小时；见 `omp-install.md`）
- [x] omp 设置：原则是 **omp 有的，omp-studio 也要有**——把配置文件里常用的项都做进设置页；只有在 omp-studio 里不起作用、不影响它的项（TUI 外观、状态栏、终端相关等）才不放。做法：实际运行 omp（`omp config list --json` 和 RPC 模式下实测），逐项确认在 rpc-ui 下是否生效，结果写进 `docs/architecture/omp-settings.md`；剩下的重新分组，不再照搬 omp 的 tab（已做 2026-10-18：差分实测 316 项 + 行为实测，78 项终端专用隐藏，其余按 omp-studio 自己的 8 组重新分组；见 `omp-settings.md`；未逐个发真实请求验证的运行时项按文档保留）
- [x] 新增：订阅账号额度总览；近一年每日消耗热力图（先查 omp 的用量数据来源，如 `stats.db`，只读）。默认可见（同设计原则第 5 条）（已做：设置 → 用量，额度来自 `omp usage --json`，热力图来自 `stats.db` 只读；额度条没有真实订阅账号验证；见 `omp-usage.md`）

**后台运行**

- [ ] Tern、Codex 支持关掉窗口后任务继续跑（daemon）。已定：**先调研再实现**。调研 Tern、Codex 的做法，评估关窗口后主进程留在托盘继续跑任务，还是单独的后台服务进程；和"会话绑定 stdin、退出时关掉 omp"的现有规则怎么改；方案给仓库所有者确认后实现

完成阶段 2、2.5、2.6 后开始内测。

### 阶段 3：diff 评审

- [x] 全屏评审模式：文件树、统一 / 并排 diff、暂存、丢弃（`features/review/`，规范 `spec.md` §4.25；入口 ChangeCard "打开评审" / `Ctrl Shift D` / 命令面板；文件和 hunk 级暂存、取消暂存、丢弃（先确认），Shiki 高亮，j/k n/p v Esc；e2e `test/e2e/review.e2e.ts`）
- [x] 逐行评论、待发送队列、"发给 agent 修改"（宿主把评论格式化成一条带 `文件:行范围` 的用户消息，用 `prompt`、`steer` 或 `follow_up` 发送，不走 annotations 插件，见 `problem.md` 第 1 题）（点行号评论、Shift 点击选范围；队列在渲染进程 store，关闭评审后保留、发送成功才清空；运行中按输入框的 `enterWhileRunning` 选插话或稍后）
- [x] agent 的改动说明面板（右栏"改动说明"：从对话流里 edit / write / ast_edit 工具事件取每个文件的 intent 和那一轮的结论，`features/review/explain.ts`）

### 阶段 4：worktree 和 git

- [x] 每个任务一个 worktree：新建、项目级 setup 脚本、合并回主分支、丢弃、清理（输入框"工作树"胶囊；主区 git 条 + 侧栏任务行分支标记；合并结果 merged / nothing_to_merge / conflict（列文件）/ blocked 三种原因；丢弃先确认并归档任务；项目菜单"清理无主工作树"。**待仓库所有者决定：丢弃 worktree 后恢复该任务怎么处理**（`docs/architecture/git.md` 已知局限）。e2e 用真实临时仓库验证）
- [x] commit、push、用 gh 开 PR（主区 git 条的"Git"菜单：提交对话框（可先暂存全部）、推送（含被拒 / 无远端 / detached）、PR 对话框（先推送再 `gh pr create`；gh 不可用 / 未登录有提示）。e2e 验证提交和推送到本地裸仓库；`gh pr create` 成功路径没有测，只测了 gh 不在 PATH 的分支）

### 阶段 5：子代理泳道

- [x] 在"已工作"折叠区里展开泳道：时间轴、各子代理的状态和模型、主代理的工具节奏（过程行展开后顶部的"泳道"：主代理一行工具节奏 + 每个子代理一行起止/状态/模型/工具刻度；订阅级别用 `progress`，不开 `events`；e2e 用真实录制 `subagents-parallel` 回放；**嵌套子代理只有单元测试，没有 UI 样本**；泳道不落盘，应用重启后历史会话没有泳道。见 `docs/architecture/subagents.md`）
- [x] 选中某个子代理看详情：费用、token、摘要、完整记录、只看它的改动（点泳道一行就地展开；完整记录来自 `get_subagent_messages`，运行中每 3 秒刷新；"改动"只含这个子代理 edit/write 的文件；任务没有 omp 进程时读不到完整记录，只列泳道里已知的改动文件）
- [x] 用 `steer_subagent` 和 `cancel_subagent` 干预子代理（wire schema 里有这两条命令；真实 omp 经任务池实测：steer 后子代理的回答带上了插话内容，cancel 返回 `cancelled: true` 并先后收到 `aborted` 的 progress / lifecycle 帧；取消要二次确认。UI 流程用假 omp 的 e2e 验证，没有对真实 omp 开 Electron 点一遍）

### 阶段 6：内置终端

- [ ] xterm.js + node-pty，每个任务的终端在它的 worktree 目录里打开

### 阶段 7：发布准备

- [x] Windows 安装包和桌面端自身的自动更新（和 omp 的更新分开）：`npm run dist` 出 NSIS 安装包（用户目录，不需要管理员权限），`npm run feed` 出 `latest.yml`；设置 → 关于里检查更新、显示下载进度、重启并安装；启动后延迟 10 秒检查，之后每小时一次（`docs/architecture/auto-update.md`）。实测（2026-10-18）：本地静态服务器，安装版 0.1.0 检查到 0.1.1、下载、点击安装后应用关闭并自动重启，安装目录里的版本变成 0.1.1
- [ ] 正式更新源和渠道：`electron-builder.yml` 现在是 `publish: null`，安装版只有设置 `STUDIO_UPDATE_URL` 才能更新。需要定：更新文件放哪（源码仓库私有，Releases 需要 token，不能写进应用；可选：单独的公开 releases 仓库 / 对象存储 / 开源后用本仓库）、stable 和 beta 渠道、GitHub Actions 打 tag 自动构建上传
- [ ] 代码签名（竞品都没签名，签了就是一个差异点；不签名也能自动更新，只是首次安装弹 SmartScreen）
- [ ] CI 每天用最新的 omp 正式版和支持的最低版本各跑一遍 RPC 集成测试，提前发现上游变化
- [ ] 确定正式名称，写 README 和截图
- [ ] macOS 版（Electron 渲染一致，主要工作是打包、签名、公证）

## 6. 内测

- 从阶段 2 结束开始，找 3–5 个 omp 重度用户，私下分发，仓库保持私有。
- 每个阶段结束发一版，重点收集：会不会从终端或竞品换过来、哪里比竞品差。

## 7. 风险和对策

| 风险 | 对策 |
|---|---|
| **别人先做得更好**（访谈里最担心的一点） | 内测期间每月看一次竞品更新（Tern、gooey-pi、oh-my-pi-gui、omp-desktop、omp 官方动态） |
| 做完再公开，几个月没有外部反馈，做出只有自己喜欢的东西 | 阶段 2 结束就开始内测 |
| 范围大，研究生工作一忙就停 | 阶段之间独立、每个阶段都能用；阶段完成就打 tag |
| omp 上游变化把 RPC 对接搞坏（跟最新版，新版本会直接到用户手上） | 用 wire schema 生成的类型，按 schema 的解码规则容忍未知字段和帧；启动时检查 `protocolVersion`；CI 每天用最新正式版跑 RPC 集成测试，出问题当天修；保留最近 3 个版本，可以退回上一个 |
| 用 `manager.json` 判断 PATH 上的 omp 由谁更新，这个约定没写进 omp 文档 | 判断错了影响也小：升级按钮执行的 `omp update` 碰到受管的 omp 只会提示去管理者那里更新，不改文件。阶段 0 已实测，`omp update` 只认 PATH 上那个 omp 的 `manager.json`，所以升级按钮只对 PATH 上的 omp 用 |
| 用户自己装的 omp 版本不受我们控制，可能很旧 | 定一个支持的最低版本，低于它就提示升级；CI 同时跑最低版本和最新版 |
| 插件补不了的能力只能等上游 | 尽早提 PR；阶段 0 先把要用的能力逐个跑通 |

## 8. 止损条件

- **omp 官方发布桌面端**：停下来，或者改成给官方贡献设计。

## 9. 待验证的前提

详细的验证方法和备选方案见 `problem.md`。

- ~~`ctx.annotations.submit` 在 RPC 模式下能否精确对应到行~~：阶段 0 已验证，只能对应单行，评审改用宿主自己格式化消息（`problem.md` 第 1 题）。
- ~~官方 omp exe 放在应用数据目录下能否正常运行、能否直接用 Tern 管理的 omp~~：阶段 0 已验证，都能（`problem.md` 第 2 题）。
- 差异化：已经在用 Tern 的 omp 重度用户为什么还要装 omp-studio。阶段 1 之前要有答案，先问内测候选人。
- "竞品在 Windows 上更粗糙"：推测，没有实际装过竞品对比。阶段 1 前装 gooey-pi 和 oh-my-pi-gui 实测。
- "竞品不好看是因为 agent 写的、用了默认样式"：推测，不影响决策。
- **待讨论（仓库所有者 2026-10-18 提出）**：omp 在 RPC 模式下（桌面端就是这种模式）有几项默认值和终端版不同，`config.yml` 里没显式写时两边行为不一致。来源是 omp 文档 `rpc.md` 的 Startup 一节：不自动生成会话标题（`PI_NO_TITLE=1`）；`rpc-ui` 不用伪终端（`PI_NO_PTY=1`）；声明了 `protocolDefault` 的设置改用协议默认值，包括任务隔离/执行方式、memory、advisor 及其档位，RPC 还会固定后台任务和 bash/eval 自动转后台的默认值。要讨论的是：omp-studio 是否应该让这些项和终端版一致（比如显式读取并传入用户的终端默认值），还是接受差异、在设置页标明。

## 10. 参考

- omp RPC 协议：omp 文档 `rpc.md`；插件 API：`extensions.md`；SDK：`sdk.md`
- [Codex 和 Claude 桌面版用 Electron 的来源](https://codenote.net/en/posts/famous-electron-apps-2026-research)、[ChatGPT mac 版换成 Electron 版 Codex](https://mjtsai.com/blog/2026/07/10/chatgpt-work-and-chatgpt-classic)
- [Codex App Server 是怎么做的](https://openai.com/index/unlocking-the-codex-harness)
- [Claude Code 桌面版快速上手](https://code.claude.com/docs/en/desktop-quickstart)
- [omp 社区关于远程和多会话的讨论 #6460](https://github.com/can1357/oh-my-pi/discussions/6460)
- 打磨标准：[magpie gui-shell](https://github.com/yetone/magpie/blob/main/docs/subsystems/gui-shell.md)
- 打包、更新、签名可以参考：[CC Switch](https://github.com/farion1231/cc-switch)（Tauri，但发版流程通用）
