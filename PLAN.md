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
5. **遥测克制**：token、费用、速度默认不显示；上下文用到 70% 以上才在输入框里提示；子代理费用只在详情里出现。
6. **打磨标准参照 magpie**（[gui-shell 文档](https://github.com/yetone/magpie/blob/main/docs/subsystems/gui-shell.md)）：弹簧动效、遵守 reduced-motion、自绘覆盖式滚动条、窗口缩放时保住阅读位置、每个交互细节都有测试。

三张线框图（主界面 + 对话流、diff 评审、子代理泳道）在本次对话里定稿，阶段 1 转成高保真稿。

## 3. 已定的技术决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 起点 | 从零写，只参考别人的代码 | fork 会继承竞品的设计包袱。RPC 对接、Windows 进程管理可以参考 omp-desktop、gooey-pi 的实现（都是 MIT） |
| 外壳 | **Electron** | Codex 和 Claude 桌面版在 Windows 和 macOS 上都是 Electron；两个平台同一个 Chromium，打磨一次就行。Tauri 在 mac 上换成 WKWebView，要再调一遍 |
| 接 omp 的方式 | 子进程 `omp --mode rpc-ui`，NDJSON over stdio，协商协议 v2 | omp 的 SDK 要求 Bun，Electron 主进程是 Node，用不了 SDK |
| omp 来源 | **安装包不带 omp。** PATH 上已经有 omp 就直接用（见下一行）；没有时才照 Tern 的做法自己管理一份官方 omp：从官方构建服务（`build.stencil.so`）下载原版 exe 并校验 sha256，放进应用数据目录的 `omp/versions/<版本>.exe`（保留最近 3 个），`omp/bin/omp.exe` 是当前版本，写 `omp/manager.json` 让 omp 不自己更新；后台跟最新稳定版，优先下载差量补丁；问一次要不要加进 PATH。和终端共用 `~/.omp` | Tern 就是这么做的（本机实测，细节见 `problem.md` 第 2 题）。安装包小 |
| 已有 omp | **PATH 上已经有 omp 就直接用它，不另外下载，不碰 PATH。** 有管理者的（exe 上两级目录有 `manager.json`，比如 Tern）由管理者更新；用户自己装的（install.ps1、bun、npm、brew 等）由用户自己更新。启动时检查版本，低于支持的最低版本就提示升级，按钮执行 `omp update`（omp 会按自己的安装方式升级；brew、mise、nix 它只打印指引） | 终端和桌面端始终是同一个 omp，不会版本错位；不和用户的包管理器、Tern 抢 |
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

- [x] Electron 主进程启动官方 omp exe（`--mode rpc-ui`），协商 v2，发一个 prompt，完整收到流式事件，直到 `prompt_result`。（第 4 题）
- [x] 从官方构建服务下载 Windows exe，放在应用数据目录下运行，确认原生 addon 解压和 grep、bash 等工具都正常。（第 2 题）
- [x] 确认 `rpc-wire.generated.ts` 能不能从 npm 包直接引用；不能就自己从 omp 仓库生成或拷贝，随 omp 升级一起更新。（第 3 题）
- [x] 打开 `set_subagent_subscription: "events"`，跑一个会派子代理的任务，确认泳道图需要的开始时间、结束时间、模型、工具调用都拿得到。（第 5 题）
- [x] 写一个最小的 omp 插件，在 RPC 模式下调用 `ctx.annotations.submit`，确认能带上文件和行号，agent 也能收到。（第 1 题）
- [x] 能找到 PATH 上的 omp，读出版本和管理者（`manager.json`），并能直接用 Tern 管理的、install.ps1 装的 omp 跑通上面的流程。（第 2 题）

**出口条件**：任何一项不通，先回到这份计划重新评估（比如要等上游合并 PR，或者换一种实现方式）。

### 阶段 1：设计规范

- [ ] 设计 token：中英文字体栈、字号层级、间距、颜色（深色和浅色）、圆角、动效曲线和时长、reduced-motion 下的处理。
- [ ] 组件清单：任务行、状态点、消息、折叠的过程行、改动卡片、输入框和它的选项胶囊、审批对话框、diff 行、评论框、泳道。
- [ ] 主界面、对话流、diff 评审、子代理泳道四个界面的高保真稿，中英文各一套。
- [ ] "手感"检查清单，参照 magpie：滚动、流式渲染不跳动、窗口缩放保住阅读位置、快捷键、焦点管理。后面每个阶段都按这份清单验收。

### 阶段 2：骨架和对话

- [ ] 验证工具（先于界面代码）：Playwright 启动 Electron 并截图；RPC 录制回放的假 omp
- [ ] 应用外壳、单实例、窗口状态记忆、i18n 基础设施
- [ ] 侧栏任务列表（按项目分组、状态点、跨项目显示"等你确认"）
- [ ] 对话流：流式 Markdown、过程折叠、结论、改动卡片
- [ ] 输入框：模型、思考强度、worktree、审批模式；steer 和 follow-up 消息队列
- [ ] 审批和 ask 对话框（`extension_ui_request`）
- [ ] 会话历史：读 `~/.omp`，能接着终端里的会话继续
- [ ] 应用内登录和模型设置
- [ ] omp 管理：PATH 上已有 omp 时的版本检查和升级提示；没有 omp 时的首次下载和校验、后台更新（差量补丁、多进程加锁、替换正在运行的 exe）

完成后开始内测。

### 阶段 3：diff 评审

- [ ] 全屏评审模式：文件树、统一 / 并排 diff、暂存、丢弃
- [ ] 逐行评论、待发送队列、"发给 agent 修改"（走阶段 0 验证过的插件通道）
- [ ] agent 的改动说明面板

### 阶段 4：worktree 和 git

- [ ] 每个任务一个 worktree：新建、项目级 setup 脚本、合并回主分支、丢弃、清理
- [ ] commit、push、用 gh 开 PR

### 阶段 5：子代理泳道

- [ ] 在"已工作"折叠区里展开泳道：时间轴、各子代理的状态和模型、主代理的工具节奏
- [ ] 选中某个子代理看详情：费用、token、摘要、完整记录、只看它的改动
- [ ] 用 `steer_subagent` 和 `cancel_subagent` 干预子代理

### 阶段 6：内置终端

- [ ] xterm.js + node-pty，每个任务的终端在它的 worktree 目录里打开

### 阶段 7：发布准备

- [ ] Windows 安装包、桌面端自身的自动更新（和 omp 的更新分开）
- [ ] 代码签名（竞品都没签名，签了就是一个差异点）
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
| 用 `manager.json` 判断 PATH 上的 omp 由谁更新，这个约定没写进 omp 文档 | 判断错了影响也小：升级按钮执行的 `omp update` 碰到受管的 omp 只会提示去管理者那里更新，不改文件。阶段 0 验证 |
| 用户自己装的 omp 版本不受我们控制，可能很旧 | 定一个支持的最低版本，低于它就提示升级；CI 同时跑最低版本和最新版 |
| 插件补不了的能力只能等上游 | 尽早提 PR；阶段 0 先把要用的能力逐个跑通 |

## 8. 止损条件

- **omp 官方发布桌面端**：停下来，或者改成给官方贡献设计。

## 9. 待验证的前提

详细的验证方法和备选方案见 `problem.md`。

- `ctx.annotations.submit` 在 RPC 模式下能否精确对应到行（阶段 0 验证）。
- 官方 omp exe 放在应用数据目录下能否正常运行、能否直接用 Tern 管理的 omp（阶段 0 验证）。
- 差异化：已经在用 Tern 的 omp 重度用户为什么还要装 omp-studio。阶段 1 之前要有答案，先问内测候选人。
- "竞品在 Windows 上更粗糙"：推测，没有实际装过竞品对比。阶段 1 前装 gooey-pi 和 oh-my-pi-gui 实测。
- "竞品不好看是因为 agent 写的、用了默认样式"：推测，不影响决策。

## 10. 参考

- omp RPC 协议：omp 文档 `rpc.md`；插件 API：`extensions.md`；SDK：`sdk.md`
- [Codex 和 Claude 桌面版用 Electron 的来源](https://codenote.net/en/posts/famous-electron-apps-2026-research)、[ChatGPT mac 版换成 Electron 版 Codex](https://mjtsai.com/blog/2026/07/10/chatgpt-work-and-chatgpt-classic)
- [Codex App Server 是怎么做的](https://openai.com/index/unlocking-the-codex-harness)
- [Claude Code 桌面版快速上手](https://code.claude.com/docs/en/desktop-quickstart)
- [omp 社区关于远程和多会话的讨论 #6460](https://github.com/can1357/oh-my-pi/discussions/6460)
- 打磨标准：[magpie gui-shell](https://github.com/yetone/magpie/blob/main/docs/subsystems/gui-shell.md)
- 打包、更新、签名可以参考：[CC Switch](https://github.com/farion1231/cc-switch)（Tauri，但发版流程通用）
