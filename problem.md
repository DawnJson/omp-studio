# 待验证问题

阶段 0（技术验证）要回答的三个问题。背景和整体决策见 `PLAN.md`。
每个问题回答后，把结论、验证用的 omp 版本和复现步骤写在对应小节的"结论"里。

---

## 1. `ctx.annotations.submit` 能否在 RPC 模式下带行号把评论发给 agent

**为什么重要**：diff 评审的核心交互是"逐行评论攒起来，一次性发给 agent，agent 在同一个 worktree 里继续改"。计划用一个自己写的 omp 插件，通过 `ctx.annotations.submit(...)` 把评论送进会话。这条路不通，评审闭环就要换实现。

**已知**（omp 文档 `extensions.md`）：
- `ctx.annotations` 的说明是"`/annotate` as an API, for boards and remote clients"。
- `submit({ source, notes, deliver?, review?, focus? })` 不需要任何 UI，直接构造 `/annotate` 会生成的反馈并投递。
- `source` 支持 `{ kind: "text", text, label? }`、`{ kind: "file", path }`（相对会话当前目录解析）、`{ kind: "last" }`。
- `open(...)` 只在 `mode === "tui"` 下可用；RPC 模式只能用 `submit`。

**不确定**：
- `notes` 的结构能不能表达"某个文件的第几行到第几行"，还是只能写自由文本。
- 宿主（桌面端）怎么调用到这个插件：通过插件注册的 slash 命令、host tool，还是别的通道。
- 在 agent 正在运行时提交，是 steer 当前这一轮，还是排到下一轮（看 `deliver` 参数）。

**验证方法**：
1. 写一个最小 omp 插件，注册一个命令，命令的参数是 JSON：`[{ path, startLine, endLine, body }]`。
2. 命令内部调用 `ctx.annotations.submit`，`source` 用 `{ kind: "file", path }`，把行号写进 `notes`。
3. 用 `omp --mode rpc-ui` 启动并加载这个插件，通过 RPC 的 `prompt` 发出这条命令。
4. 检查 agent 收到的消息里有没有文件和行号，再让它按评论改代码，确认改对了位置。

**备选方案**：不走 annotations，直接把评论格式化成一条带 `文件:行号` 引用的用户消息，通过 RPC 的 `steer` 或 `prompt` 发送。

**结论**：未验证

---

## 2. 照 Tern 的方式管理官方 omp exe 能否跑通

**为什么重要**：已决定安装包不带 omp。PATH 上已经有 omp（Tern 管理的或用户自己装的）就直接用；没有时照 Tern 的做法，从官方构建服务下载原版 exe，放进应用数据目录自己管理。两条路有一条跑不通，omp 来源的决策就要重新评估。

**已知**：
- oh-my-pi-gui 自带 agent，但它是从自己 fork 的 monorepo 源码编译 sidecar，要匹配版本的原生 addon `pi_natives`，不是直接拿官方发行版。
- 官方有构建服务，发布独立二进制：`GET https://build.stencil.so/api/products/omp/latest/<target>?channel=stable|canary`，Windows 的 target 是 `windows-x86_64` / `windows-arm64`（来自 omp 的 `scripts/install.ps1`）。返回 JSON 里有 `version`、`commit`、`file.size`、`file.sha256` 和一个 10 分钟有效的 `download` 链接；指定版本用 `/api/products/omp/versions/<version>/<target>`。2026-10-17 实测：18.12.0 的 `omp-windows-x64.exe` 是**单个 exe，222,411,264 字节**。
- 原生 addon 不在 exe 旁边，运行时解压到 `~/.omp/natives/<version>`（`PI_NATIVES_DIR` 可改）。所以单个 exe 放在任意目录理论上都能跑，待第 2、3 步实测确认。
- **Tern（Stencil 官方终端）就是这么用的**，本机实测（Tern 0.9.2，日志 `%LOCALAPPDATA%\Tern\Logs\tern.log`）：
  - Tern 安装包不带 omp。首次启动检测到用 `install.ps1` 装过的 omp，弹窗问要不要接管（日志 `offering omp kind=Takeover(Installer)`），只问一次（`omp/state.json` 的 `offered`）。
  - 从上面的构建服务下载官方 exe，按 size 和 sha256 校验。本机 `omp/state.json` 记的 sha256 和官方 18.12.0 的完全一致，说明是原版，没改过。
  - 目录：`%LOCALAPPDATA%\Tern\omp\versions\<版本>.exe` 保留最近 3 个版本，`bin\omp.exe` 是当前版本，`bin` 加进用户 PATH。所以终端里的 `omp` 和 Tern 用的是同一个，不存在版本错位。
  - 替换正在运行的 exe：先把旧的改名成 `.omp.exe.old-<时间戳>`，再放新的（Windows 不能覆盖运行中的 exe）。
  - omp 的更新和 Tern 自己的更新分开：每小时检查一次，优先下载相对已装版本的差量补丁（约 6–40 MB，全量是 222 MB），补丁还没出时会等一会儿（日志 `omp update waits for its patch`）。用 `check.lock`、`state.lock` 防止多个进程同时更新。
  - `omp/manager.json` 写的是 `{"manager":"tern","name":"Tern"}`。**omp 自己认这个文件**：可执行文件上两级目录里有 `manager.json` 时，`omp update` 只提示"由 Tern 负责更新"，不动文件，启动时的更新提示也不出现（omp 18.12.0 的源码和 CHANGELOG 都能看到）。这个机制不只认 Tern，但文档里没写，算不上公开约定。

**不确定**：
- exe 放在 omp-studio 的数据目录下、从任意路径启动时，原生 addon 解压和工具调用是否都正常（上面是推测，没实测）。
- omp-studio 自己写的 `manager.json` 能不能同样让 omp 不自己更新（从源码看是通用的，没实测）。
- 复用 Tern 管理的 omp 时，Tern 随时可能换掉 exe：正在运行的 RPC 子进程会不会受影响，新起的子进程能不能拿到新版本。
- 差量补丁怎么请求：Tern 日志里有，但 `install.ps1` 只用全量下载。要去 omp 的 `omp update` 代码里找补丁接口。

**验证方法**：
1. 用上面的接口下载当前稳定版的 Windows exe，校验 sha256，放进一个模拟的应用数据目录 `omp-studio\omp\bin\omp.exe`，在 `omp-studio\omp\` 下写 `manager.json`。
2. 把其他 omp 从 PATH 里去掉，从这个位置启动 `omp --mode rpc-ui`，走一遍完整的 prompt 流程，包括 grep、bash 等用到原生功能的工具。
3. 确认它读写的是用户的 `~/.omp`，能列出终端里已有的会话。对这个 exe 执行 `omp update`，确认只提示由 omp-studio 负责更新，没有改动文件。
4. 换成 Tern 管理的 `%LOCALAPPDATA%\Tern\omp\bin\omp.exe` 和 install.ps1 装的 `%LOCALAPPDATA%\omp\omp.exe` 各跑一遍第 2 步。运行中模拟一次更新（把 exe 改名，再放入新版本），看正在运行的子进程和新起的子进程各用的是哪个版本。

**备选方案**：
- 直接用 PATH 上的 omp 走不通：始终自己管理一份，不放上 PATH。
- 自己管理也走不通（比如 exe 离开安装位置就跑不起来）：退回原计划，安装包自带固定版本。

**结论**：未验证

---

## 3. `rpc-wire.generated.ts` 能否从 npm 包直接引用

**为什么重要**：计划用 omp 官方从 wire schema 生成的类型来写 RPC 客户端，不手写类型。这样 omp 升级时类型自动跟上，CI 能在编译阶段就发现协议变化。

**已知**（omp 文档 `rpc.md`）：
- wire schema 在 `packages/coding-agent/src/modes/rpc/wire`；`bun run gen:rpc` 会生成 `rpc-wire.schema.json`（JSON Schema 2020-12，带 `x-rpc` 命令表）和 `rpc-wire.generated.ts`。
- Python、Rust、Go 有现成的客户端包（`omp-rpc`），带进程传输层，负责 v2 协商、分块重组、`prompt_and_wait`；TypeScript 只有 `rpc-client.ts` 这个辅助封装，文档明确说它"不是协议定义"，而且默认用 `bun` 启动。
- 解码规则：标了 `x-open` 的对象要保留所有字段；字段的 `default` 用来兼容旧版服务端；字符串枚举是封闭的，遇到未知值应当把整帧当成未知通知，而不是报错退出。

**不确定**：
- npm 包 `@oh-my-pi/pi-coding-agent` 有没有导出 `rpc-wire.generated.ts` 或 `rpc-wire.schema.json`，路径是什么。
- 在 Node（Electron 主进程）里只引用类型会不会连带拉进 Bun 专属的运行时代码。

**验证方法**：
1. 在空的 Node 项目里安装和当前 omp 同版本的 `@oh-my-pi/pi-coding-agent`，查看包的 `exports` 和文件列表。
2. 用 `import type` 引用 wire 类型，用 `tsc` 编译，确认不引入运行时依赖。
3. 再试 `rpc-wire.schema.json` 能不能拿到，作为生成或校验的输入。

**备选方案**：
- 从 omp 仓库对应版本的 tag 拷贝 `rpc-wire.generated.ts`（或用 `rpc-wire.schema.json` 自己生成类型），放进本仓库，升级 omp 时一起更新。
- 参考 Rust 或 Go 客户端的传输层，用 TypeScript 写自己的进程传输层（v2 协商、分块重组、按 id 对应响应）。

**结论**：未验证
