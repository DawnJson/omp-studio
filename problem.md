# 待验证问题

阶段 0（技术验证）要回答的问题。第 1–3 题是计划阶段就列出的关键问题；第 4、5 题对应 `PLAN.md` 阶段 0 里另外两个复选框，验证时补上。背景和整体决策见 `PLAN.md`。
每个问题回答后，把结论、验证用的 omp 版本和复现步骤写在对应小节的"结论"里。实测的协议细节写在 `docs/architecture/` 下对应的文件里。

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

**结论**：部分通，可用。**建议评审闭环不依赖 annotations，宿主自己把评论格式化成一条用户消息发送**（即上面的备选方案）。仓库所有者确认后，再改 `PLAN.md` 阶段 3 里"走阶段 0 验证过的插件通道"这句。

- 实测环境：omp 18.12.0（Tern 管理），模型 `deepseek/deepseek-v4-flash`，2026-10-17。
- 复现：单文件插件 `export default function (pi) { pi.registerCommand("studio-review", { handler: async (args, ctx) => ctx.annotations.submit({ source: { kind: "file", path }, notes, deliver }) }) }`，用 `omp --mode rpc-ui --extension <插件绝对路径>` 加载，再通过 RPC `prompt` 发 `/studio-review <json>`。
- 不确定 1（行号）：文件源和文本源的 note 只有单个 `line`，**没有结束行**。`line` 在 agent 收到的消息里不是数字，会被渲染成该行源码的引用；行范围只能由插件写进 note 文本。`kind: "file"` 会把**整个文件**嵌进用户消息（31 行的文件约 1.1 KB，纯文本方式约 0.2 KB）。agent 改对了位置。
- 不确定 2（宿主怎么调用）：用 `prompt` 发 slash 命令，可行。命令能在 `get_available_commands` 里发现（`source: "extension"`）。**插件出错时 `prompt` 仍返回 `success: true`**，`prompt_result.agentInvoked` 为 `false`，错误只出现在 `extension_error` 帧里。没有"宿主直接调插件"的 RPC 命令。
- 不确定 3（运行中提交）：`deliver` 为 `auto` 或 `send` 时不会 steer，而是排进 followUp，当前这一轮结束后才处理。`paste` 只发 `set_editor_text`，不触发 agent。想要 steer，就用 `deliver: "none"` 拿回文本，再由插件调 `pi.sendUserMessage(text, { deliverAs: "steer" })`。
- 备选方案实测：直接 `prompt` 一句带 `calc.js:12-16` 的话，agent 的改动和 annotations 方式一样，消息小得多，行范围也由宿主完全控制；运行中用 RPC 自带的 `steer` 或 `follow_up` 就能选投递方式。
- 没测：同一文件多条 note 的渲染、`kind: "diff"` 和 `review: true`、`file` 源能否读到 worktree 外的文件（路径没被拦截，宿主必须自己限制在 worktree 内）。
- 细节见 `docs/architecture/review-comments.md`。

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

**结论**：通，但有一个影响计划的坑：**`omp update` 只认 PATH 上那个 `omp` 的 `manager.json`**。

- 实测环境：自管的官方 exe 18.12.0（中途换入 18.11.3）、Tern 管理的 18.12.0、install.ps1 装的 18.8.7，2026-10-17。
- 不确定 1：通。exe 放在任意目录、从子进程 env 的 PATH 里去掉其他 omp、用绝对路径启动，v2 协商、grep（原生实现）、bash、`prompt_result` 都正常，cwd 带空格和中文也没问题。原生 addon 解压到 `PI_NATIVES_DIR\<版本>\`（不设时是 `~/.omp/natives/<版本>`，每个版本约 115 MB），exe 旁边不需要别的文件。
- 不确定 2：**部分通**。omp 的 `omp update` 用 `which omp` 找 exe，再读那个 exe 上两级目录的 `manager.json`，而不是看当前运行的 exe（读源码 `resolveOmpPath()` 得知）。实测两种情况：
  - 自管目录在子进程 PATH 最前面时，`update`、`update --check`、`update --force` 都只提示"由 omp-studio 负责更新"，exe 的 sha256 和修改时间都不变。
  - **子进程 PATH 上找不到任何 omp 时，`manager.json` 不起作用，`omp update` 走 bun 路径，往用户的 bun 全局目录装了一份 omp**（本机装了 bun）。
  - 没测（推测）：PATH 上有别的 omp 时，`omp update` 会作用在那个 omp 上，比如显示"由 Tern 负责更新"，或者去更新 install.ps1 装的那个。没装 bun 的机器上会怎样也没测。
  - 所以 omp-studio 自己管理的 exe 一律由 omp-studio 用构建服务检查和更新，**不要对它执行 `omp update`**。受管时 `--check` 也被拦住，omp 没有"只检查不安装"的办法。
- **验证时对仓库所有者真实环境的副作用**：上面第二种情况真的执行了 `bun add -g`，改动了 `C:\Users\someone\package.json`（多了 3 个依赖）、`C:\Users\someone\node_modules\`（约 96 个包和 5 个 `.bin` 项）、`C:\Users\someone\.bun\bin\`（`omp.exe`、`omp.bunx`），还生成了 `bun.lock`。验证的 agent 用 `bun remove -g` 去掉了 3 个依赖，再按"创建时间晚于测试开始"删掉其余新增文件。复查时 `package.json` 只剩 `pro-image-mcp` 和 `yaml`，`node_modules` 下没有 3 小时内新建的条目，`.bun\bin` 只剩 `bun.exe`、`bunx.exe`，`where omp` 只有 Tern 和 install.ps1 的两个。没有测试前的快照，**无法证明和测试前完全一致**：`.bin` 里 `pro-image-mcp`、`yaml`、`node-which` 的 `.exe` 和 `.bunx` 修改时间变成了测试当天，`bun.lock` 原本是否存在也无从确认。请仓库所有者确认 `pro-image-mcp` 还能正常运行。
- 不确定 3：通。运行中的 exe 可以改名；改名后放入新版本，正在运行的子进程继续响应 `get_state` 和新 prompt，新起的子进程拿到新版本。改名后的 `.old-…` 文件要等进程退出才能删除。这是在自管副本上模拟的，没有碰 Tern 的文件。
- 不确定 4：从源码（`packages/coding-agent/src/cli/build-service.ts`）找到了接口：在全量接口后面加 `?from_version=<已装版本>`，应答多一个 `patch` 字段 `{ format: "file", from_sha256, size, sha256, url }`，格式是 HDiffPatch 单流，omp 用 `@oh-my-pi/pi-natives` 的 `applyBinaryPatch` 应用。补丁没生成好时返回 `patch_pending`。**没有线上实测**。omp-studio 要用补丁，就得自己带一个 HDiffPatch 实现，这需要决策；否则只用全量下载（222 MB）。
- PATH 发现：按 PATH 和 PATHEXT 找第一个 `omp`，执行 `omp --version`（输出 `omp/<版本>`），读 exe 上两级的 `manager.json`。本机 Tern 的读到 `{"manager":"tern","name":"Tern"}`；install.ps1 的上两级是 `%LOCALAPPDATA%` 本身，没有 `manager.json`，即未受管。本机 PATH 上同时有 Tern 的 18.12.0 和 install.ps1 的 18.8.7，取第一个，和终端里敲 `omp` 的结果一致。
- install.ps1 目录里的 `omp.exe.<时间戳>.<pid>.<序号>.bak` 是上次 `omp update` 留下的旧 exe（根据源码 `sweepStaleUpdateArtifacts` 推测），omp-studio 不要碰。
- 没测：启动时的更新提示（只在交互 TUI 里出现）、低于 18.8.7 的版本、读取 `~/.omp` 里已有终端会话（按规则没有在真实目录下运行）。
- 细节见 `docs/architecture/omp-install.md`。

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

**结论**：部分通。类型可以直接从 npm 包 `import type`；运行时代码不能直接从包里 import。**已定（2026-10-17）：从 omp 的 tag 拷贝生成文件进仓库，不装 npm 包。**

- 复现：在空目录里 `npm install @oh-my-pi/pi-coding-agent@18.12.0 --ignore-scripts`；写一个 `.ts` 文件 `import type { RpcWireCommands, RpcServerFrame, ReadyEvent } from "@oh-my-pi/pi-coding-agent/modes/rpc/wire/rpc-wire.generated"` 并实际使用；`tsc --noEmit --strict`，`moduleResolution` 分别取 bundler、node16、nodenext，`skipLibCheck` 开关都试；运行时用 `node` 直接 import `@oh-my-pi/pi-coding-agent/modes/rpc/rpc-frame`，再用 `esbuild --bundle --platform=node --format=esm` 打包后运行。
- 实测环境：`@oh-my-pi/pi-coding-agent@18.12.0`（npm 上的 latest，与本机 omp 同版本），TypeScript 5.9.3，Node 24，2026-10-17。
- 包里有 `src/modes/rpc/wire/rpc-wire.generated.ts` 和对应的 `dist/types/.../rpc-wire.generated.d.ts`。`import type … from "@oh-my-pi/pi-coding-agent/modes/rpc/wire/rpc-wire.generated"` 在 bundler、node16、nodenext 三种 moduleResolution 下 `tsc --noEmit` 都是 0 错误。文件没有任何 import，不会带进 Bun 类型，也不需要 `skipLibCheck`。不要引 `modes/rpc/rpc-types`：它会拉进 1493 个文件，不开 `skipLibCheck` 会报 37–45 个错误。
- 运行时：包里只发 `.ts` 源码，Node 24 拒绝加载 `node_modules` 下的 `.ts`。`rpc-frame.ts`（`RpcFrameDecoder`）本身不依赖 Bun，但依赖 `@oh-my-pi/pi-utils/type-guards`，还有一个只引类型的 `./rpc-types`；要用就得把 `type-guards.ts` 一起拷出来并改两处 import 路径，或者用 esbuild 打包。两种方式在 Node 下都跑通了，3 MiB 帧分 13 块重组正确。
- `rpc-wire.schema.json` 在包里（`src/modes/rpc/wire/`，124 KB），但 `exports` 访问不到，只能按文件路径读。
- 装整个包的代价：144 个包、约 1.06 GB（含 116 MB 的 win32 原生包）。
- GitHub tag `v18.12.0` 下 `packages/coding-agent/src/modes/rpc/wire/rpc-wire.generated.ts` 与 npm 包里的文件逐字节相同，所以可以不装包，直接按 omp 版本从 tag 拷贝 `rpc-wire.generated.ts`（49 KB），文件头记下来源版本。`rpc-wire.schema.json` 预计在 tag 的同一目录下，但没有和 npm 包里的逐字节核对。CI 可以下载对应 tag 做 diff，及时发现协议变化。
- 坑：`RpcResponse.data` 是 `unknown`，要用 `RpcWireCommands[K]["result"]` 自己对应到命令；`rpc_chunk` 的帧类型不在 generated 文件里。
- 细节见 `docs/architecture/omp-rpc.md`。

---

## 4. Electron 主进程能否启动 omp 并完整收到一轮流式事件

对应 `PLAN.md` 阶段 0 第 1 个复选框。

**结论**：通。另外发现一个必须在阶段 2 处理的问题：**主进程被强杀时，omp 会退出，但 bash 工具起的孙进程会留下来成为孤儿**。

- 实测环境：Electron 44.9.0（Node 24.22.0），PATH 上 Tern 管理的 omp 18.12.0，模型 `deepseek/deepseek-v4-flash`，临时 `PI_CODING_AGENT_DIR`，cwd 是带空格和中文的临时目录，2026-10-17。
- 复现：在 Electron 主进程里用 `child_process.spawn(ompPath, ["--mode", "rpc-ui", "--model", model], { stdio: "pipe", windowsHide: true })` 启动，key 通过 env 传入；按 `\n` 切行并重组 `rpc_chunk`；收到 `ready` 后发 `negotiate_protocol`，成功后发 `prompt`（让 agent 读一个文件），等到 `prompt_result` 和 `session_settled`，最后关闭 stdin。另外两个场景把 prompt 换成"用 bash 执行 `ping -n 60 127.0.0.1`"，在收到 bash 的 `tool_execution_start` 3 秒后，分别关闭 stdin、或在主进程里调用 `process.kill(process.pid, "SIGKILL")` 强杀自己（Windows 上即 `TerminateProcess`，stdin 不会被正常关闭），5 秒后再检查 omp 和它的子孙进程是否还在。
- 正常路径：约 0.65 秒收到 `ready`，协商在 30 ms 内成功，prompt 立即应答，约 3 秒收到 `prompt_result { status: "completed" }`。关闭 stdin 后 omp 约 0.1 秒退出，退出码 0，没有残留进程。
- bash 工具运行中关闭 stdin（`ping -n 60`）：omp 取消工具（`tool_execution_end.isError: true`），ping 被结束，omp 退出码 0，没有残留。
- **主进程被强杀**（bash 工具运行中）：omp 自己退出了，但 `PING.EXE` 和它的 `conhost.exe` 一直留着，要手动结束。所以只靠"关 stdin"不足以满足"不能留下孤儿进程"。omp 在这条路径上为什么不结束子进程，原因没查（推测是 stdout 断开后走了直接退出的分支）。备选方案：
  - 主进程让操作系统在它死掉时回收整棵进程树，比如 Windows Job Object 的 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`。Node 和 Electron 没有现成的 API，要加原生模块或辅助程序，**属于新增依赖**。
  - 先查清 omp 的原因，如果是 omp 的缺陷就给官方提 PR，等合并。**提 PR 也要仓库所有者同意。**
  - 两者不冲突：上游修好之后，omp 自己崩溃时仍可能留下孤儿进程，Job Object 能统一兜住。
- 细节见 `docs/architecture/omp-rpc.md`。

---

## 5. 子代理泳道需要的数据能否拿到

对应 `PLAN.md` 阶段 0 第 4 个复选框。

**结论**：通，但要绕开三处缺口：**子代理帧都没有时间戳**；**没有显式的父 id 和深度字段**；**`get_subagents` 只列出运行中的子代理**。

- 实测环境：omp 18.12.0（Tern 管理），模型 `deepseek/deepseek-v4-flash`，2026-10-17。
- 复现：启动 omp 并协商 v2 后，先发 `{"type":"set_subagent_subscription","level":"events"}`，再发 prompt。并行那次的 prompt 是："Use the task tool to spawn exactly 2 subagents IN PARALLEL (a single task tool call containing two tasks). Subagent 1 must read alpha.txt … Subagent 2 must read beta.txt … Do not read any file yourself. After both finish, summarize their reports in one line." 运行中每 1.5 秒发一次 `get_subagents`；收到 `prompt_result` 和 `session_settled` 后，对每个子代理 id 发 `get_subagent_messages`，再发 `get_session_stats`。所有帧记下主进程的接收时间。
- 嵌套那次的样本不干净：prompt 让 `Outer` 子代理再派 `Inner`，第一次 `Outer` 失败，主代理自己在 cwd 里写了一个 `.omp/agents/outer.md` 才重派成功，得到 `Outer-3` → `Outer-3.Inner`。结构上的结论（id、`parentToolCallId`）可以用，要正式验证嵌套需要更可控的 agent 定义。
- 开始和结束时间：用主进程收到 `subagent_lifecycle` 中 `status: "started"` 和 `"completed"` 两帧的时间。`progress.durationMs` 可以用来校准时长。本次实测的子代理都是后台作业（`detached: true`），父 `task` 工具调用在子代理开始前就已经结束，不能拿它的起止当泳道的起止。`rpc.md` 提到子代理也有前台的，前台子代理（`detached: false`）的时序没测。
- 模型：在 `subagent_progress.payload.progress` 的 `resolvedModel`（如 `deepseek/deepseek-v4-flash:high`）和 `resolvedThinkingLevel` 里。
- 状态：实测有 `started`、`completed`（lifecycle）和 `running`、`completed`（progress）；`aborted` 和失败态没测到。
- 工具调用：`subagent_event` 里的 `tool_execution_start` 和 `tool_execution_end` 带 `toolCallId`、`toolName`、`args`、`intent`，没有时间戳。不开 events 时，`progress.recentTools[]` 也有最近几次调用（只有结束时间）。
- 费用和 token：`progress` 里有累计的 `tokens`、`cost`、`requests`、`contextTokens`；每次请求的明细在子代理 `message_end` 的 `usage` 里。
- 嵌套：子代理 id 用点号表示层级（`Outer-3.Inner`），`parentToolCallId` 指向父代理那次 `task` 调用。`index` 只在同一个父代理下面有意义。
- 流量：一次嵌套测试录到 29.8 MB，子代理的 `message_update` 每帧都是完整快照。按 `rpc.md`，`subagent_event` 里的 `message_update` 不受 `messageUpdates: "delta"` 影响（没有实测）。泳道本身用 `progress` 级别就够，展开某个子代理的详情时再升到 `events`（中途切换级别没测）。
- 没测：`aborted` 和失败态的帧、前台子代理的时序、父代理不等子代理就结束时 `prompt_result` 与 `session_settled` 的先后、`get_session_stats` 是否包含子代理的费用。
- 细节见 `docs/architecture/subagents.md`。

---

## 仓库所有者的决定

阶段 0 结论里需要仓库所有者拍板的点，2026-10-17 已全部确认，并已同步到 `PLAN.md`、`AGENTS.md` 和 `docs/architecture/`。

|#|决策点|决定|改了哪里|
|---|---|---|---|
|1|自管 omp 的更新方式。实测 `manager.json` 只在 exe 是 PATH 上的 `omp` 时才拦得住 `omp update`（第 2 题）|**已定（2026-10-17）**：自管 exe 一律由 omp-studio 自己检查和更新，从不调 `omp update`|已改 `PLAN.md` 第 3 节"omp 来源"和第 7 节风险表|
|2|差量补丁要不要做（第 2 题）|**已定（2026-10-17）**：做，omp-studio 自带 HDiffPatch 实现，补丁不可用时退回全量。具体用哪个库在阶段 2 开工前再提出来确认|已改 `PLAN.md` 第 3 节"omp 来源"|
|3|natives 目录要不要隔离（第 2 题）|**已定**：不设 `PI_NATIVES_DIR`，和终端、Tern 共用 `~/.omp/natives`。自管 exe 加进 PATH 后，终端和 omp-studio 用同一份解压结果|已改 `docs/architecture/omp-install.md`|
|4|主进程崩溃时的孤儿进程（第 4 题）|**已定**：两者都做。omp 子进程放进 Job Object（用哪个原生模块开工前再确认）；同时查清原因，是 omp 的缺陷就提 PR|已改 `AGENTS.md`"omp 的边界"；`PLAN.md` 阶段 2 加了两个复选框|
|5|RPC 类型的来源（第 3 题）|**已定**：从 omp 的 tag 拷贝 `rpc-wire.generated.ts`|已改 `AGENTS.md`"omp 的边界"|
|6|评审评论的发送通道（第 1 题）|**已定**：宿主自己格式化成一条用户消息，不走 annotations 插件|已改 `PLAN.md` 阶段 3、第 9 节|
|7|验证时 `bun add -g` 对真实环境的副作用（第 2 题）|仓库所有者确认目前没发现问题|无|
|8|PATH 上的 omp 是 npm 装的 `omp.cmd`，启动不了（第 2 题后续）|**已定**：照 Tern 的做法，弹窗问用户要不要接管；同意就下载官方 exe 自己管理，放到用户 PATH 最前面，原来那份不动|已改 `PLAN.md` 第 3 节、阶段 2 的"omp 管理"复选框；`AGENTS.md`"omp 的边界"|
