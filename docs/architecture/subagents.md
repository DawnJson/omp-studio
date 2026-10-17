# 子代理泳道的数据来源

泳道视图要的每一项数据从哪个帧、哪个字段拿。协议定义见 omp 文档 `rpc.md` 的 "Subagent subscriptions" 一节。

实测版本：omp 18.12.0，模型 `deepseek/deepseek-v4-flash`，订阅级别 `events`。一次并行派 2 个子代理，一次嵌套两层。日期 2026-10-17。

## 三类帧

三类帧的结构都是 `{ type, payload }`，**都没有时间戳**。

```json
{"type":"subagent_lifecycle","payload":{"id":"AlphaReader","agent":"task","parentToolCallId":"call_00_…","detached":true,"agentSource":"user","status":"started","sessionFile":"…\\AlphaReader.jsonl","index":0}}
```

```json
{"type":"subagent_progress","payload":{"index":1,"agent":"task","agentSource":"user","task":"…","assignment":"…","parentToolCallId":"call_00_…","detached":true,"sessionFile":"…\\BetaReader.jsonl",
 "progress":{"id":"BetaReader","status":"completed","lastIntent":"Reading beta.txt",
  "recentTools":[{"tool":"read","args":"beta.txt","argsKey":"path","intent":"Reading beta.txt","isError":false,"endMs":1792276643715}],
  "recentOutput":["…"],"toolCount":1,"requests":2,"tokens":1021,"cost":0.000229776,"durationMs":3471,
  "modelOverride":["deepseek/deepseek-v4-flash"],"contextWindow":1000000,"resolvedModelIdentity":"deepseek/deepseek-v4-flash",
  "resolvedThinkingLevel":"high","resolvedModel":"deepseek/deepseek-v4-flash:high","resolvedModelIsFallback":false,"contextTokens":7824}}}
```

```json
{"type":"subagent_event","payload":{"id":"AlphaReader","event":{"type":"tool_execution_start","toolCallId":"call_00_…","toolName":"read","args":{"path":"alpha.txt"},"intent":"Reading alpha.txt"}}}
```

- `subagent_lifecycle`：每个子代理两帧，`started` 和 `completed`，两帧结构相同。文档说取消后是 `aborted`，没测到。失败态没测到。
- `subagent_progress`：累计快照，不是增量。一个子代理约 5–15 帧。
- `subagent_event`：子代理自己的会话事件原样转发，只带子代理 `id`。

## 泳道数据对照

| 数据 | 来源 | 备注 |
|---|---|---|
| 开始时间 | 主进程收到 `lifecycle` `started` 的时间 | 帧里没有时间戳 |
| 结束时间 | 主进程收到 `lifecycle` `completed` 的时间 | `progress.durationMs` 可以校准时长 |
| 模型 | `progress.resolvedModel`、`resolvedThinkingLevel` | lifecycle 帧里没有；取最新一帧 progress |
| 状态 | `lifecycle.status`、`progress.status` | 实测有 `started`、`running`、`completed` |
| 工具调用 | `subagent_event` 的 `tool_execution_start` / `_end` | 带 `toolCallId`、`toolName`、`args`、`intent`，没有时间戳，按 `toolCallId` 配对，用接收时间 |
| 工具调用（不开 events） | `progress.recentTools[]`、`toolCount` | 只有最近几条，只有结束时间 `endMs`（epoch 毫秒） |
| 费用和 token | `progress.tokens`、`cost`、`requests`、`contextTokens` | `tokens` 是各次请求 input 加 output 之和，不含 cacheRead；每次请求的明细在子代理 `message_end` 的 `usage` 里 |
| 父子关系 | `id` 的点号（`Outer-3.Inner` 的父是 `Outer-3`），`parentToolCallId` | 没有 `parentId` 或 `depth` 字段 |
| 显示名 | `id` | `agent` 是代理类型（如 `task`），不是名字；重名时 omp 自动加 `-2`、`-3` |

## 要注意的地方

- **子代理是后台作业**（`detached: true`）。主会话的 `task` 工具调用在打印 `Spawned…` 时就结束了，比子代理的 `started` 还早，所以泳道的起止只能看 lifecycle 帧。
- **`index` 不是全局序号**。嵌套的子代理 `index` 也从 0 开始，泳道的行用 `id` 做键。
- **嵌套关系**：顶层子代理的 `parentToolCallId` 是主会话那次 `task` 调用的 id；嵌套的子代理的 `parentToolCallId` 是父代理自己事件流里那次 `task` 调用的 id。用户给子代理起的名字带点号时，点号规则会出错，要用 `parentToolCallId` 反查。
- **`get_subagents` 只返回运行中的子代理**，结束后就查不到了。主进程要在收到 `started` 时自己记下 `id` 和 `sessionFile`。子代理结束后仍能用 `id` 调 `get_subagent_messages` 拿到完整记录。
- **流量**：events 级别下，子代理的 `message_update` 每帧都是完整快照，不受 `set_event_filter` 的 `messageUpdates: "delta"` 影响。两个只读一个文件的子代理，11 秒产生 2.27 MB；一次嵌套测试产生 29.8 MB，最大单帧 193 KB。泳道本身用 `progress` 级别就够，用户展开某个子代理的详情时再升到 `events`。

## 没测到的

- `aborted` 和失败态的帧形状。
- 父代理不等子代理就结束时，`prompt_result` 和 `session_settled` 的先后。
- 运行中在 `progress` 和 `events` 之间切换订阅级别。
- `get_session_stats` 是否包含子代理的 token 和费用。
- 子代理运行时间长时 `recentTools` 保留多少条。
