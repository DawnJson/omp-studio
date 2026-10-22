# 子代理：Agent Hub、聚焦和右栏子代理面板

任务里的子代理由 omp 自己管理，studio 通过 TSP 节点和 omp 的会话文件看它们，需要操作时在后台驱动 omp 的 Agent Hub。协议和节点见 [tsp-migration.md](tsp-migration.md)。omp 的 Agent Hub 文档是 `agent-hub.md`：Hub 里 `Enter` 聚焦一个本地子代理后，主界面的转录、状态行、编辑器都属于这个子代理，输入 `Enter` = steer（运行中）或 prompt（空闲）；没有本地可聚焦会话时用 Hub 自己的全屏转录页，只有"能发消息"的子代理才有输入行，语义相同。

## Agent Hub 和输入框（omp 18.12.5 实测）

studio 把 omp 的编辑器藏了、用自己的输入框，所以 Hub 开着时在输入框发的话会成为对主代理的插话（"Wait interrupted by message"）——这是要避免的。**实测（omp 18.12.5，`fixtures/tsp/hub-steer.jsonl`，由 NativeUiPlan 录制）**：Hub 是 inline surface 的 `layer` 里的 `picker`（标题 "Agents"，`tabs` 含 `agents` / `activity`，`items` 是子代理 id；`action agents.open`（`omp.hud.seg`）或 `send "/hub"` 打开），不是 `mode: "screen"`。对 `picker` `activate` 一个子代理（`item: "Beta"`）后 Hub 关掉，omp 进入聚焦模式：dock 里多一行 `omp.composer.focus`（"Viewing subagent Beta: what you send goes to it"，退出按钮 `omp.composer.exit`，`actions.click: "focus:Main"`），编辑器占位符 "Message Beta"；往**同一个编辑器 id**（`j.line/input`）`send` 就 steer 那个子代理（Beta.jsonl 收到消息，主会话没有），Esc 回主会话（toast "Returned to main session"）。

所以**路由不需要新协议**：聚焦模式下 studio 照常 `sendPrompt` 就是 steer 子代理；要拦的只是 Hub 的 `picker` 开着、没选子代理的那段（`hasAgentHub`，`findMessageTarget` 返回 `panel`，`sendPrompt` reject `screen_open:`，输入框禁用发送并提示）。全屏 surface（`/settings` 等）同样拦。规则和测试见 [tsp-migration.md](tsp-migration.md) §10.7、`test/tsp-gate.test.ts`。用户自己在聚焦模式下（studio 的面板之外进入的，如在 omp 里手动聚焦）输入框占位符还是主任务的、Stop 键发的 Esc 在聚焦模式下是"回主会话"不是停止：这两处 studio 没有特殊处理。

## 右栏的子代理面板（spec §4.28）

`features/agents/` 的面板替代 `👥` 打开的 omp Agent Hub：列表读文档、记录读 omp 存档、插话 / 结束 / 恢复在后台驱动 Hub。仓库所有者 2026-10-21 批准后台驱动 Hub（只用于这三个动作）。

### 数据：三个来源，两个不碰 omp

| 数据 | 来源 | 代码 |
|---|---|---|
| 列表（名字、类型、状态、模型、当前工具和意图、统计、`background` 徽章） | TSP 文档里的 `agent` 节点（规范 §7.6，公开契约）：task 工具卡片下的 `<卡片id>.<名字>`（omp 重排转录时卡片 id 会变，录制里先后是 `r.` / `t.` / `1a.`，2026-10-22 逐帧核对过父节点都是 `omp.tool.task`），按名字去重取更活的（运行 > 等待 > 空闲 / 挂起 > 结束）；状态取值 `pending / running / done / failed / aborted / idle / parked`。**被结束的子代理节点变 `aborted`，不会消失** | `shared/tsp/agent-hub.ts` 的 `listAgents`；渲染进程 `useTspDerived`，不需要 IPC |
| 最终输出、对话记录 | 会话文件旁的同名目录 `<会话文件去掉 .jsonl>/<名字>.md` 和 `<名字>.jsonl`（omp 18.12.5 实测路径；格式同主会话，每行 `{type:"message", message}`）。只读，不写 `~/.omp` | `main/tsp/subagent-file.ts`，IPC `getTspSubagentRecord` |
| 插话、结束、恢复 | 只有 Agent Hub（`picker`）的动作：没有别的通道 | `main/tasks/tsp-hub-driver.ts`，IPC `steerTspSubagent` / `killTspSubagent` / `reviveTspSubagent` |

子代理名来自渲染进程，不可信：`isAgentName`（`^[A-Za-z0-9_][\w.-]{0,127}$`，不含 `..`）在 IPC 校验，主进程再确认它是文档里确有的子代理；记录路径由主进程用会话文件拼，并确认落在会话目录内（拒绝 `../x`、`a/b`）。读不到文件给 `unavailable: no_session | no_file | error` + 原因，界面显示原因。记录最多读末尾 8 MB、保留最近 300 条消息（`subagentLimits`，`trimSubagentMessages`），`.md` 最多 512 KB。

### 界面

面板（`AgentsPanel`，和文件面板同一栏、同时只开一个）：列表（`AgentRow`：状态点、名字、`后台` 标签、当前工具或任务第一句）→ 点一行进详情（`AgentDetail`：名字 + 模型 + 结束 / 恢复，统计格，任务说明原文 Markdown（`HubAgent.assignment`），最终输出、完整记录——工具卡片按顺序排，用的是 `conversation/ProcessDetails` / `ToolViews` 的精简版，不含 task / wait 卡）→ 插话框（`SteerBox`，钉在面板底边）。输入框上方的药丸 `[👥 N | ⚡ N]` 左半段（运行中的子代理数，`countActiveAgents`）点击 = 打开 / 收起这个面板。驱动 Hub 期间面板顶部显示"正在发给 <名字>" / "正在结束…" / "正在恢复…"，omp 的 Hub 一帧也不画。命令面板 `agents.cmd`、斜杠命令（`agents-slash.ts`）同样打开它。

### 实测：kill / revive（`fixtures/tsp/hub-kill.jsonl`，omp 18.12.5，`deepseek/deepseek-v4-flash`，S1Agents 录制，真实 omp、临时 agent 目录）

场景：主代理派两个后台子代理 Alpha / Beta（各 `sleep 90`），打开 Hub，`select` 一个**不是默认选中**的子代理，`kill`，等主代理反应过，再 `revive`，Esc。

- **`select`**：`{ev:"select", sf, id:<picker>, item:<名字>}`，picker 的 `selected` 随之改变；kill / revive 作用于**选中项**，所以要先 select。
- **`kill`**：`{ev:"action", sf, id:<picker>, act:"kill"}`（底栏动作 `kill`，`danger`，没有 `disabled` 字段）。**没有 `confirm`**，没有任何对话框；只有一条 toast "Background task Beta completed · 6.1s"。结果：该项 `dot` 由 `pending` 变 **`error`**，`revive` 动作的 `disabled` 去掉，task 卡片 / hud 里的 `agent` 节点变 `aborted`，另一个子代理不受影响（`running`）。
- **`revive`**：`{ev:"action", …, act:"revive"}`。运行中的项上 `revive` 带 `disabled: "Only parked or killed agents can be revived"`（studio 把这句原文作为错误给用户）。对被结束的项：`dot` 变 **`success`**（复活后空闲，等消息），`revive` 又被禁用。**复活后 `agent` 节点的 `status` 在录制的 1.5 秒内仍是 `aborted`**，所以面板的"恢复"按钮按文档状态可能晚一点才变；操作的完成判定用 Hub 项的 `dot`，不用 `agent` 节点。
- **关 Hub**：Esc 键（按键，不进 `.jsonl`）；此时 Hub 的 `layer` 被删。
- **竞争**：一次中间录制里主代理看到取消后自己用 IRC 工具把 Beta 复活了，随后 studio 发的 `revive` 对已在运行的项是无效操作。最后一次录制在提示里禁止主代理复活才得到干净的序列（`hub-kill.jsonl` 是这一次）。**真实使用中同样可能发生**：恢复前 studio 看 Hub 里 `revive` 是否可用，禁用就以 omp 的原文报错。
- **没测到**：`select` 之后 `kill` 一个已 `done` 的子代理会怎样；`aborted` / `failed` 的子代理被 `activate` 聚焦会怎样（Hub 的 Enter 对它们是"打开记录"，所以面板不提供对这几种状态的插话）；嵌套子代理（名字带点号）在 Hub 里的 item id。

### 实测：历史子代理和 `--resume`（omp 18.12.6，`deepseek/deepseek-v4-flash`，真实 omp、临时 agent 目录，2026-10-22 一次性探针，未存为 fixture）

同一会话两个回合各派子代理（Alpha、Beta，然后 Gamma），再退出、`--resume=<会话文件>` 重开。

- **同一进程**：回合结束后 `agent` 节点留在各自的 task 卡片下（`<卡片id>.<名字>`，`status:"done"`，统计齐全），两个回合的都在；没有子代理在跑时 hud 里没有 `agents.open`。omp 的 Hub（`/hub`）默认落在 Activity 页，Agents 页列出全部三个（`dot:"success"`，详情徽标叫 `idle`）。所以面板天然显示历史子代理，不用另读。
- **任务说明**：`agent` 节点的 `task` 属性被压成一行（换行变空格，`# Target No files. # Change 1. …`）；带换行的原文在子节点 `<id>/0`（`k:"md"`，`role:"omp.task.assignment"`）。Hub 的 item `detail` 也是压平的一行。面板详情用原文（`HubAgent.assignment`），列表行用压平的那句。
- **磁盘**：会话文件旁的同名目录里每个子代理一对 `<名字>.jsonl` + `<名字>.md`，不按回合分。子代理 `.jsonl` 第一条 user 消息是 `Complete assignment thoroughly:\n\n<原文>`，换行保留。
- **`--resume` 之后**：旧 task 卡片重放出来是 `done`，卡下的 `agent` 节点却**一律是 `status:"pending"`**，没有 `model`，`stats` 只有 `took:0`（用量丢了），几秒后仍是 pending；omp 的 Hub 把它们列成 `dot:"muted"`、徽标 `parked`，`revive` 可用。所以 `listAgents` 把"卡片已结束（不是 pending / running）而节点还写着 pending / running"的子代理当作 `parked`：不算运行中（药丸不亮、不能结束），可以恢复和插话。录制里（`hub-steer` / `hub-kill`）子代理在跑时卡片一直是 pending / running，不受影响。

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

`test/tsp-agent-hub.test.ts`（纯函数，逐帧重放 `hub-steer.jsonl` 和 `hub-kill.jsonl`：列表 running → done、Hub 与聚焦的识别、事件和录制逐字相同）；`test/tsp-hub-driver.test.ts`（回放宿主：驱动发的事件必须和录制相同才放下一批帧，退出手势才放出"关 Hub / 退出聚焦"的帧；含恢复失败、不认识的名字、恢复运行中的子代理）；`test/tsp-subagent-file.test.ts`（记录文件读取、路径校验、`trimSubagentMessages`）；`test/agent-model.test.ts`；e2e `test/e2e/tsp.e2e.ts` "子代理面板"（假 omp 回放 `hub-steer.jsonl`：👥 点击被拦截、面板列出 Alpha / Beta、插话期间"正在发给 Beta"出现且 omp 的 Hub 一帧没画、事件序列和录制一致、输入框恢复）。
