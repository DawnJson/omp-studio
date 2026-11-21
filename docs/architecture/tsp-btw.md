# TSP 任务的旁路提问（`/btw`）

TSP 任务里 `/btw` 由 studio 自己的面板（`features/btw/BtwPanel`，`askBtw` / `cancelBtw` / `getBtw` IPC）承接。omp 在 TSP 下把 `/btw` 画成弹窗（omp 19 起新问题画成对话里的便签，见 §1.1），studio 读弹窗和便签里的问答、两者都不画，所有操作由主进程在后台发事件完成。

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

### 1.1 omp 19.0.1 实测：新问题画成便签

真实 omp 19.0.1（`deepseek-flash`，临时 `PI_CODING_AGENT_DIR`，studio 的 `TaskPool` 驱动；2026-11-21）。录制 `fixtures/tsp/btw-19.jsonl`：主会话一句话 → 问 pong → 问 ping → 对 pong 追问 → 问长回答后取消。

- `/btw <问题>` **不再开弹窗**，在 main 末尾加一张便签（omp 源码 `packages/tui/src/overlays/btw-note.ts`）：

  ```
  <id>  col role=omp.btw.note（被点成输入框目标时 omp.btw.note.active）  actions.click=btw-focus  actions.menu=[btw-stop | btw-copy | btw-history | btw-fold …]
    <id>.head  row role=omp.btw.note.head → text omp.btw.note.tag "btw" · md omp.btw.note.question（record.title ?? 第一问）· row omp.btw.note.tools
    <id>.turn-N  col role=omp.btw.note.turn → [md omp.btw.followup（第二问起）] · md 答案（stream）| text omp.btw.pending "Thinking…" · [text omp.btw.error]
    <id>.status  text role=omp.btw.note.status  ← 只有最新一问的状态词，完成时没有这一行
  ```

  收起时整张换成一行 `omp.btw.note.folded`（没有问答）。便签里没有话题 id。
- 取消：对便签发 `action`，`act` 是 `btw-stop`（右键菜单项的 id）。之后状态词是 `Cancelled`，已收到的答案保留。
- 裸 `/btw` 仍开 `omp.overlay.btwHistory` 历史弹窗，结构和动作名和 18.12.5 相同，追问（select → follow-up → edit → send → close）照旧；追问期间对应的便签也跟着多一问。
- 便签不是 modal，不占 Esc：没有被点成输入框目标（studio 从不点它）时，主轮的 Esc 照常停主轮。

## 2. 设计

**数据**

| 来源 | 用途 | 位置 |
|---|---|---|
| 文档里的弹窗 | 实时：问题、答案（流式）、状态、错误、可点的按钮 | `shared/tsp/btw.ts`（`findBtwView` 等纯函数） |
| 会话旁边的 `btw-history/` | 话题 id、历史（含没有进程的任务、恢复的会话） | `main/tsp/btw-history.ts`（只读）+ `parseBtwEntry` / `mergeBtwDisk` |

镜像 `TspBtw.#records`（`main/tasks/tsp-btw.ts`）是 `BtwHistoryRecord[]`，和 rpc 的一样；推给渲染进程用同一组 `BtwUiEvent`（`record` / `delta` / `records`），所以渲染进程的 `btw-store`、`BtwPanel` 不区分来源。

- 每次文档变化（`TspRunner` 的 `onChange`）调 `sync(弹窗, 便签)`：
  - 弹窗：读弹窗 → 话题 id（有 list 用选中项；没有就按第一问的文字在镜像里找；找不到先用临时 id `live:N`）→ `viewToRecord` → `btwEventsFor`（答案只是追加就发 `delta`，别的发整条 `record`）。
  - 便签（omp 19）：每张展开的便签对应哪个话题记在 `#noteRecords`（`sf:节点 id` → 话题 id + 第一问）。提问时新出现的那张由 `#askNew` 绑上临时 id（提问期间 `sync` 不猜没绑过的便签：同一个问题问第二次时按文字会认成旧话题），磁盘对齐时随 `mergeBtwDisk` 的 `remap` 换成真 id；没绑过的（重开会话后 omp 放回来的、经历史弹窗追问展开的）按第一问找，镜像里同一个问题有多条话题时认不出就跳过，等磁盘对齐。便签只有最新一问的状态词，更早的一问以镜像里已收尾的状态为准（`viewToRecord`）。`TspDocScans.btwNotes` 在便签没变时给同一个数组，`sync` 据此跳过。
- 磁盘记录并进镜像（`mergeBtwDisk`）：临时 id 按第一问换成真 id；问答多的一方为准（镜像多一问 = 磁盘还没写追问）；回答中以镜像为准（磁盘上的答案要等收尾才写）；磁盘上写着 running 而镜像里没有在跑的 → `interrupted`（omp 重读历史时也这么标）。`getBtw` 每次先读一遍磁盘（不为它起进程），面板打开时调一次。
- `ask` 返回前短暂等临时 id 换成真 id（`ID_POLLS` × `ID_POLL_MS`；面板选中的就是真 id，追问要靠它在 list 里 `select`）。

**动作**（都在任务的界面操作队列 `#exclusive` 里，期间 `#btwDriving`：`#awaitComposer` 等它结束，主会话不会收到别的消息）

```
提问   send "/btw <问题>"（主输入框）→ 等新的弹窗（omp 18，第一问 = 问题）或新的便签（omp 19）出现 → 返回话题 id
追问   [裸 "/btw" 打开历史] → [select 话题] → action follow-up → 等输入框 → edit 填字 → action send → 等新的一问
取消   action stop（弹窗）；omp 19 的便签：action btw-stop
收尾   一问不再 running、没有在写追问 → action close（sync 里自动，驱动期间不关）
```

出错一律以 omp 没有响应的具体步骤为错误文字 reject（`omp did not open the side question…`、`omp did not select the side-question topic`…），超时见 `BTW_OPEN_TIMEOUT_MS` / `BTW_STEP_TIMEOUT_MS`，不吞。本地先拒绝：空问题、不认识的话题（`Unknown /btw topic: <id>`）、已有一个在跑（`A /btw question is still running; cancel it first`，和 rpc 同一句）。

**不画 omp 的弹窗和便签**：`TspChildren` 里按 role 不挂载 `omp.overlay.btwHistory` 和 `omp.btw.note` / `.active` / `.folded`（`isBtwHiddenNode`，同输入框卡片、待办药丸的做法）。弹窗的 Esc 处理器因此也不装。弹窗开着时 omp 的 Esc 落在弹窗上，所以**停止主轮**时 `TspRunner.stop()` 先让开弹窗（见下）；便签不占 Esc。

**入口**：`/btw [问题]`（`studio-slash-table.ts`，`tsp: "studio"`）和命令面板“旁路提问（/btw）”；`App.tsx` 在 TSP 分支里挂 `BtwPanel`。

**高度分配**：主对话 `TspView` 从零基准分配剩余高度，历史内容在内部滚动，不以全部内容高度参与和旁路面板的空间竞争。旁路面板保留高度上限和矮窗口下的收缩，长答案在正文内滚动。

## 3. 依赖的 omp 约定（omp 升级时先看这里）

role `omp.overlay.btwHistory` / `omp.btw.*` / `omp.btw.note*` / `omp.btn`、按钮动作名 `stop` `close` `follow-up` `send` `discard`、便签动作名 `btw-stop`、状态词 `Answering` `Cancelled` `Failed` `Interrupted`、`btw-history/entry-*.json` 的目录和形状。全部集中在 `shared/tsp/btw.ts` 和 `main/tsp/btw-history.ts`；`test/tsp-btw.test.ts` 用 18.12.5 和 19.0.1 的录制逐帧验证，omp 改了这里先红。解析不了的磁盘文件跳过并记日志；弹窗读不到按钮时以 `omp's side-question window has no <动作> button` reject。

## 4. 没做 / 已知限制

- 弹窗里只有选中话题的问答：非选中话题的内容只能从磁盘读（实时的只有正在回答的那个）。
- 终端里的 omp 在 studio 之外追问同一个话题（另一个进程）：磁盘上问答更多时以磁盘为准，实时流式看不到。
- **停止**：弹窗开着时 Esc 只会落在弹窗上，停不了主轮（实测 omp 18.12.5，录制 `btw-stop.jsonl`；只发 Esc 时弹窗被关掉、主轮继续跑）。所以 `TspRunner.stop()` 在主轮 working 时先 `TspBtw.yieldToMain()`：回答中先 `action stop` → 等这一问收尾 → `action close`（`sync` 已自动发过就不重发）→ 等弹窗撤掉，然后才发 Esc、再走排队消息取回（`hasQueuedMessages` 在让开弹窗之后读）。实测这个顺序下主轮的助手消息 `stopReason: "aborted"`。让开失败（omp 没响应）只记日志，照常发 Esc。测试：`test/tsp-btw-driver.test.ts`（yieldToMain 事件和录制逐字相同）、`test/task-tsp-btw.test.ts`（stop 后 fake omp 收到的事件顺序）。
- 没有实测 `Interrupted` 状态词（按 omp 文档推断，进程退出时 studio 自己也会标）。
- omp 19 的便签：头上画的是 `record.title ?? 第一问`。带标题的话题（omp 的 `/sitrep` 这类命令开的）按文字对不上，回答中面板不实时更新，收尾后读磁盘才有。答案里的 `<inject>` 块（`btw.inject` 打开时）按普通文字读，没有实测。omp 超过 `BTW_OPEN_TIMEOUT_MS` 才画出便签时提问已经报错、便签没有绑定，之后按文字找；镜像里恰好只有一条同样问题的旧话题时，旧话题会被这张便签的内容盖掉（实测 omp 19.0.1 画便签在 1 秒内，没有处理）。
- **没有"丢弃话题"**：omp 的 `discard` 只丢掉追问输入框里还没发的草稿（studio 在追问前、让开弹窗前用它关掉残留的输入框，见 `#askFollowUp` / `yieldToMain`），**不删话题**，omp 也没有别的删除话题的按钮（实测 omp 18.12.6，2026-10-23：点 `discard` 后弹窗和话题都在，`btw-history/` 里的文件不变；`fixtures/tsp/btw.jsonl` 里 `discard` 同样只在追问输入框那一行出现）。studio 也不该直接删 omp 的话题文件（studio 不写 omp 的存档）。要的话只能做 studio 自己的"隐藏这个话题"（不动磁盘），没做，等仓库所有者决定。
- **复制答案**：面板头部的按钮（`btw-copy-answer`）把当前话题最新一问的答案文字写进系统剪贴板（渲染进程 `navigator.clipboard`），出 `common.copied` toast；不驱动 omp 弹窗里的 `copy-answer` 按钮（那是 omp 往它自己的终端剪贴板写，studio 拿不到结果，而答案文字本来就在镜像里）。没有答案时按钮不出现。

## 5. 测试

- `test/tsp-btw.test.ts`：纯函数，18.12.5 录制逐帧（弹窗节点、状态词、流式答案、取消、list/select、追问的 edit / send 事件和录制逐字相同、失败）+ 磁盘记录解析和合并；19.0.1 录制逐帧读便签（新问题、回答中、追问、取消）。
- `test/tsp-btw-driver.test.ts`：`TspBtw` 对"回放宿主"（录制严格回放，早到的事件留着等）——提问 / 再问 / 追问 / 取消 / 自动关弹窗、本地拒绝、超时、进程退出、失败；`btw-19.jsonl` 走一遍便签的提问、追问和取消。
- `test/tsp-btw-history.test.ts`：磁盘读取。
- `test/task-tsp-btw.test.ts`：任务池 + `TspRunner` + fake-tsp-omp 在伪终端里回放 `btw.jsonl`，`btw` 事件推到渲染进程。
- `test/e2e/tsp.e2e.ts`「旁路提问面板(TSP)」：真实 App，面板里问 / 再问 / 追问 / 取消，omp 的弹窗一次也没画，假 omp 收到的事件和录制逐字相同；「旁路提问面板(TSP,omp 19 便签)」同样走 `btw-19.jsonl`，便签和弹窗一次也没画。
