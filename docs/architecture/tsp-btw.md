# TSP 任务的旁路提问（`/btw`）

TSP 任务里 `/btw` 由 studio 自己的面板（`features/btw/BtwPanel`，和 rpc 任务是同一个组件、同一套 `askBtw` / `cancelBtw` / `getBtw` IPC）承接。omp 在 TSP 下把 `/btw` 画成一个弹窗，studio 读弹窗里的问答、不画这个弹窗，所有操作由主进程在后台对弹窗发事件完成。

范围：只做 `/btw`。`/tree`、`/fork`、`/goal` 见各自的文档（`session-tree.md`、`conversation.md`「目标模式」）。

## 1. omp 18.12.5 实测

真实 omp（`deepseek/deepseek-v4-flash`，临时 `PI_CODING_AGENT_DIR`，`startup.setupWizard=false`，用 `PI_TUI_TSP_RECORD` 录制）。录制已脱敏（没有路径、key；无效 key 的那份里 key 被 omp 自己打码成 `****-key`）：

- `fixtures/tsp/btw.jsonl`：主轮在流式输出时提问 pong → 再问 ping → 裸 `/btw` 打开历史、选回 pong 追问 → 取消一个长回答。
- `fixtures/tsp/btw-error.jsonl`：无效 API key：提问失败、对失败的话题追问。

**它是 out-of-band 的，不碰主对话。** `/btw <问题>` 之后 main 里没有任何节点（没有 `omp.user` 回显，没有排队），主轮正在流式输出时照常提问，两边互不影响。omp 只是在 `layer` 里加一个 modal 弹窗：

```
layer.ov-<x>  overlay  role=omp.overlay.btwHistory  modal  head="BTW history"
  <x>.body  row role=omp.btw.body
    <x>.body/history  col role=omp.btw.history                    ← 只有 ≥2 个话题（或裸 /btw 打开历史）时才有
      …/records  list role=omp.btw.list[.idle]  selected=<item id>
        …/records/<话题 id>  item  label=[问题]  detail=[时间]  value=[● Answering]（回答中才有）
    <x>.body/details  col role=omp.btw.reader                     ← 只有"选中话题"的问答
      …/thread  col role=omp.btw.thread
        …/turn-N  col role=omp.btw.turn
          …/0  md  role=omp.btw.question | omp.btw.followup  text=问题
          …/1  text role=omp.btw.meta  spans=[时间, "  ·  ", 状态词]
          …/answer  col role=omp.btw.answer  →  md(text=答案, stream) | text role=omp.btw.pending "Thinking…"
          …/2  text role=omp.btw.error  （失败时）
        …/composer  col role=omp.btw.composer  →  input prompt="Follow up: " sendable=false   ← 追问时才有
  <x>.actions  row role=omp.actions → 按钮 row role=omp.btn，actions.click = stop | close | follow-up | copy-answer | discard | send
```

- 状态词：回答中 `● Answering`（pulse）→ 完成时只剩时间；`Cancelled`（warning 色）；`Failed`（error 色，并多一个 `omp.btw.error` 节点，文字是 omp 给的错误，如 `401 Authentication Fails…`）；`Interrupted`（按 omp 文档，没构造出来）。
- 答案流式到达：第一块 `del` 掉 pending 再 `add` 一个 `md stream:true`，之后是 `text append`，收尾 `set stream:false`，并且 `stop` 按钮换成 `follow-up`。
- 弹窗 id 每次打开都是新的（`ov-p`、`ov-q`…）；**只有一个话题时节点里没有话题 id**；有 list 时 item id 的最后一段就是话题 id（和磁盘上的 id 相同）。
- **弹窗不会自己消失**，要发 `action close`（omp 随后 `focus` 回主输入框）。弹窗开着时主输入框的 `send` 照常提交（主轮、再发一个 `/btw` 都行；再发 `/btw` 会换掉弹窗）；**追问输入框打开时**主输入框的 `send` 被 omp 吞掉。
- 追问输入框的 `sendable` 为 false 时 `send` 事件是空操作（TSP 规范：只对 `sendable` 的输入框生效），所以走：`action follow-up` → `edit {from:0,to:0,text,cursor,len:0}` 填字 → `action send`（点按钮）。
- list 里 `select`（`item` = item 节点的完整 id）→ 同一帧里右边换成被选话题的问答（`splice`）。
- 同一时刻只许一个 `/btw` 在跑（omp 文档 slash-command-internals.md §11）：回答中再问被拒绝。
- **历史落盘**：每个话题一个文件 `<会话文件去掉 .jsonl>/btw-history/entry-<话题 id>.json`，内容就是 rpc 的 `BtwHistoryRecord`（`question/answer/status/createdAt/updatedAt/id/leafId/followUps[]`）。只问过旁路问题、没发过主轮的会话也会有会话文件。（omp 文档：rpc.md「Side questions」、slash-command-internals.md §11。）
- 多行问题（`/btw` 后面带换行）原样进弹窗的问题节点。

## 2. 设计

**数据**

| 来源 | 用途 | 位置 |
|---|---|---|
| 文档里的弹窗 | 实时：问题、答案（流式）、状态、错误、可点的按钮 | `shared/tsp/btw.ts`（`findBtwView` 等纯函数） |
| 会话旁边的 `btw-history/` | 话题 id、历史（含没有进程的任务、恢复的会话） | `main/tsp/btw-history.ts`（只读）+ `parseBtwEntry` / `mergeBtwDisk` |

镜像 `TspBtw.#records`（`main/tasks/tsp-btw.ts`）是 `BtwHistoryRecord[]`，和 rpc 的一样；推给渲染进程用同一组 `BtwUiEvent`（`record` / `delta` / `records`），渲染进程的 `btw-store`、`BtwPanel` 一行没改。

- 每次文档变化（`TspRunner` 的 `onChange`）调 `sync`：读弹窗 → 话题 id（有 list 用选中项；没有就按第一问的文字在镜像里找；找不到先用临时 id `live:N`）→ `viewToRecord` → `btwEventsFor`（答案只是追加就发 `delta`，别的发整条 `record`）。
- 磁盘记录并进镜像（`mergeBtwDisk`）：临时 id 按第一问换成真 id；问答多的一方为准（镜像多一问 = 磁盘还没写追问）；回答中以镜像为准（磁盘上的答案要等收尾才写）；磁盘上写着 running 而镜像里没有在跑的 → `interrupted`（omp 重读历史时也这么标）。`getBtw` 每次先读一遍磁盘（不为它起进程），面板打开时调一次。
- `ask` 返回前最多等 ~0.9 秒让临时 id 换成真 id（面板选中的就是真 id，追问要靠它在 list 里 `select`）。

**动作**（都在任务的界面操作队列 `#exclusive` 里，期间 `#btwDriving`：`#awaitComposer` 等它结束，主会话不会收到别的消息）

```
提问   send "/btw <问题>"（主输入框）→ 等弹窗出现（新的弹窗 id、第一问 = 问题）→ 返回话题 id
追问   [裸 "/btw" 打开历史] → [select 话题] → action follow-up → 等输入框 → edit 填字 → action send → 等新的一问
取消   action stop
收尾   一问不再 running、没有在写追问 → action close（sync 里自动，驱动期间不关）
```

出错一律以 omp 没有响应的具体步骤为错误文字 reject（`omp did not open the side question…`、`omp did not select the side-question topic`…），超时 8 秒（打开）/ 6 秒（其余），不吞。本地先拒绝：空问题、不认识的话题（`Unknown /btw topic: <id>`）、已有一个在跑（`A /btw question is still running; cancel it first`，和 rpc 同一句）。

**不画 omp 的弹窗**：`TspChildren` 里按 role 不挂载 `omp.overlay.btwHistory`（`isBtwOverlayNode`，同输入框卡片、待办药丸的做法）。弹窗的 Esc 处理器因此也不装。弹窗开着时 omp 的 Esc 落在弹窗上，所以**停止主轮**时 `TspRunner.stop()` 先让开弹窗（见下）。

**入口**：`/btw [问题]`（`studio-slash-table.ts` 改成 `tsp: "studio"`）和命令面板“旁路提问（/btw）”现在对 TSP 任务也有；`App.tsx` 在 TSP 分支里挂 `BtwPanel`。

## 3. 依赖的 omp 约定（omp 升级时先看这里）

role `omp.overlay.btwHistory` / `omp.btw.*` / `omp.btn`、按钮动作名 `stop` `close` `follow-up` `send` `discard`、状态词 `Answering` `Cancelled` `Failed` `Interrupted`、`btw-history/entry-*.json` 的目录和形状。全部集中在 `shared/tsp/btw.ts` 和 `main/tsp/btw-history.ts`；`test/tsp-btw.test.ts` 用 18.12.5 录制逐帧验证，omp 改了这里先红。解析不了的磁盘文件跳过并记日志；弹窗读不到按钮时以 `omp's side-question window has no <动作> button` reject。

## 4. 没做 / 已知限制

- 弹窗里只有选中话题的问答：非选中话题的内容只能从磁盘读（实时的只有正在回答的那个）。
- 终端里的 omp 在 studio 之外追问同一个话题（另一个进程）：磁盘上问答更多时以磁盘为准，实时流式看不到。
- **停止（已处理）**：弹窗开着时 Esc 只会落在弹窗上，停不了主轮（实测 omp 18.12.5，录制 `btw-stop.jsonl`；对照：只发 Esc 时弹窗被关掉、主轮继续跑）。所以 `TspRunner.stop()` 在主轮 working 时先 `TspBtw.yieldToMain()`：回答中先 `action stop` → 等这一问收尾 → `action close`（`sync` 已自动发过就不重发）→ 等弹窗撤掉，然后才发 Esc、再走排队消息取回（`hasQueuedMessages` 在让开弹窗之后读）。实测这个顺序下主轮的助手消息 `stopReason: "aborted"`。让开失败（omp 没响应）只记日志，照常发 Esc。测试：`test/tsp-btw-driver.test.ts`（yieldToMain 事件和录制逐字相同）、`test/task-tsp-btw.test.ts`（stop 后 fake omp 收到 send、send、stop、close、Esc 的顺序）。
- 没有实测 `Interrupted` 状态词（按 omp 文档推断，进程退出时 studio 自己也会标）。

## 5. 测试

- `test/tsp-btw.test.ts`：纯函数，18.12.5 录制逐帧（弹窗节点、状态词、流式答案、取消、list/select、追问的 edit / send 事件和录制逐字相同、失败）+ 磁盘记录解析和合并。
- `test/tsp-btw-driver.test.ts`：`TspBtw` 对"回放宿主"（录制严格回放，早到的事件留着等）——提问 / 再问 / 追问 / 取消 / 自动关弹窗、本地拒绝、超时、进程退出、失败。
- `test/tsp-btw-history.test.ts`：磁盘读取。
- `test/task-tsp-btw.test.ts`：任务池 + `TspRunner` + fake-tsp-omp 在伪终端里回放 `btw.jsonl`，`btw` 事件推到渲染进程。
- `test/e2e/tsp.e2e.ts`「旁路提问面板(TSP)」：真实 App，面板里问 / 再问 / 追问 / 取消，omp 的弹窗一次也没画，假 omp 收到的事件和录制逐字相同。
