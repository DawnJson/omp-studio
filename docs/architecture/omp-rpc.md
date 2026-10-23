# omp RPC 连接

主进程怎么启动 omp、收发帧、关闭 omp。协议本身以 omp 文档 `rpc.md` 为准，这里只记实测到的行为和要注意的地方。

## 代码

|文件|职责|
|---|---|
|`src/main/omp/discover.ts`|按 PATH 和 PATHEXT 找 `omp`（Windows 上只接受 `.exe`/`.com`，见 `omp-install.md`），执行 `omp --version`，读 exe 上两级目录的 `manager.json`|
|`src/main/omp/frame-decoder.ts`|stdout 字节 → 逻辑帧：按 `\n` 切行、严格 UTF-8、`rpc_chunk` 校验和重组。任何不合规的字节都抛 `RpcProtocolError`|
|`src/main/omp/omp-connection.ts`|`OmpConnection`：启动、握手、`request`（按 id 对应应答）、`prompt`（等到这一条完成）、`onFrame`（其余帧）、`close`|
|`src/shared/omp-wire/rpc-wire.generated.ts`|从 omp tag 拷贝的 wire 类型，见下文"类型从哪来"|

`OmpConnection` 的约定：

- `spawn` 返回时还没开始读 stdout，在同一段同步代码里挂 `onFrame` 不会漏掉握手期间的帧。
- `ready`：收到 `ready` 帧；它声明支持 v2 时再协商 v2，并把重组上限设成 `maxReassembledFrameBytes`。等 `ready` 和协商共用一个截止时间（默认 30 s）；超时、协商失败或 omp 提前退出时 reject，并已结束 omp。
- `prompt(params)`：应答带 `agentInvoked: false` 时直接返回 `{ agentInvoked: false }`；否则返回同 id 的 `prompt_result`。`prompt_result` 同时也从 `onFrame` 发出，排在这一轮所有事件之后。应答 `success: false` 时以 `RpcCommandError` reject；按 `rpc.md`，这之后同 id 的 `prompt_result` 仍可能到来，只从 `onFrame` 发出。`abort_and_prompt` 也以 `prompt_result` 结束，目前只能用 `request` 发、自己从 `onFrame` 等结果。
- `onFrame` 会收到不认识 `type` 的帧（`rpc.md`：未知帧当作未知通知），类型标注是 `RpcServerFrame`，但处理时要有默认分支。监听器抛错按致命错误处理：结束 omp，错误放进 `exited.error`。
- 协议错误（stdout 不是合规的 NDJSON）时按进程树结束 omp，`exited` 里的 `error` 是那个 `RpcProtocolError`。
- omp 退出后，所有未完成的 `request` 和 `prompt` 都以 `OmpExitedError` reject，之后的调用也一样。
- `close(timeoutMs = 5000)`：关 stdin，继续读 stdout，等 omp 退出；超时后用 `%SystemRoot%\System32\taskkill.exe /T /F` 结束进程树，`exited.killed` 为 true。omp 本身已经退出、只是孙进程还拿着它的 stdout 时，不再 taskkill（pid 可能已被复用），2 s 后直接销毁管道。测试覆盖了"omp 和它起的子进程都被结束"。
- `spawn` 参数非法（比如传入 `.cmd`）时 Node 会同步抛错，这个异常不走 `ready`/`exited`。

实测版本：在 Electron 44.9.0 主进程里跑的是 omp 18.12.0（Tern 管理）；install.ps1 装的 18.8.7 只在纯 Node 脚本里跑过同一流程。日期 2026-10-17。

## 启动

```ts
spawn(ompPath, ["--mode", "rpc-ui", "--model", model], {
  cwd,                 // 任务的工作目录，路径里可能有空格和中文，实测没问题
  env: { ...process.env, PI_CODING_AGENT_DIR, /* provider key */ },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
```

- 参数用数组，不用 `shell: true`。key 走环境变量，不用 `--api-key`。
- 开发和测试时 `PI_CODING_AGENT_DIR` 指向临时目录，见 `AGENTS.md`。
- omp 会在自己下面起一个 `conhost.exe`，这是正常的。

## 握手

时间是从 spawn 开始算的实测值。

```mermaid
sequenceDiagram
  participant M as 主进程
  participant O as omp
  O->>M: ready（v1，约 0.65 s）
  M->>O: negotiate_protocol v2
  O->>M: extension_ui_request setWidget / advisor_cost_changed / available_commands_update
  O->>M: response negotiate_protocol { protocolVersion: 2 }（约 30 ms）
  M->>O: prompt
  O->>M: response prompt（立即）
  O->>M: agent_start … message_* … tool_execution_* … agent_end
  O->>M: prompt_result { status: "completed", sessionSettled }
  O->>M: session_settled
```

实测的 `ready` 帧：

```json
{"type":"ready","protocolVersion":1,"supportedProtocolVersions":[1,2],"maxFrameBytes":1048576,"maxReassembledFrameBytes":67108864}
```

- 协商的应答到达之前，omp 已经会发出别的帧（`extension_ui_request`、`advisor_cost_changed`、`available_commands_update`），读帧时不能假设协商应答是第一帧。
- 即使 agent 目录是空的临时目录，启动和每轮结束时也会收到 `{"type":"extension_ui_request","method":"setWidget","widgetKey":"autoresearch"}`，来自 omp 内置扩展。presentation 类请求不需要回应，不认识的就忽略。18.8.7 也会发这个。

### 后台进程对 `extension_ui_request` 的处理（2026-10-23，omp 18.12.6，按源码和假 omp 回放，未用真实扩展实测）

rpc-ui 现在只用于服务进程（`src/main/service/service-omp.ts`）和项目池（`project-omp.ts`）；任务全走 TSP。这两类进程没有界面能回答扩展的对话框，所以 `OmpConnection`（`src/main/omp/omp-connection.ts`）在路由帧时统一处理（判断在 `src/main/omp/extension-ui.ts`，登录和连接层共用）：

- `select`、`confirm`、`input`、`editor`、`ask`：回 `{"type":"extension_ui_response","id":<请求 id>,"cancelled":true}`（`CancelUiResponse`，格式见 `rpc-wire.generated.ts`）。`id` 取请求的 `id`；`cancel`、`open_url` 之类不需要应答的不回。
- `notify`、`setStatus`、`setWidget`：写日志（`log.info`，文本截断到 200 字符，写入时经日志的脱敏）。
- **登录期间不抢答**：`login.ts` 在登录开始时 `connection.claimExtensionUi()`，结束时释放；认领期间连接层的默认应答不动，由登录自己答（`input` 交给界面，`select`/`confirm`/`editor`/`ask` 用同一个 `cancelledReply` 回 cancelled）。认领按计数，所以别的调用方将来也能用。
- 订阅者（`onFrame`）照旧收到所有帧，默认应答不拦截。
- omp 只在扩展自己传了 `timeout` 时才超时；`input` 登录输入框的 `timeout` 固定 600000（`login`，`rpc-mode.ts`）。

`builtin-command.ts`（设置页 MCP、记忆、更新日志、工具列表等）执行期间：`extension_error`、`rpc_frame_error`（`command_output` 超过 `maxFrameBytes` 被 omp 丢掉时就是它）按原文报错；`notice` 附在输出后面。监听器里不能抛（抛错会让连接被当致命错误关掉），所以记下来，等 `prompt` 应答后再抛。

## 读帧

- stdout 按 `\n` 切行，每行 `JSON.parse`。协商 v2 之后，超过 1 MiB 的逻辑帧会拆成连续的 `rpc_chunk`，按 `rpc.md` 的规则校验 `chunkId`、`index`、`count`、`byteLength` 再重组。普通对话里最大的帧约 193 KB，不会分块。发一条 1.4 MB 的用户消息时，收到的最大逻辑帧有 1 400 155 字符，超过 `maxFrameBytes`，只能是分块传来再重组的；在 Electron 44.9.0 主进程里实测正常，这一轮 `prompt_result` 为 `completed`（omp 18.12.0）。具体是哪一帧没有记录，推测是这条用户消息的 `message_start`/`message_end`。`read` 工具读 2 MB 的文件不会产生大帧，omp 自己截断了输出（最大帧约 112 KB）。
- `message_update` 默认每帧都带完整的消息快照。一轮带 bash 工具的短对话就录到 550 KB。阶段 2 做对话流时考虑 `set_event_filter` 的 `messageUpdates: "delta"`。按 `rpc.md`，子代理转发的 `message_update` 不受这个设置影响，见 `subagents.md`。
- `prompt` 的应答只表示消息被接收。应答里带 `data.agentInvoked: false` 时（比如同步完成的内置斜杠命令，或插件命令出错），这条 prompt 已经完成，**后面不会再有 `prompt_result`**；否则一轮跑完要看同 id 的 `prompt_result`。整个会话安静下来看 `session_settled`。

## 类型从哪来

npm 包 `@oh-my-pi/pi-coding-agent` 里有 `rpc-wire.generated.ts`，可以 `import type`，但装整个包约 1.06 GB（144 个包）。GitHub tag `v<版本>` 下 `packages/coding-agent/src/modes/rpc/wire/` 的同名文件与 npm 包逐字节相同（实测 18.12.0）。**已定：从 tag 拷贝这个文件进仓库**，不装 npm 包（`npm run rpc:update-wire -- <版本>`）。

- 只引 `modes/rpc/wire/rpc-wire.generated`，不要引 `modes/rpc/rpc-types`（会拉进 1493 个文件）。
- `RpcResponse.data` 是 `unknown`，按命令对应结果类型要用 `RpcWireCommands[K]["result"]`。
- `rpc_chunk` 的帧类型不在 generated 文件里。
- omp 自带的 `RpcFrameDecoder`（`rpc-frame.ts`）不依赖 Bun，但包里只有 `.ts` 源码，Node 不能直接从 `node_modules` 加载。它还依赖 `@oh-my-pi/pi-utils/type-guards`，拷贝时要一起拷并改 import 路径，或者用打包器处理。

## 关闭和进程树

| 情形 | omp | omp 起的子进程 |
|---|---|---|
| 空闲时关闭 stdin | 约 0.1 s 退出，退出码 0 | 无残留 |
| bash 工具运行中关闭 stdin | 取消工具（`tool_execution_end.isError: true`），约 0.1 s 退出，退出码 0 | 被结束，无残留 |
| bash 工具运行中强杀主进程（主进程里 `process.kill(process.pid, "SIGKILL")`） | 自己退出 | **`PING.EXE` 和它的 `conhost.exe` 留下成为孤儿** |

所以正常退出路径（关窗口、退出应用、自动更新重启）都要先关闭 stdin，**期间继续读 stdout**（`rpc.md` 要求，否则 omp 可能一直等输出被读走而不退出），再等 omp 退出，超时后按进程树结束（`taskkill /T /F /PID`）。主进程崩溃或被强杀时这些代码都不会运行，所以 omp 子进程放进 Windows Job Object（`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`，koffi 调用，`src/main/platform/win32/`），由系统回收整棵进程树。原因已查清（`task-model.md`「进程树兜底」）：omp 是被系统直接结束的，来不及清理孙进程，不是 omp 的缺陷。

## 内置命令（`runBuiltin`）和项目目录里的 rpc-ui

和会话无关的 omp 内置命令（`/tools` `/session` `/mcp …` `/memory …` `/changelog`，渲染进程只能传封闭联合 `BuiltinCommand`，主进程 `builtinCommandText` 拼文本）在 rpc-ui 上执行，不在任务进程里（那里的输出形态是 toast / main 文字 / 弹窗，要靠 role 抓）。实现在 `src/main/service/builtin-command.ts`：

- 先 `get_available_commands`，命令名（或别名）必须有且 `source === "builtin"`，否则不发（实测 omp 18.12.5：`/unpin` 不是内置命令，被当成普通消息发给了模型，产生了一次花费）。
- 发 `prompt`，收集应答之前的 `command_output`（去 ANSI，多段用 `\n` 连接）；应答 `agentInvoked:true` 当失败。omp 自己报的失败（如 "Failed to add server…"）是普通 `command_output`、`success:true`，**原样返回**，由界面解析/显示。`success:false` 以 omp 原文 reject。
- 同一连接上串行（`command_output` 帧没有请求 id，并发会串台）。
- `scope: null` → 服务进程（cwd = `userData/service`，**用户范围**）；`{ projectId }` → `src/main/service/project-omp.ts` 的 `ProjectOmpPool`：每个项目目录（取自主进程的项目记录，不是渲染进程传的路径）一个 `omp --mode rpc-ui --no-session`，cwd = 项目目录，**空闲 60 秒关闭**，放进应用 Job Object，`command-handlers.ts` 注册的 shutdown hook 在退出时全部关掉，关闭后不再接受操作。进程生命周期（按需启动、空闲计时、Job Object、启动中被关）和服务进程共用 `service/idle-omp.ts`（不依赖 electron，cwd/启动参数/Job 注入，单测用 fake omp）。
- 单测 `test/builtin-command.test.ts`：回放帧按 `native-ui-plan` §2.2 的实测文本手写（不是整段真实录制）。
