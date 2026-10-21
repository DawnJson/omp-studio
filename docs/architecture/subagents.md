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
- **嵌套关系**：顶层子代理的 `parentToolCallId` 是主会话那次 `task` 调用的 id；嵌套的子代理的 `parentToolCallId` 是父代理自己事件流里那次 `task` 调用的 id。用户给子代理起的名字带点号时，点号规则会出错，要用 `parentToolCallId` 反查。嵌套样本不干净（第一次派 `Outer` 失败，主代理自己在 cwd 里写了 `.omp/agents/outer.md` 才重派成功，得到 `Outer-3` → `Outer-3.Inner`），结构结论可用，细节要再验证。
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

## TSP 任务里的 Agent Hub 和输入框（2026-10-21）

TSP 任务没有上面的泳道和 `steerSubagent`（那些靠 rpc），子代理在 omp 的 Agents 弹窗 / Agent Hub 里看。omp 文档（`agent-hub.md`）：Hub 里 `Enter` 聚焦一个本地子代理后，主界面的转录、状态行、编辑器都属于这个子代理，输入 `Enter` = steer（运行中）或 prompt（空闲）；没有本地可聚焦会话时用 Hub 自己的全屏转录页，只有"能发消息"的子代理才有输入行，语义相同。

差距清单 B5：studio 把 omp 的编辑器藏了、用自己的输入框，Hub 开着时在输入框发的话成了对主代理的插话（"Wait interrupted by message"）。**实测（omp 18.12.5，`fixtures/tsp/hub-steer.jsonl`，由 NativeUiPlan 录制）**：Hub 是 inline surface 的 `layer` 里的 `picker`（标题 "Agents"，`tabs` 含 `agents` / `activity`，`items` 是子代理 id；`action agents.open`（`omp.hud.seg`）或 `send "/hub"` 打开），不是 `mode: "screen"`。对 `picker` `activate` 一个子代理（`item: "Beta"`）后 Hub 关掉，omp 进入聚焦模式：dock 里多一行 `omp.composer.focus`（"Viewing subagent Beta: what you send goes to it"，退出按钮 `omp.composer.exit`，`actions.click: "focus:Main"`），编辑器占位符 "Message Beta"；往**同一个编辑器 id**（`j.line/input`）`send` 就 steer 那个子代理（Beta.jsonl 收到消息，主会话没有），Esc 回主会话（toast "Returned to main session"）。所以**路由不需要新协议**：聚焦模式下 studio 照常 `sendPrompt` 就是 steer 子代理；要拦的只是 Hub 的 `picker` 开着、没选子代理的那段（`hasAgentHub`，`findMessageTarget` 返回 `panel`，`sendPrompt` reject `screen_open:`，输入框禁用发送并提示）。全屏 surface（`/settings` 等）同样拦。规则和测试见 `docs/architecture/tsp-migration.md` §10.7、`test/tsp-gate.test.ts`。聚焦模式下 studio 没有任何标识（输入框占位符还是主任务的）、Stop 按钮发的 Esc 在聚焦模式下是"回主会话"不是停止：这两处没改，属于后面的原生子代理面板。


## TSP 任务里的子代理面板（S1，spec §4.28，2026-10-21）

右栏的面板（`features/agents/`）替代 `👥` 打开的 omp Agent Hub：列表读文档、记录读 omp 存档、插话 / 结束 / 恢复在后台驱动 Hub。所有者 2026-10-21 批准后台驱动 Hub（只用于这三个动作）。rpc 任务不做第二套面板，继续用上面的泳道。

### 数据：三个来源，两个不碰 omp

| 数据 | 来源 | 代码 |
|---|---|---|
| 列表（名字、类型、状态、模型、当前工具和意图、统计、`background` 徽章） | TSP 文档里的 `agent` 节点（规范 §7.6，公开契约）：task 工具卡片下的 `1a.<名字>` 和 hud 里的 `r.<名字>` 各一份，按名字去重取更活的（运行 > 等待 > 空闲 / 挂起 > 结束）；状态取值 `pending / running / done / failed / aborted / idle / parked`。**被结束的子代理节点变 `aborted`，不会消失** | `shared/tsp/agent-hub.ts` 的 `listAgents`；渲染进程 `useTspDerived`，不需要 IPC |
| 最终输出、对话记录 | 会话文件旁的同名目录 `<会话文件去掉 .jsonl>/<名字>.md` 和 `<名字>.jsonl`（omp 18.12.5 实测路径；格式同主会话，每行 `{type:"message", message}`）。只读，不写 `~/.omp` | `main/tsp/subagent-file.ts`，IPC `getTspSubagentRecord` |
| 插话、结束、恢复 | 只有 Agent Hub（`picker`）的动作：没有别的通道 | `main/tasks/tsp-hub-driver.ts`，IPC `steerTspSubagent` / `killTspSubagent` / `reviveTspSubagent` |

子代理名来自渲染进程，不可信：`isAgentName`（`^[A-Za-z0-9_][\w.-]{0,127}$`，不含 `..`）在 IPC 校验，主进程再确认它是文档里确有的子代理；记录路径由主进程用会话文件拼，并确认落在会话目录内（拒绝 `../x`、`a/b`）。读不到文件给 `unavailable: no_session | no_file | error` + 原因，界面显示原因。记录最多读末尾 8 MB、保留最近 300 条（沿用泳道的 `subagentLimits`），`.md` 最多 512 KB。

### 实测：kill / revive（`fixtures/tsp/hub-kill.jsonl`，omp 18.12.5，`deepseek/deepseek-v4-flash`，S1Agents 录制，真实 omp、临时 agent 目录）

场景：主代理派两个后台子代理 Alpha / Beta（各 `sleep 90`），打开 Hub，`select` 一个**不是默认选中**的子代理，`kill`，等主代理反应过，再 `revive`，Esc。

- **`select`**：`{ev:"select", sf, id:<picker>, item:<名字>}`，picker 的 `selected` 随之改变；kill / revive 作用于**选中项**，所以要先 select。
- **`kill`**：`{ev:"action", sf, id:<picker>, act:"kill"}`（底栏动作 `kill`，`danger`，没有 `disabled` 字段）。**没有 `confirm`**，没有任何对话框；只有一条 toast "Background task Beta completed · 6.1s"。结果：该项 `dot` 由 `pending` 变 **`error`**，`revive` 动作的 `disabled` 去掉，task 卡片 / hud 里的 `agent` 节点变 `aborted`，另一个子代理不受影响（`running`）。
- **`revive`**：`{ev:"action", …, act:"revive"}`。运行中的项上 `revive` 带 `disabled: "Only parked or killed agents can be revived"`（studio 把这句原文作为错误给用户）。对被结束的项：`dot` 变 **`success`**（复活后空闲，等消息），`revive` 又被禁用。**复活后 `agent` 节点的 `status` 在录制的 1.5 秒内仍是 `aborted`**，所以面板的“恢复”按钮按文档状态可能晚一点才变；操作的完成判定用 Hub 项的 `dot`，不用 `agent` 节点。
- **关 Hub**：Esc 键（按键，不进 `.jsonl`）；此时 Hub 的 `layer` 被删。
- **竞争**：一次中间录制里主代理看到取消后自己用 IRC 工具把 Beta 复活了，随后 studio 发的 `revive` 对已在运行的项是无效操作。最后一次录制在提示里禁止主代理复活才得到干净的序列（`hub-kill.jsonl` 是这一次）。**真实使用中同样可能发生**：恢复前 studio 看 Hub 里 `revive` 是否可用，禁用就以 omp 的原文报错。
- **没测到**：`select` 之后 `kill` 一个已 `done` 的子代理会怎样；`aborted` / `failed` 的子代理被 `activate` 聚焦会怎样（Hub 的 Enter 对它们是“打开记录”，所以面板不提供对这几种状态的插话）；嵌套子代理（名字带点号）在 Hub 里的 item id。

### 实测：退出聚焦（真实 omp，一次性探针，未存为 fixture）

`hub-steer` 的录制里用户用 Esc 键退出聚焦，键不进录制。另用真实 omp 跑了 `activate Beta` → 聚焦行出现 → `send` → omp 回显 → 对聚焦行里的退出按钮（`omp.composer.exit`）发 `{ev:"action", sf, id:"j.focus/exit", act:"focus:Main"}`：聚焦行消失，toast "Returned to main session"，两个子代理仍是 `running`，输入框恢复成 `sendable`（`findMessageTarget` 为 ready）。所以退出聚焦用这个 action（不是中断子代理的键）；它不灵时再退到 Esc。`send` 后回显：`omp.user` / `omp.queue` 节点个数增加（`hub-steer` 帧 168 / 170），等不到不算失败（最多等 3 秒）。

### 后台驱动 Hub（`HubDriver`）

每个操作都在任务的界面操作队列里（`TspRunner.#exclusive`，和切模型共用），步骤、事件和等待条件：

| 操作 | 步骤（事件逐字取自录制） |
|---|---|
| 打开 Hub | hud 里有 `actions.click == "agents.open"` 的节点（`👥`）→ `{ev:"action", sf, id, act:"agents.open"}`；没有（没子代理在跑）→ 给输入框 `send "/hub"`；打开后页签不是 agents 就 `{ev:"action", act:"tab", value:"agents"}`（和 Picker 点页签发的一样）。等 `findAgentHub`（8 秒） |
| 插话 | 打开 → `{ev:"activate", sf, id:<picker>, item:<名字>}` → 等聚焦行 `findFocus().name == 名字`（8 秒）→ `{ev:"send", sf, id:<输入框>, text}`（输入框是 `findMessageTarget` 的 ready 目标）→ 等回显（3 秒，软）→ 恢复 |
| 结束 | 打开 → 要先 `select`（`selected != 名字` 才发，等 `selected == 名字`）→ `kill` 可用性（缺失 / 被禁用以 omp 原因抛错）→ `{act:"kill"}` → 等该项 `dot == "error"`（6 秒）→ 恢复；已经是 `error` 的什么也不做 |
| 恢复 | 打开 → select → `revive` 可用性（被禁用以 omp 原因抛错）→ `{act:"revive"}` → 等该项不再 `error`（6 秒）→ 恢复 |
| **恢复主输入框** | 无论成败都做：Hub 还开着 → Esc 键，等 `findAgentHub == null`（3 秒）；聚焦着 → 发退出按钮的 `focus:Main`（没有按钮就 Esc），3 秒没退掉再发 Esc 等 3 秒。恢复不了才以 `HUB_RESTORE_FAILED` 抛出（先报原来的错）；进程已退出不算失败 |

前置检查：名字必须是文档里确有的子代理（`unknown subagent`）；有提问 / 审批在等时不碰 Hub（`TSP_COMPOSER_UNAVAILABLE`，聚焦后的 `send` 会拒绝审批）。驱动期间 `TspRunner.#hubDriving` 为真：`#awaitComposer` 把别的发消息操作挂起、驱动结束（`setDriving(false)`）时唤醒，所以用户这时在主输入框发的话会等到主会话恢复再发出，不会变成对子代理的插话。渲染进程这一侧：`tsp-store.beginTspDrive / endTspDrive` 包住 IPC 调用，`TspView` 在此期间不画 layer 区（omp 的 Hub 一帧也不出现）、过程区压暗，`useTspPanelOpen` 不把这个 Hub 当面板开着。

### 风险和限制

- Hub 的 role / action / `dot` 取值都是 omp 自己的、不在 TSP 规范里：`agents.open`、`kill`、`revive`、`tab`、`omp.composer.focus`、`omp.composer.exit`、`focus:Main`、`dot: error / success`。判断都集中在 `shared/tsp/agent-hub.ts`，omp 改名时操作超时失败、走恢复；列表和记录不受影响。
- 聚焦模式期间过程区暂时显示那个子代理的记录（omp 把聚焦的会话画在 main 里），约一两秒；面板压暗过程区、不让点。聚焦期间用户若按停止键（Esc）可能提前退出聚焦，插话已发出则不受影响。
- 驱动 Hub 会让 omp 的 `agents.open` 对应的 hud 状态瞬间变化（打开 / 关闭 Hub）；不碰主会话的消息和模型。
- 子代理在 omp 里的 `done` 状态是否还能被聚焦 / 插话没测，面板对 `done`、`aborted`、`failed` 不提供插话。

### 测试

`test/tsp-agent-hub.test.ts`（纯函数，逐帧重放 `hub-steer.jsonl` 和 `hub-kill.jsonl`：列表 running → done、Hub 与聚焦的识别、事件和录制逐字相同）；`test/tsp-hub-driver.test.ts`（回放宿主：驱动发的事件必须和录制相同才放下一批帧，退出手势才放出“关 Hub / 退出聚焦”的帧；含恢复失败、不认识的名字、恢复运行中的子代理）；`test/tsp-subagent-file.test.ts`；e2e `test/e2e/tsp.e2e.ts` “子代理面板”（假 omp 回放 `hub-steer.jsonl`：👥 点击被拦截、面板列出 Alpha / Beta、插话期间“正在发给 Beta”出现且 omp 的 Hub 一帧没画、事件序列和录制一致、输入框恢复）。
