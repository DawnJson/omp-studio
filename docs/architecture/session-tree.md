# 会话树、分叉、回溯

任务是交互式 omp（TSP）。会话树用 omp 自己的三样东西：会话文件（只读）、`/tree` 选择器（回溯、打标签）、`--fork` 启动参数（分叉成新任务）。**studio 从不写会话文件。**

实现：`src/main/tsp/session-tree-file.ts`（会话文件 → 条目 → 树）、`src/main/tasks/session-tree.ts`（`buildSessionTree` 纯函数）、`src/shared/tsp/session-tree.ts`（omp `/tree` 选择器、输入框、用户消息卡片的纯函数）、`src/main/tasks/tsp-session-tree.ts`（`TspSessionTree`：`getSessionTree` / `prepareFork` / `rewindTo` / `labelEntry`，`TspRunner` 转发）、`task-pool.ts` 的 `forkTask`；`TaskRecord.forkFrom`；`launch-args.ts` 的 `forkSessionFile`。界面 `src/renderer/src/features/conversation/`（`SessionTreePanel.tsx`、`session-tree-store.ts`、`fork-actions.ts`；`App.tsx` 在 `TspView` 旁挂面板）；`features/tsp/actions.ts` 接管 omp 的 `rewind` 图标。测试：`test/tsp-session-tree.test.ts`（真实会话文件 `fixtures/omp-session/*.jsonl` 和 omp 录的 `fixtures/tsp/session-tree*.jsonl`）、`test/session-tree.test.ts`（`buildSessionTree`）、`test/task-tsp-tree.test.ts`（任务池 + 假 omp）、`test/e2e/session-tree.e2e.ts`。

## 实测（omp 18.12.5，真实 omp、临时 `PI_CODING_AGENT_DIR`、deepseek-v4-flash，两轮对话 ALPHA / BETA；2026-10-21）

**会话文件**：第 1 行 `{"type":"title",…,"pad":"<空格>"}`（定宽标题槽），第 2 行 `{"type":"session",id,cwd,…}`；之后每行是带 `id`（8 位十六进制）和 `parentId` 的条目：`model_change`（根，`parentId:null`）、`thinking_level_change`、`message`（user / assistant）、`custom`（`system-prompt-digest`、`session_exit`）。两个文件头没有 `parentId`，不是树的一部分。omp 追加的每个条目都挂在当时的叶子下面，所以**文件最后一个条目 = 叶子**；omp `/tree` 选择器的 `current` 也是它。

**`/tree` 在 TSP 里**（录制 `fixtures/tsp/session-tree.jsonl`）：`send "/tree"` → layer 里出现 `picker`（`title:"Session tree"`、`layout:"tree"`、`items[].id` 就是会话条目 id、`items[].node` 是 `user` / `assistant` / `marker`、`depth` 是分叉深度、`order` 是默认过滤下可见的条目、`selected`、`current`（叶子）、`tabs`、`actions`（switch / summarize / label / filter / close））。

**回溯 = 在选择器里 `activate item=<用户消息的条目 id>`**：选择器关闭；叶子移到这条消息的**父条目**；omp 重画对话（只剩到新叶子为止的卡片）；omp 自己的输入框（dock 里 `omp.editor` 下的 `editor` 节点）被填成这条消息的文字，出现 toast `Navigated to selected point`。**会话文件一个字节没动**，OSC `omp_session_file` 也不变——叶子移动只在 omp 进程内存里。之后发的第一条消息才在文件里长出新分支：它的 `parentId` 是回溯到的位置，两条分支在同一个文件里（`fixtures/omp-session/branched.jsonl`）。

- 选**助手消息**：叶子移到它本身，输入框不预填（toast 同上）。studio 的面板只列用户消息；回答上的分叉用它（见下「回答上的分叉」）。
- 选**当前叶子**：什么都不发生（选择器留着、没有 toast）。studio 等不到选择器关闭就按 Esc 并报错（`omp did not move to that message`）。
- omp 的预填**只在输入框为空时才写**（omp 文档 `tree.md`）：studio 回溯前后都把 omp 的输入框清空（`edit` 整段替换成空串），否则下一次回溯拿不到文字。返回给界面的文字取自会话文件里那条消息的全部文本块，不依赖输入框。
- **摘要提示**（`branchSummary.enabled` 打开时；录制 `fixtures/tsp/session-tree-prompt.jsonl`）：`activate` 用户消息后树选择器被换成 `title:"Summarize branch?"`、`layout:"rows"` 的 picker，items `0` No summary / `1` Summarize / `2` Summarize with custom prompt。`0` 直接回溯；`1` omp 调一次模型写摘要（约 2 秒），在文件末尾追加 `branch_summary` 条目（`parentId` = 新叶子）再回溯；`2` 出现 `omp.hook-editor` 覆盖层（自定义指令）；Esc = 回到树选择器。studio 不提供自定义指令。
- **直接摘要**（选择器底栏动作 `summarize` = Shift+Enter，录制 `session-tree-summarize.jsonl`）：`select item=<条目>` 再 `action act="summarize"`，**不管 `branchSummary.enabled`** 都不弹提示直接摘要并回溯，同样追加 `branch_summary`。studio 的"回溯时摘要"就是它。
- **压缩过的会话**（`compaction` 条目，`firstKeptEntryId` = 保留的最早条目）：`--resume` 后 omp **只画压缩点之后的内容**（没有任何 `omp.user` 卡片），但 `/tree` 仍列出整份文件的全部条目；`activate` 压缩点**之前**的用户消息照常成功。录制 `session-tree-compacted.jsonl`，会话 `fixtures/omp-session/compacted.jsonl`。

**`--fork=<会话文件>`**（`omp --help` 18.12.5 **没有列出**，但 omp 文档 `session-operations-export-share-fork-resume.md` 写了，实测可用）：复制整个会话文件，新 `session` 头（新 `id`、`parentSession` = 原会话 id，其余条目 id 原样保留），建在当前 cwd 对应的会话目录里；**新文件在启动时就已落盘**，OSC `omp_session_file` 启动时就报它的路径（所以 `persistSessionFile` 立刻能记下）。原文件逐字节不变。`--fork` 总是整份复制，叶子是文件最后一个条目；要回到某条消息之前，只能在新进程里再用 `/tree` 回溯。和 `--model` / `--thinking` 一起用没问题。

**端到端复核**（真实 omp，经 `TaskPool`）：`forkTask` 后新会话文件 1 个、原文件不变、新任务记下 `sessionFile` 并清掉 `forkFrom`；在新任务里发消息，新消息的 `parentId` = 被选消息的父条目（真分叉在新文件里）；原任务里连续两次 `branchTask` 都成功，文件不变，树里的"当前"跟着移动。

## 设计

- **树**：`getSessionTree` 只读会话文件，不拉起进程（还没有会话文件 = 第一条回复之前，nodes 为空；文件过大拒绝读）。条目 → `{entry, children}` 嵌套（没有父或父不在文件里的当根），再用 `buildSessionTree`：列用户消息（不含 `attribution:"agent"` 的 omp 注入消息）、压缩点和分支摘要（下一节），先序，分叉处缩进一级，叶子所在分支标 `onCurrentBranch`，分支上最后一条标 `current`；显式栈遍历（长会话的树很深）。studio 按文件顺序（omp 自己的 `/tree` 把当前分支排前）。中间坏行抛错，写到一半的最后一行跳过。
- **回溯后"当前"的空档**：叶子移动不写文件，发新消息之前从文件看不出叶子在哪。`TspRunner` 在回溯成功后记 `LeafOverride{afterEntryId: 回溯时文件最后一个条目, leafId: 那条消息的父条目}`，文件一长出新条目自动失效。不是 studio 发起的回溯（用户在 omp 自己的界面里）看不到。
- **摘要**：面板底部开关"回溯时让 omp 摘要被放弃的分支"（`session-tree-summarize`，默认关，不记忆）；勾上后选中 = `branchTask(id, entry, true)` → `select` + `action summarize`，面板保持打开、标题换成 `tree.summarizing` 直到 omp 写完，成功后关面板；`BranchTaskResult.summarized` 回报。没勾时如果 omp 开着 `branchSummary.enabled` 弹出摘要提示，studio 自动答 No summary（所以分叉出的新任务也不会被提示卡住）。
- **回溯**（`TspRunner.rewindTo`，`#exclusive` 串行）：校验目标是这个会话的用户消息 → `start()` → 要求这一轮已结束（`working`、有对话框、有在跑的工具/子代理都拒绝：`the session is busy; wait for the current turn to finish`，界面 `error.sessionBusy`）→ 清空 omp 输入框 → `send "/tree"` → 等 tree picker，目标不在 `items` 里就 Esc 并报错 → `activate` → 等选择器关闭 → 短暂等预填/toast（等不到不算失败）→ 再清空输入框 → 记 `LeafOverride`。`branchTask`（面板选中）就是它：就地回溯，会话文件不变。
- **分叉**（`TaskPool.forkTask`）：`prepareFork` 校验（这一轮已结束；有会话文件；条目是用户消息，null = 当前分支最后一条用户消息）→ 新增任务记录 `{sessionFile:null, forkFrom:<原会话文件>, 同项目/cwd/worktree/模型/思考强度}` → 第一次启动 `omp --fork=<forkFrom>`（已有 `sessionFile` 时 `--resume` 优先）→ 新文件一落盘，`persistSessionFile` 记 `sessionFile` 并清掉 `forkFrom` → 在新进程里 `rewindTo(条目 id, 已查好的目标)`（目标取自原文件：`--fork` 保留条目 id）。第三个参数 `mode`：面板、用户消息上的分叉、`/fork` 都是 `before-user`，回答上的分叉是 `after-answer`。回溯失败时新任务保留（它是原会话的完整副本），错误照抛，不自动删。原任务全程不动、不需要进程。
  - 标题照抄原任务，不加后缀：侧栏按新会话头的 `parentSession` 把它缩进在原会话下面（issue #9，见 `session-history.md`）。
  - worktree 任务的分叉共用同一个 worktree（omp 会话绑 cwd，分叉必须在同一目录恢复），后果是两个任务改的是同一份工作区；`discardWorktree` 在还有别的任务（**含已归档的**）用它时拒绝（`the worktree is shared with another task`，界面 `error.worktreeShared`）。
- **用户消息的回退图标**：omp 在每张 `omp.user` 卡片的工具行里画了 `icon` 节点（`actions.click:"rewind"`）；studio 接管：`features/tsp/actions.ts` 的 `rewind` 打开面板，并按"这张卡片从末尾数第几张"对位到当前分支上同序的用户消息（从末尾数，因为压缩过的会话 omp 只画压缩点之后的消息）。`rewind` 不发给 omp（omp 自己的全屏回退选择器不出现）。
- **IPC 收窄**：`getSessionTree(taskId)`、`forkTask(taskId, entryId|null, mode)`（`validate.ts` 的 `parseOneOf`）、`branchTask(taskId, entryId, summarize?)` 只作用于已存在的任务；entryId 限长，由主进程对照会话文件校验；渲染进程不传路径。
- **入口**：`/tree`、命令面板「会话树」、用户消息上 omp 的回退图标（对准那条消息）、任务菜单（`task-menu.tsx`；不是当前任务时先选中再打开，面板只画在当前任务上）。`/fork`（`studio-slash-table.ts`）= 从当前分支最后一条用户消息分叉（不是 omp 自己 `/fork` 的"复制整个会话"语义）。
- **界面**：外壳 `ui/Dialog`（`data-testid="session-tree"`）；列表是 listbox，`Enter` / 点击 = 回溯、`Shift+Enter` = 分叉。每行有"从这里分叉"按钮（`session-tree-fork`，任务不空闲时置灰）。分叉成功后关面板、选中新任务、那条消息的文字进它的输入框，失败 toast `tree.forkFailed`。

## 标签、压缩点、分支摘要、搜索和回溯提示（omp 18.12.6）

- **节点种类**：`SessionTreeNode.kind` = `user` / `compaction` / `branch_summary`。`compaction` → 分隔节点（`tokensBefore` 是压缩前 token 数）；`branch_summary` → 摘要节点（`text` = 去掉 omp 固定开头后摘要的第一句，`summaryPreview`）。实测位置：`compacted.jsonl` 的压缩点是叶子，树里是 ALPHA → BETA → 压缩点；`summarized.jsonl` 的摘要条目和 BETA 是兄弟，所以 BETA（别的分支）和摘要（当前分支）缩进一级。只有 `user` 能回溯 / 分叉；`prepareFork(null)` 取当前分支上最后一条**用户消息**（压缩点可能是 `current`）；回退图标的倒数对位（`tree-focus.ts`）也只数用户消息。
- **标签**：会话文件里的 `label` 条目（`{type:"label", targetId, label}`，`label` 为空 / 缺失 = 清除）打在 `targetId` 对应的节点上，显示成节点上的 `Badge`；同一个目标多次打标签，`timestamp` 最晚的算（同时间按遍历顺序）。标签只对列表里的节点显示。
- **打标签（实测，真实 omp 18.12.6，录制 `fixtures/tsp/session-tree-label.jsonl`、会话 `fixtures/omp-session/labeled.jsonl`；2026-10-23）**：`send "/tree"` → `select item=<条目 id>` → `action act="label"`：选择器 `set focus:"preview"`、`actions` 变成 `label-save` / `close`，预览里 `add` 一个 `input` 节点（`sendable:false`）并 `focus` 到它；`edit {from:0,to:0,text,cursor,len}`（`len` = 输入框当前长度，已有标签时整段替换）；`action act="label-save"` → 那一项多出 `badges`，**选择器没有关**，回到树视图；之后要 Esc 关选择器。会话文件末尾追加 `{"type":"label",…,"parentId":<当时的叶子>,"targetId":…,"label":…}`，**不动叶子、不动对话**（`parentId` 是原叶子，所以 `fileLeafId` 沿父链仍落在原分支上）。omp 源码（`tree-selector.ts`）确认：标签输入框收 `edit`；`label` 动作在搜索框有字时无效（studio 不碰 omp 的搜索框）。
- **studio 的做法**（`TspRunner.labelEntry`，`TaskPool.labelTreeEntry`，IPC `labelTreeEntry(taskId, entryId, label|null)`，`#exclusive` 串行）：校验条目可打标签（`isLabellableEntry`）→ `start()` → 要求这一轮已结束 → 清空 omp 输入框 → `send "/tree"` → 等 tree 选择器含该条目且有 `label` 动作（否则 Esc + 报错）→ `select` → `action label` → 等 `input`（`findTreeLabelInput`）→ `edit` 整段替换（文字一致就不发）→ `action label-save` → 等输入框消失 → **无论成败都发 Esc** 关选择器。完成后渲染进程重读会话文件。清除 = 传 null / 空串（omp 源码：`label.trim() || undefined`）。测试：`test/tsp-session-tree.test.ts`（录制逐帧）、`test/task-tsp-tree.test.ts`（假 omp 回放）、`test/session-tree.test.ts`（覆盖 / 清除 / 时间顺序）。
- **搜索**：面板顶部搜索框（`filterTreeNodes`，`shared/session-tree-view.ts`）按消息文字和标签过滤：空白分词、全部词都要出现、不分大小写；不改缩进和当前标记。不用 omp 选择器的搜索（要在 omp 里打字再读回结果，只读会话文件就够了）。
- **回溯提示**（`discardedTurns`）：光标在一条用户消息上时提示"回到它之前，当前对话里有 N 轮会离开"。omp 的回溯把叶子移到目标的父条目，原来的消息仍在文件里成为另一条分支，所以是"离开"不是删除。N = 当前分支上不在目标祖先链里的用户消息数；压缩点、摘要节点不算一轮；N = 0 不提示。
- **界面**：搜索框（`session-tree-search`）里 `↑↓` / `Enter` 照常作用于列表，`Esc` 有字时先清字。`Shift+L` 或行上的标签按钮（`session-tree-label-edit`）让这一行就地变成输入框（`session-tree-label-input`），失败 toast `tree.labelFailed`；任务不空闲时置灰。压缩点行（`data-kind="compaction"`）和摘要行点击无事发生、没有分叉按钮。回溯提示是 `session-tree-discard`（`data-count`）。

## 回答上的分叉（2026-11-09，issue #9，仓库所有者批准）

**实测（omp 18.18.2，真实 omp 经 `TaskPool`、临时 `PI_CODING_AGENT_DIR`，两轮 ALPHA / BETA；一次性探针）**：
- `/tree` 选择器的 `items` 里助手消息是 `node:"assistant"` 的项（`order` 里也有），`current` 是文件最后一个条目（BETA 的回答）。
- `activate item=<ALPHA 的回答>`：选择器关闭，toast `Navigated to selected point`，**omp 的输入框为空（不预填）**；对话重画到只剩 ALPHA 和它的回答。之后发 GAMMA：`parentId` = ALPHA 的回答，即叶子停在那条助手消息本身。

**做法**：回答下方用量行里的分叉按钮 = `forkTask(id, 那一轮的用户消息条目, "after-answer")`。
- 主进程（`TspSessionTree.prepareFork`）：按当前叶子（含 `LeafOverride`）找这条用户消息在当前分支上的回答 = 到下一条用户消息（`attribution:"agent"` 不算）之前最后一条助手消息（`session-tree-file.ts` 的 `findAnswerEntry`）。不在当前分支上、或这一轮没有助手消息时拒绝（`that message has no answer on the current branch`），不建任务。
- 新任务照常 `--fork` 起，再 `TspSessionTree.moveToAnswer`：回答到文件最后一个条目之间只有标记、没有别的消息时（`atFileLeaf`），`--fork` 后叶子已经在它这里，**什么都不发**（再 activate 当前叶子 omp 不动、要超时）；否则 `/tree` → `activate` 那条助手消息 → 等选择器关闭（同回溯的 `#moveLeaf`），再记 `LeafOverride{leafId: 回答}`。返回 `text:""`，新任务的输入框不放东西。
- 渲染进程（`fork-actions.ts` 的 `forkAfterAnswer`）：按钮所在的助手容器后面还有几张用户消息卡片（`answerTurnFromEnd`，从末尾数）→ 会话树当前分支上倒数同序的用户消息（`focusIndexFromEnd`）→ 它的 `entryId`。
- 测试：`test/task-tsp-tree.test.ts`「forkTask after-answer」；假 omp 回放 `fixtures/tsp/session-tree-answer.jsonl`（由 `session-tree.jsonl` 改出）；e2e `test/e2e/session-tree.e2e.ts` 两条"回答下方用量行上的分叉"。

## 用户消息上的"编辑"（2026-11-09，仓库所有者批准）

用户消息悬停按钮行（`omp.user.tools`，`layout.tsx` 的 `UserToolsRow`）里，omp 的复制、回退后面 studio 加了"编辑"（`tsp-user-edit`）和"分叉"（`tsp-user-fork`）。

- **编辑只填输入框，不回溯**（仓库所有者定，2026-11-09：编辑是省得重打，不该删记录）：`fork-actions.ts` 的 `editUserCard` 按卡片取这条消息的原文（`shared/tsp/user-messages.ts` 的 `userCardText`），追加进输入框，焦点给输入框、光标在末尾（`composer/insert-into-draft.ts` 的 `focusDraftEnd`）。不给 omp 发任何事件，对话和会话文件都不变；要回到这条消息之前用会话树（回退图标）。
- 任务在跑时也能点。找不到这条消息的正文时 toast（`reportErrorNow`）。
- 测试：e2e `test/e2e/session-tree.e2e.ts`「编辑：用户消息悬停按钮行里 studio 加的编辑按钮…」。

## 已知限制和没测的

- **回溯不持久**：叶子移动只在 omp 进程内存里。回溯后不发消息就关掉任务/退出应用，下次 `--resume` 回到文件最后一个条目，回溯丢了；分叉出的新任务同理。omp 终端版也是这样。studio 不该写文件让它持久。
- **分叉是整份复制**：新任务的会话文件里还保留着原会话在分叉点之后的消息（成了另一条分支），对话流看不到，面板里能看到。
- 运行中（或有未答对话框、在跑的工具/子代理）的任务不能回溯和分叉；分叉按钮置灰，回溯由主进程拒绝。
- 压缩后 omp 里没有 `omp.user` 卡片的那些消息没有回退图标，只能从面板进。
- 打在助手消息、工具调用等面板不列的条目上的标签（omp 的 `/tree` 里可以给任何条目打）面板不显示，也不能从面板给这些条目打标签。
- 界面没有在真实 Electron 里核对；`test/e2e/session-tree.e2e.ts` 用假 omp 覆盖流程。
