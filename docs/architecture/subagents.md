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

- **本次实测的子代理都是后台作业**（`detached: true`）。主会话的 `task` 工具调用在打印 `Spawned…` 时就结束了，比子代理的 `started` 还早，所以泳道的起止只能看 lifecycle 帧。`rpc.md` 提到子代理也有前台的，前台子代理（`detached: false`）的时序没测。
- **`index` 不是全局序号**。嵌套的子代理 `index` 也从 0 开始，泳道的行用 `id` 做键。
- **嵌套关系**：顶层子代理的 `parentToolCallId` 是主会话那次 `task` 调用的 id；嵌套的子代理的 `parentToolCallId` 是父代理自己事件流里那次 `task` 调用的 id。用户给子代理起的名字带点号时，点号规则会出错，要用 `parentToolCallId` 反查。嵌套样本不干净（主代理自己写了临时 agent 定义才派成功，见 `problem.md` 第 5 题），结构结论可用，细节要再验证。
- **`get_subagents` 只返回运行中的子代理**，结束后就查不到了。主进程要在收到 `started` 时自己记下 `id` 和 `sessionFile`。子代理结束后仍能用 `id` 调 `get_subagent_messages` 拿到完整记录。
- **流量**：events 级别下，子代理的 `message_update` 每帧都是完整快照；按 `rpc.md`，它不受 `set_event_filter` 的 `messageUpdates: "delta"` 影响（没有实测）。两个只读一个文件的子代理，11 秒产生 2.27 MB；一次嵌套测试产生 29.8 MB，最大单帧 193 KB。

## 泳道的实现（阶段 5）

### 订阅级别：`progress`，不升 `events`

`session-init.ts` 一直用 `progress`（lifecycle + progress 帧，一个子代理 5–25 帧，每帧约 1–3 KB），泳道需要的数据它都有：起止（lifecycle 的接收时间）、状态、模型、费用、token、工具调用（`recentTools`）。详情里的完整记录和"只看它的改动"不靠 `events`，而是用户点开时调 `get_subagent_messages`（子代理结束后仍可读，见上）。所以没有运行中切订阅级别的问题（那一项仍没测），也没有 MB 级的流量。代价：`progress` 级别看不到子代理自己的 `tool_execution_start`，工具调用只有结束时刻，且 `recentTools` 只带最近几条（见下"聚合"）；详情里的完整记录是 3 秒一次的轮询，不是推送。

### 主进程聚合

- `src/main/tasks/subagent-tracker.ts`（纯逻辑，`test/subagent-tracker.test.ts`）：`subagent_lifecycle` + `subagent_progress` → `SubagentLane`（`src/shared/subagents.ts`）。键是子代理 `id`。`progress` 先于 `lifecycle` 到达也能建出泳道；终态不会被迟到的帧改回去；`lifecycle` 是起止的权威，`progress.status` 只在泳道还在跑时推进状态。
- **工具调用**：`progress` 是累计快照，`recentTools` 在帧之间重叠，按 `endMs|工具|参数摘要|是否出错` 去重后追加到 `tools`。`args` 只是参数摘要（路径、命令……），`argsKey` 说明它是哪个字段；成功的 `edit` / `write` / `ast_edit` 且 `argsKey` 是 `path` 的，路径进 `touched`。完整的改动以详情里的完整记录为准（`recentTools` 太短，长任务里早期的改动文件可能已经滚出去了）。
- **时间**：`endMs` 是 omp 机器的 epoch 毫秒。它落在 [子代理开始 − 5 秒, 接收时间 + 5 秒] 之外（回放录制、时钟不一致）时改用接收时间，所以回放录制时时间轴也是对的。
- **嵌套**：`id` 的点号规则，且父确实在列表里才算父子（`v1.2-fix` 这种名字不会误判）。`progress` 级别看不到子代理自己事件流里的 `task` 调用，没法用 `parentToolCallId` 反查；嵌套没有再测，只有单元测试覆盖这个规则。
- **有界**：每个子代理最多保留 200 条工具调用（超出丢最早的），每个任务最多 100 条泳道（超出先丢最早结束的，在跑的不丢），`assignment` 截到 4000 字符；详情的完整记录最多 300 条消息、约 8 MB（超出留最近的，标 `truncated`）。常量在 `subagentLimits`。
- **进程退出**：还在跑的泳道标 `aborted`（子代理跟着没了）。泳道不落盘：应用重启或任务重新载入历史后没有泳道（历史会话文件里没有子代理的起止时间）。
- **推送**：`subagents` 事件推整份快照，主进程把高频的 progress 合并成每 100 ms 最多一次；渲染进程打开任务时调 `getSubagents` 对齐。泳道带 `rev`，渲染进程按它复用没变的对象。

### IPC

`getSubagents(taskId)`、`getSubagentDetail(taskId, subagentId)`、`steerSubagent(taskId, subagentId, text)`、`cancelSubagent(taskId, subagentId)`，事件 `subagents`。子代理 id 来自渲染进程，不可信：`steer` / `cancel` 只对主进程自己记着的、状态为 `running` 的子代理发命令，否则 reject；`steer` 文字上限 20000 字符。`getSubagentDetail` 没有 omp 进程时不拉起，返回 `messages: null, unavailable: "no_process"`；按 id 读不到时退回用 `lifecycle` 记下的 `sessionFile`。

### 渲染

过程行展开后顶部出现子代理表（`features/lanes/`，2026-10-20 起照 Tern 里 omp 的 Agents 表，替换原来的时间轴）：头行是所有子代理的费用、用时（各自之和）、请求数、token 合计；每个子代理一行：状态点、名字、模型、任务，右边费用 / 用时 / 请求 / 工具调用 / token / 上下文六列。用时：结束了用 `progress.durationMs`（没有就用 lifecycle 起止），运行中取到现在。点一行在下面展开详情：费用 / token / 请求 / 工具调用 / 时长 / 上下文 / 模型、任务、摘要（完整记录里最后一条助手文字）、"完整记录"（和主对话同一套 `model.ts` + `ProcessDetails`）、"改动"（`ChangeCard`，只含这个子代理的文件）；运行中的有 steer 输入框和取消按钮（取消要二次确认）。子代理归到"开始时间不晚于它的最后一轮"。

## 真实 omp 实测（阶段 5，omp 18.12.1，`deepseek/deepseek-v4-flash`，2026-10-18）

录制：`fixtures/rpc/subagents-parallel.ndjson`（两个并行子代理，一个读文件、一个读完写 `beta-summary.md`；两个都是 `detached: true`）、`subagents-control.ndjson`（两个各跑约 30 秒的子代理，运行中 steer 第一个、cancel 第二个；为控制体积删掉了 `message_update`、`tool_execution_update` 和重复的 `get_state`，帧结构没动）。

- **`steer_subagent`**：参数 `{ subagentId, message }`，应答 `success: true` 无 `data`。被 steer 的子代理的最终回答里确实带上了要求的 `PINEAPPLE`。
- **`cancel_subagent`**：参数 `{ subagentId }`，应答 `data: { cancelled: true }`。随后先来一帧 `subagent_progress`（`progress.status: "aborted"`），再来 `subagent_lifecycle`（`status: "aborted"`，其余字段同 `completed`）。被取消的子代理的记录里最后一条是 `stopReason: "aborted"` 的空助手消息。主代理看到取消后自己又派了一个新名字的子代理（`ReadBetaRetry`）。
- **对已结束的子代理 cancel**：omp 没有被问到；主进程先自己拦住（泳道不是 `running` 就 reject）。
- **`get_subagent_messages`**：运行中和结束后都能读；一页返回当时文件里的全部内容，`nextByte` 是文件末尾，用它续读返回空页。主进程循环到 `nextByte` 不再前进为止。
- **经任务池（真实 omp，不是只开连接）**：steer 的 `steer: ok`、cancel 的 `cancelled: true` 都走通；运行中读详情得到 6 条消息，结束后读到 9 条（被取消的 6 条，最后一条是 toolResult）；对已被取消的子代理再 cancel 被拦成 `not running`。

## 没测到的

- 失败态（`failed`）的帧形状。
- 前台子代理（`detached: false`）的时序。
- 嵌套子代理在 `progress` 级别下的帧（嵌套样本是 `events` 级别时录的）。
- 父代理不等子代理就结束时，`prompt_result` 和 `session_settled` 的先后（两次录制里主代理都等了子代理）。
- 运行中在 `progress` 和 `events` 之间切换订阅级别（泳道没用到）。
- `get_session_stats` 是否包含子代理的 token 和费用。
- 子代理运行时间长时 `recentTools` 保留多少条（`subagents-control` 里约 30 秒、3 次工具调用，都在里面）。
