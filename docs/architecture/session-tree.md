# 会话树、分叉、回溯

> 本文前半是 rpc 任务（`get_tree` / `branch`），后半“TSP 任务”一节是 TSP 引擎的做法（omp 18.12.5 实测）。

实现：`src/main/tasks/session-tree.ts`（纯函数）、`task-runner.ts` 的 `getSessionTree` / `forkSession` / `branchInPlace`、`task-pool.ts` 的 `getSessionTree` / `forkTask` / `branchTask`；界面在 `src/renderer/src/features/conversation/`（`UserMessage.tsx`、`SessionTreePanel.tsx`、`fork-actions.ts`、`session-tree-store.ts`）。测试：`test/session-tree.test.ts`、`test/task-fork.test.ts`。

## 实测（omp 18.12.2，Tern 的 exe，`--mode rpc-ui`，临时 `PI_CODING_AGENT_DIR` 且 `USERPROFILE`/`HOME` 指向临时目录，deepseek-v4-flash，两轮对话 ALPHA / BETA）

**读**

- `get_entries {}` → `{entries, leafId}`：会话文件的行，按追加顺序，平铺。两轮之后 7 条：`model_change`、`thinking_level_change`、`message`(user ALPHA)、`custom`(`system-prompt-digest`)、`message`(assistant)、`message`(user BETA)、`message`(assistant)。每条有 `type, id`（8 位十六进制）`, parentId, timestamp, runtime.version`；`message` 条目带 `message: {role, content[], attribution, timestamp, …}`。`leafId` 是最后一条 assistant。
- `get_tree` → `{tree, leafId}`：同样的条目套成 `{entry, children[]}`，根是 `model_change`。
- `get_branch_messages` → `{messages: [{entryId, text}]}`：当前分支上的用户消息，按先后。
- 这三条在 omp 跑着一轮时**不报 `session_busy`**，照常回当前已写入的内容。

**`branch {entryId}`**（entryId 必须是用户消息）

- 应答 `{text, cancelled: false}`：`text` 是被选中的那条用户消息的文字。
- **不是在同一个会话文件里移动叶子**：omp 新建一个会话文件（新的 `sessionId`，同一个会话目录里多一个 `<时间>_<id>.jsonl`），把进程切过去。新文件 = 从根到**这条消息的父条目**的路径（选 BETA：5 条，叶子是 ALPHA 的 assistant，`get_messages` 是 user、assistant；选第一条用户消息：2 条，`get_messages` 为空）。原文件一个字节没动（行数 9 → 9，条目 7、叶子不变；`switch_session` 回去后 `get_entries` 和原来一样）。
- 帧：只有 `extension_ui_request{setWidget}` 和 `available_commands_update`，**没有 `session_info_update`**。
- 选非用户消息（assistant）→ 错误 `Invalid entry ID for branching`。
- **运行中不报 `session_busy`**：一轮正在流式时发 `branch` 照样执行，把进程切到新文件。所以 studio 必须自己确认空闲（见下）。

**`fork {entryId?}`**

- 应答只有 `{cancelled: false}`（`CancellationResult`；`true` 是 omp 的扩展钩子取消了这次操作，**[推测]**，没有构造出来），**不返回文字**。
- 同样新建会话文件并切过去，但新文件 = 到**这条条目本身**（含）的路径：`fork {u2}` 得到 user、assistant、user（叶子是 u2，6 条）；`fork {assistant1}` 得到 user、assistant；`fork {}` 不带 entryId = 整个会话的副本（4 条消息、7 条目）。原文件不变。
- 未知 entryId → `Invalid entry ID for forking: nope`。`branch` 之后进程在新文件里，旧文件的条目 id 对 `fork` 也无效。
- **一轮在跑时报 `session_busy`**（`code:"session_busy"`，"Cannot fork the session while session maintenance or user work is still running"）。
- 帧同 `branch`。

**`switch_session {sessionPath}`**：回到原文件，应答 `{cancelled:false}`，帧同上；原会话的 `get_messages` / `get_entries` 完整。

**端到端复核**（真实 omp，经 `TaskPool`，临时目录）：`forkTask` 后新任务记新文件、原任务记录仍是原文件；之后原任务继续发 prompt，记录仍是原文件；`branchTask` 后任务改记新文件，对话流是 user、assistant，`get_tree` 只剩 ALPHA 一个节点（`current`）。

## 取舍

- **“从这里分叉”用 `branch`，不用 `fork`**：TUI 的分叉语义是“回到这条用户消息之前，把它放进编辑框让你改了重发”——`branch` 恰好返回文字、新会话恰好停在它之前；`fork` 的新会话含这条消息、也不给文字，要自己再去读。所以 `fork` RPC 不用。
- **新任务怎么拿到新会话文件**（`TaskRunner.forkSession`，一个进程内完成）：在原任务的进程上 `get_branch_messages` → `branch` → `get_state`（读新文件路径）→ `switch_session` 回原文件；新任务记 `sessionFile = 新文件`，稍后自己起进程恢复它（和历史列表“恢复会话”同一条路：握手里 `switch_session`、`loadHistory`）。不为分叉另起临时进程：省一次握手，也不占名额。代价是原进程短暂换过会话，所以：
  - 期间（`#sessionOp`）所有写命令和要进程的命令（`sendPrompt`、`runBash`、`askBtw`、`goal`、`compact`、`setModel` 等、`exportHtml`、`rename`、`getSessionTree`）都先过 `#awaitSessionIdle()` 等它结束；`sendPrompt` 在最后一个 await 之后、`request("prompt")` 之前再查一次。`get_state` 的应答不写进任务记录：`#refreshState` 用 `#sessionEpoch` 丢掉跨越了切换的应答（`stop()` 同样在 epoch 变了时不落盘），结束后补一次刷新——否则分叉的文件会被当成原任务的会话文件存进 `tasks.json`。
  - 切回失败（`switch_session` 报错或 `cancelled`）时进程留在分叉的会话上，不能再用：关掉进程（任务回到 stopped，下次启动按记录恢复原会话）并报错。
  - 只在任务空闲时做：状态机 `idle`、没有未答对话框，没有别的在途命令（`#inflight` 只剩自己）、没有在跑的 `!命令`、没有在跑的 `/btw`，且当前 `get_state` 的 `isSettled` 为真、没有 `hasPendingAsyncWork`、没有在流式；否则抛 `SessionBusyError`（`the session is busy…`，界面是 `error.sessionBusy`）。这是**必须自己查**的：`branch` 在 omp 里不会拒绝运行中的会话，`!命令`/`/btw` 又不改状态机；不查的话它们的结果会落进分叉的会话文件。界面同样在 shell 命令或 `/btw` 在跑、以及分叉在途时隐藏/禁用“从这里分叉”。
- **对话流里的用户消息 → 条目 id**（`locateUserEntry`）：对话流项不带条目 id。渲染进程传对话流里那条消息的 key（`null` = 最后一条），主进程在自己的快照里找它的文字，再按“同样文字的消息从后往前数第几次出现”对上 `get_branch_messages` 里同样文字的那条。不用序号：压缩过的会话对话流只有后半段，omp 自己注入的用户消息也会错开序号。找不到就抛错，不猜。
- **新任务的属性**：同项目、同 cwd、同模型和思考强度（记录里复制），标题照抄原任务（空标题在首次打开后从第一条用户消息回填）。`tasks.json` 里一条新记录，一个任务一个会话的不变量不变；原任务的记录、对话流、进程不变。新任务和 `resume` 一样在后台起进程；占不到名额时状态是 error，和别的任务一样。
- **worktree 任务的分叉共用同一个 worktree**：omp 会话绑 cwd（`switch_session` 要求进程 cwd 就是会话的 cwd），分叉必须在同一目录恢复；所以新记录带同样的 `worktreePath/Branch/Base`。后果：两个任务改的是同一份工作区（和在同一项目里开两个任务一样，用户自己负责）；`discardWorktree` 在还有别的任务（**含已归档的**）用同一个 worktree 时拒绝（`the worktree is shared with another task`，界面 `error.worktreeShared`）：归档不删 worktree，但 `removeWorktree` 会连分支一起删，已归档的分叉恢复后只会是 `worktree_missing`。这与清理无主 worktree 时保护所有（含已归档）引用的规则一致。
- **会话树面板的“选中”是就地回溯**（`TaskRunner.branchInPlace`）：`branch` → `get_state` → `loadHistory`，任务改记新的会话文件（`#adoptState`），对话流用 `history` 事件整体换成新会话的历史，返回那条消息的文字，渲染进程把它追加进输入框。同样要求空闲、同样占 `#sessionOp`。`branch` 之后任何一步失败（进程已在新文件上、对话流还是旧历史）：关掉进程并报错，记录不更新，下次启动按原记录恢复原会话。成功后 `/btw` 镜像清空并重新对齐（话题属于旧会话）。**原会话文件留在磁盘上**，不再属于这个任务，但在历史列表（`session-history.md`）和终端版 omp 的 `/resume` 里仍然找得到。图片不会跟着回来（`branch` 只返回文字）。
- **树的内容**：`buildSessionTree` 只取用户消息（不含 `attribution: "agent"` 的 omp 注入消息），先序展开；缩进只在“父用户消息有不止一个用户消息分支”处加一级；叶子所在分支标 `onCurrentBranch`，分支上最后一条用户消息标 `current`。因为 studio 里的 `branch` 总是新建文件，studio 自己的会话是一条直线，**只有在终端版 omp 里用 `/tree` 原地切过分支的会话才会出现真正的分叉**。显式栈遍历（长会话的树很深）。
- IPC 收窄：`getSessionTree(taskId)`、`forkTask(taskId, userMessageKey|null)`、`branchTask(taskId, entryId)` 只作用于已存在的任务；key 和 entryId 限长 200，entryId 由 omp 校验（非用户消息 / 未知 id 它会拒绝）；渲染进程不传路径，会话文件路径由主进程从 `get_state` 读。

## 界面

- 用户消息悬停：复制 + “从这里分叉”（任务空闲时才有）→ `forkTask`，新任务被选中，输入框里是那条消息的文字。
- `/fork` = 从最后一条用户消息分叉；`/tree` 和命令面板“会话树”打开面板；`terminalOnly` 里去掉了 `tree`、`fork`。失败时 `sendDraft` 把原文放回草稿并报错。
- 面板键盘：`↑↓ Home End` 移动、`Enter` / 点击选中、`Esc` 关闭并还焦点，焦点陷阱在面板内；样式只用 token，动画用 `--dur-*`（reduced-motion 下自动退化）。

## 已知限制

- 运行中的任务不能分叉、不能回溯（界面藏起“从这里分叉”，面板里选中会被主进程拒绝并 toast）。
- 压缩（compaction）之后，对话流只有压缩点之后的消息；更早的用户消息在面板里能看到（来自 `get_tree`），但对话流里没有对应的气泡。
- `get_tree` 返回整棵树（含消息内容），很长的会话可能是几 MB（v2 分块）；面板打开时读一次，不缓存。
- 界面（面板、悬停按钮）没有用 Playwright 截图核对：本次只做了单元测试和真实 omp 的主进程端到端复核。

# TSP 任务（`taskEngine = tsp`，上面是 rpc 任务）

rpc 的 `get_tree` / `branch` / `fork` 在 TSP 任务里不存在（交互式 omp 没有 rpc 命令）。TSP 版用 omp 自己的三样东西：会话文件（只读）、`/tree` 选择器（回溯）、`--fork` 启动参数（分叉成新任务）。**studio 从不写会话文件**。

实现：`src/main/tsp/session-tree-file.ts`（会话文件 → 条目 → 树，复用 `main/tasks/session-tree.ts` 的 `buildSessionTree`）、`src/shared/tsp/session-tree.ts`（omp `/tree` 选择器、输入框、用户消息卡片的纯函数）、`tsp-runner.ts` 的“会话树、回溯、分叉”一段（`getSessionTree` / `prepareFork` / `rewindTo`）、`task-pool.ts` 的 `#forkTspTask`；`TaskRecord.forkFrom`；`launch-args.ts` 的 `forkSessionFile`。界面同一个 `SessionTreePanel`（`App.tsx` 在 `TspView` 旁挂它）；`features/tsp/actions.ts` 接管 omp 的 `rewind` 图标。测试：`test/tsp-session-tree.test.ts`（真实会话文件 `fixtures/omp-session/*.jsonl` 和 omp 录的 `fixtures/tsp/session-tree.jsonl`）、`test/task-tsp-tree.test.ts`（任务池 + 假 omp）、`test/e2e/session-tree.e2e.ts`。

## 实测（omp 18.12.5，`omp --version` → `omp/18.12.5`，真实 omp、临时 `PI_CODING_AGENT_DIR`、deepseek-v4-flash，两轮对话 ALPHA / BETA；2026-10-21）

**会话文件**（`omp -p` 两次得到，11 行）：第 1 行 `{"type":"title",…,"pad":"<空格>"}`（固定宽度的标题槽），第 2 行 `{"type":"session",id,cwd,…}`；之后每行是带 `id`（8 位十六进制）和 `parentId` 的条目：`model_change`（根，`parentId:null`）、`thinking_level_change`、`message`（user / assistant）、`custom`（`system-prompt-digest`、`session_exit`）。两个文件头都没有 `parentId`，不是树的一部分。omp 追加的每个条目都挂在当时的叶子下面，所以**文件最后一个条目 = 叶子**；omp 里 `/tree` 选择器的 `current` 也是它（`d28e91a6`，最后一行 `session_exit`）。

**`/tree` 在 TSP 里**（录制 `fixtures/tsp/session-tree.jsonl`）：`send "/tree"` → layer 里出现 `picker`（`title:"Session tree"`、`layout:"tree"`、`items[].id` 就是会话条目 id、`items[].node` 是 `user` / `assistant` / `marker`、`depth` 是分叉深度、`order` 是默认过滤下可见的条目、`selected`、`current`（叶子）、`tabs`（Default / No tools / User only / Labeled / All）、`actions`（switch / summarize / label / filter / close））。

**回溯 = 在选择器里 `activate item=<用户消息的条目 id>`**：选择器关闭；叶子移到这条消息的**父条目**；omp 重画对话（只剩到新叶子为止的卡片：两轮会话回溯到 BETA 之前后只剩 ALPHA 一张 `omp.user` 卡片）；omp 自己的输入框（dock 里 `omp.editor` 下的 `editor` 节点）被填成这条消息的文字，出现 toast `Navigated to selected point`。**会话文件一个字节没动**（行数、内容不变），OSC `omp_session_file` 也不变——叶子移动只在 omp 进程内存里。之后发的第一条消息才在文件里长出新分支：它的 `parentId` 是回溯到的位置（实测 `/tree` → BETA → 发 GAMMA：`47b8e31d` 的 `parentId` = `a6b4e493`，和 BETA（`b772c2f5`）同一个父条目，两条分支在同一个文件里；`fixtures/omp-session/branched.jsonl`）。

- 选**助手消息**：叶子移到它本身，输入框不预填（toast 同上）。studio 的面板只列用户消息，不用这个。
- 选**当前叶子**：什么都不发生（选择器留着、没有 toast）。studio 等不到选择器关闭就按 Esc 并报错（`omp did not move to that message`）。
- omp 的预填**只在输入框为空时才写**（omp 文档 `tree.md`）：studio 回溯后把 omp 的输入框清空（`edit` 事件整段替换成空串，实测有效），否则下一次回溯拿不到文字。回溯前输入框非空也先清空。返回给界面的文字取自会话文件里那条消息的全部文本块（换行连起来），不依赖输入框里的内容。
- **摘要提示**（`branchSummary.enabled` 打开时；实测，录制 `fixtures/tsp/session-tree-prompt.jsonl`）：`activate` 用户消息后树选择器被换成另一个 layer picker：`title:"Summarize branch?"`、`layout:"rows"`、items `0` No summary / `1` Summarize / `2` Summarize with custom prompt。`activate item=0` 直接回溯（同上，文件不变）；`activate item=1` omp 调一次模型写摘要（实测约 2 秒），在文件末尾追加一个 `branch_summary` 条目（`parentId` = 新叶子，即被选用户消息的父条目；`summary` 是“User explored another conversation branch, then returned here. …”），再回溯；`activate item=2` 出现 `omp.hook-editor` 覆盖层（“Custom summarization instructions”，`editor` + Open in editor / Cancel / Submit 按钮，`action submit`）；在摘要提示里 Esc = 回到树选择器。studio 不提供自定义指令（只提供下面两种）。
- **直接摘要**（选择器底栏动作 `summarize` = Shift+Enter，实测录制 `session-tree-summarize.jsonl`）：先 `select item=<条目>` 再 `action act="summarize"`，**不管 `branchSummary.enabled` 开没开**都不弹提示直接摘要并回溯，同样追加 `branch_summary`。studio 的“回溯时摘要”就是它。
- **压缩过的会话**（实测：`compaction.keepRecentTokens=5` + `/compact`，文件里追加 `compaction` 条目，`firstKeptEntryId` = 保留的最早条目）：重新 `--resume` 后 omp **只画压缩点之后的内容**（一张压缩分隔 + 保留下来的回答，**没有任何 `omp.user` 卡片**），但 `/tree` 仍列出整份文件的全部条目；`activate` 压缩点**之前**的用户消息（ALPHA）照常成功：toast `Navigated to selected point`、输入框预填、文件不变。录制 `session-tree-compacted.jsonl`，会话 `fixtures/omp-session/compacted.jsonl`。

**`--fork=<会话文件>`**（`omp --help` 18.12.5 **没有列出**这个参数，但 omp 文档 `session-operations-export-share-fork-resume.md` 写了，实测可用）：复制整个会话文件，新 `session` 头（新 `id`、`parentSession` = 原会话 id，其余条目 id 原样保留），建在当前 cwd 对应的会话目录里，omp 启动后就在新文件上；**新文件在启动时就已落盘**，OSC `omp_session_file` 在启动时就报它的路径（所以 `persistSessionFile` 立刻能记下）。原文件不动（逐字节相同）。`--fork` 不能切到某条消息之前：它总是整份复制，叶子是文件最后一个条目；要回到某条消息之前，只能在新进程里再用 `/tree` 回溯。和 `--model` / `--thinking` 一起用没问题。

**端到端复核**（真实 omp，经 `TaskPool`，临时目录，`scripts` 里的一次性脚本已删）：①`forkTask(源任务, BETA)`：新任务 `--fork=<源会话文件>` 起，回溯后返回 `Reply with exactly: BETA. No tools.`，新会话文件 1 个，原文件不变；新任务的 `sessionFile` 记下新文件、`forkFrom` 清掉；②在新任务里发一句 DELTA：新文件里 DELTA 的 `parentId` = BETA 的父条目（真分叉在新文件里），原文件仍不变；树面板在发送前显示 ALPHA 当前、BETA 在别的分支，发送后 DELTA 当前；③原任务 `branchTask(BETA)`、再 `branchTask(ALPHA)`（第二次回溯同样成功）：文件不变，树里的“当前”跟着移动（回溯到 ALPHA 之前时两条用户消息都不在当前分支上，没有“当前”节点）。

## 设计

- **树**：`getSessionTree` 只读会话文件，不拉起进程（还没有会话文件 = 第一条回复之前，nodes 为空；文件 > 256 MB 拒绝读）。条目 → `{entry, children}` 嵌套（没有父或父不在文件里的当根），再用 rpc 同一个 `buildSessionTree`：只列用户消息（不含 `attribution:"agent"`），先序，分叉处缩进一级，叶子所在分支标 `onCurrentBranch`，分支上最后一条标 `current`。**和 rpc 不同：TSP 里真的会出现分叉**——回溯后发新消息就在同一个文件里长出分支；omp 自己的 `/tree` 把当前分支排在前面，studio 按文件顺序。中间坏行抛错，写到一半的最后一行跳过。
- **回溯后“当前”的空档**：叶子移动不写文件，面板在你发新消息之前从文件看不出叶子移到了哪。`TspRunner` 在回溯成功后记 `LeafOverride{afterEntryId: 回溯时文件最后一个条目, leafId: 那条消息的父条目}`，文件最后一个条目还是它时叶子按 override 算，文件一长（新条目出现）自动失效。不是 studio 发起的回溯（比如用户在 omp 自己的界面里）看不到。
- **摘要**：面板底部（TSP 任务）有开关“回溯时让 omp 摘要被放弃的分支”（`session-tree-summarize`，默认关，不记忆）；勾上后 Enter / 点击 = `branchTask(id, entry, true)` → `select` + `action summarize`，面板保持打开、标题换成 `tree.summarizing` 直到 omp 写完（最长 120 秒），成功后关面板；`BranchTaskResult.summarized` 回报。没勾时如果 omp 开着 `branchSummary.enabled` 弹出摘要提示，studio 自动答 No summary（所以分叉出的新任务也不会被提示卡住）。
- **回溯**（`TspRunner.rewindTo`，`#exclusive` 串行）：校验目标是这个会话的用户消息 → `start()` → 要求这一轮已结束（`working`、有对话框、有在跑的工具/子代理都拒绝，错误文字 `the session is busy; wait for the current turn to finish`，界面 `error.sessionBusy`）→ 清空 omp 输入框 → `send "/tree"` → 等 `layout:"tree"` 的 picker，目标不在 `items` 里就 Esc 并报错 → `activate` → 等选择器关闭 → 最多等 1.5 秒预填/toast（等不到不算失败）→ 再清空输入框 → 记 `LeafOverride`。
- **分叉**（`TaskPool.#forkTspTask`）：`prepareFork` 校验（这一轮已结束；有会话文件；条目是用户消息，null = 当前分支最后一条）→ 新增任务记录 `{engine:"tsp", sessionFile:null, forkFrom:<原会话文件>, 同项目/cwd/worktree/模型}` → 第一次启动 `omp --fork=<forkFrom>`（`buildTspArgs` 的 `forkSessionFile`，已有 `sessionFile` 时 `--resume` 优先）→ 新文件路径一落盘，`persistSessionFile` 记 `sessionFile` 并清掉 `forkFrom` → 在新进程里 `rewindTo(条目 id, 已查好的目标)`（目标取自原文件：`--fork` 保留条目 id，不依赖新文件路径已经报到）。`forkTask` 的第二个参数在 TSP 任务里是**会话条目 id**（面板节点的 `entryId`），null = 最后一条用户消息；rpc 任务仍是对话流 key。回溯失败时新任务保留（它是原会话的完整副本），错误照抛，不自动删。原任务全程不动、不需要进程。
- **用户消息的回退图标**：omp 在每张 `omp.user` 卡片的工具行里画了 `icon` 节点（`actions.click:"rewind"`、title “Rewind the conversation to an earlier message”）；studio 接管：`features/tsp/actions.ts` 的 `rewind` 打开面板，并按“这张卡片是 main 里从末尾数第几张”对位到当前分支上同序的用户消息（从末尾数，因为压缩过的会话 omp 只画压缩点之后的消息）。不会再把 `rewind` 发给 omp（omp 自己的全屏回退选择器不出现）。
- **界面**：同一个面板；TSP 任务每行多一个“从这里分叉”按钮（悬停/选中时出现，`session-tree-fork`；`Shift+Enter` 同效），点后面板标题换成 `tree.forking`，成功后关面板并选中新任务、文字进它的输入框，失败 toast `tree.forkFailed`。`/tree`、`/fork`（`studio-slash-table.ts`，`tsp:"studio"`）和命令面板“会话树”在 TSP 任务里同样可用；`/fork` = 从当前分支最后一条用户消息分叉（不是 omp 自己 `/fork` 的“复制整个会话”语义）。

## TSP 的已知限制和没测的

- **回溯不持久**：叶子移动只在 omp 进程内存里，文件里直到下一条新消息才有痕迹。回溯后不发消息就关掉任务/退出应用，下次 `--resume` 回到文件最后一个条目（完整历史），回溯丢了；分叉出的新任务同理（没发消息之前，重新打开看到的是原会话的完整副本）。omp 自己的终端版也是这样。studio 没有办法写文件让它持久，也不该写。
- **分叉是整份复制**：新任务的会话文件里还保留着原会话在分叉点之后的消息（成了另一条分支）。omp 的 `--fork` 不能只复制到某个条目，和 rpc 版（`branch` 只留到那条消息之前）不同；对话流只显示当前分支，所以界面上看不到，面板里能看到那条旧分支。
- 同一个会话文件在原任务和新任务里同时被 omp 追加的情况不会出现（`--fork` 复制成了新文件），但 worktree 任务的分叉仍共用同一个 worktree（和 rpc 版一样，`discardWorktree` 保护）。
- 运行中（或有未答对话框、有在跑的工具/子代理）的任务不能回溯和分叉（`the session is busy…`）；面板里分叉按钮在任务不空闲时置灰，选中回溯由主进程拒绝。
- 压缩（compaction）之后，omp 只重画压缩点之后的消息；面板里仍列出更早的用户消息（回溯到压缩点之前已实测可用，见上），回退图标按“从末尾数”对位所以不错位。压缩后 omp 里没有 `omp.user` 卡片的那些消息没有回退图标，只能从面板进。
- 会话文件里的 `label`、`branch_summary`、`compaction` 条目面板不显示（只列用户消息）；`Shift+Enter` 摘要、`Shift+L` 标签是 omp `/tree` 里的功能，studio 面板没有。
- 界面（面板、按钮、回退图标）没有在真实 Electron 里截图核对；`test/e2e/session-tree.e2e.ts` 用假 omp 覆盖流程，由集成者运行。
