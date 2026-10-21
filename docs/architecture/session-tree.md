# 会话树、分叉、回溯

任务是交互式 omp（TSP）。会话树用 omp 自己的三样东西：会话文件（只读）、`/tree` 选择器（回溯）、`--fork` 启动参数（分叉成新任务）。**studio 从不写会话文件。**

实现：`src/main/tsp/session-tree-file.ts`（会话文件 → 条目 → 树）、`src/main/tasks/session-tree.ts`（`buildSessionTree` 纯函数）、`src/shared/tsp/session-tree.ts`（omp `/tree` 选择器、输入框、用户消息卡片的纯函数）、`tsp-runner.ts` 的"会话树、回溯、分叉"一段（`getSessionTree` / `prepareFork` / `rewindTo`）、`task-pool.ts` 的 `#forkTspTask`；`TaskRecord.forkFrom`；`launch-args.ts` 的 `forkSessionFile`。界面 `src/renderer/src/features/conversation/`（`SessionTreePanel.tsx`、`session-tree-store.ts`、`fork-actions.ts`；`App.tsx` 在 `TspView` 旁挂面板）；`features/tsp/actions.ts` 接管 omp 的 `rewind` 图标。测试：`test/tsp-session-tree.test.ts`（真实会话文件 `fixtures/omp-session/*.jsonl` 和 omp 录的 `fixtures/tsp/session-tree*.jsonl`）、`test/session-tree.test.ts`（`buildSessionTree`）、`test/task-tsp-tree.test.ts`（任务池 + 假 omp）、`test/e2e/session-tree.e2e.ts`。

## 实测（omp 18.12.5，`omp --version` → `omp/18.12.5`，真实 omp、临时 `PI_CODING_AGENT_DIR`、deepseek-v4-flash，两轮对话 ALPHA / BETA；2026-10-21）

**会话文件**（`omp -p` 两次得到，11 行）：第 1 行 `{"type":"title",…,"pad":"<空格>"}`（固定宽度的标题槽），第 2 行 `{"type":"session",id,cwd,…}`；之后每行是带 `id`（8 位十六进制）和 `parentId` 的条目：`model_change`（根，`parentId:null`）、`thinking_level_change`、`message`（user / assistant）、`custom`（`system-prompt-digest`、`session_exit`）。两个文件头都没有 `parentId`，不是树的一部分。omp 追加的每个条目都挂在当时的叶子下面，所以**文件最后一个条目 = 叶子**；omp 里 `/tree` 选择器的 `current` 也是它（`d28e91a6`，最后一行 `session_exit`）。

**`/tree` 在 TSP 里**（录制 `fixtures/tsp/session-tree.jsonl`）：`send "/tree"` → layer 里出现 `picker`（`title:"Session tree"`、`layout:"tree"`、`items[].id` 就是会话条目 id、`items[].node` 是 `user` / `assistant` / `marker`、`depth` 是分叉深度、`order` 是默认过滤下可见的条目、`selected`、`current`（叶子）、`tabs`（Default / No tools / User only / Labeled / All）、`actions`（switch / summarize / label / filter / close））。

**回溯 = 在选择器里 `activate item=<用户消息的条目 id>`**：选择器关闭；叶子移到这条消息的**父条目**；omp 重画对话（只剩到新叶子为止的卡片：两轮会话回溯到 BETA 之前后只剩 ALPHA 一张 `omp.user` 卡片）；omp 自己的输入框（dock 里 `omp.editor` 下的 `editor` 节点）被填成这条消息的文字，出现 toast `Navigated to selected point`。**会话文件一个字节没动**（行数、内容不变），OSC `omp_session_file` 也不变——叶子移动只在 omp 进程内存里。之后发的第一条消息才在文件里长出新分支：它的 `parentId` 是回溯到的位置（实测 `/tree` → BETA → 发 GAMMA：`47b8e31d` 的 `parentId` = `a6b4e493`，和 BETA（`b772c2f5`）同一个父条目，两条分支在同一个文件里；`fixtures/omp-session/branched.jsonl`）。

- 选**助手消息**：叶子移到它本身，输入框不预填（toast 同上）。studio 的面板只列用户消息，不用这个。
- 选**当前叶子**：什么都不发生（选择器留着、没有 toast）。studio 等不到选择器关闭就按 Esc 并报错（`omp did not move to that message`）。
- omp 的预填**只在输入框为空时才写**（omp 文档 `tree.md`）：studio 回溯后把 omp 的输入框清空（`edit` 事件整段替换成空串，实测有效），否则下一次回溯拿不到文字。回溯前输入框非空也先清空。返回给界面的文字取自会话文件里那条消息的全部文本块（换行连起来），不依赖输入框里的内容。
- **摘要提示**（`branchSummary.enabled` 打开时；实测，录制 `fixtures/tsp/session-tree-prompt.jsonl`）：`activate` 用户消息后树选择器被换成另一个 layer picker：`title:"Summarize branch?"`、`layout:"rows"`、items `0` No summary / `1` Summarize / `2` Summarize with custom prompt。`activate item=0` 直接回溯（同上，文件不变）；`activate item=1` omp 调一次模型写摘要（实测约 2 秒），在文件末尾追加一个 `branch_summary` 条目（`parentId` = 新叶子，即被选用户消息的父条目；`summary` 是"User explored another conversation branch, then returned here. …"），再回溯；`activate item=2` 出现 `omp.hook-editor` 覆盖层（"Custom summarization instructions"，`editor` + Open in editor / Cancel / Submit 按钮，`action submit`）；在摘要提示里 Esc = 回到树选择器。studio 不提供自定义指令（只提供下面两种）。
- **直接摘要**（选择器底栏动作 `summarize` = Shift+Enter，实测录制 `session-tree-summarize.jsonl`）：先 `select item=<条目>` 再 `action act="summarize"`，**不管 `branchSummary.enabled` 开没开**都不弹提示直接摘要并回溯，同样追加 `branch_summary`。studio 的"回溯时摘要"就是它。
- **压缩过的会话**（实测：`compaction.keepRecentTokens=5` + `/compact`，文件里追加 `compaction` 条目，`firstKeptEntryId` = 保留的最早条目）：重新 `--resume` 后 omp **只画压缩点之后的内容**（一张压缩分隔 + 保留下来的回答，**没有任何 `omp.user` 卡片**），但 `/tree` 仍列出整份文件的全部条目；`activate` 压缩点**之前**的用户消息（ALPHA）照常成功：toast `Navigated to selected point`、输入框预填、文件不变。录制 `session-tree-compacted.jsonl`，会话 `fixtures/omp-session/compacted.jsonl`。

**`--fork=<会话文件>`**（`omp --help` 18.12.5 **没有列出**这个参数，但 omp 文档 `session-operations-export-share-fork-resume.md` 写了，实测可用）：复制整个会话文件，新 `session` 头（新 `id`、`parentSession` = 原会话 id，其余条目 id 原样保留），建在当前 cwd 对应的会话目录里，omp 启动后就在新文件上；**新文件在启动时就已落盘**，OSC `omp_session_file` 在启动时就报它的路径（所以 `persistSessionFile` 立刻能记下）。原文件不动（逐字节相同）。`--fork` 不能切到某条消息之前：它总是整份复制，叶子是文件最后一个条目；要回到某条消息之前，只能在新进程里再用 `/tree` 回溯。和 `--model` / `--thinking` 一起用没问题。

**端到端复核**（真实 omp，经 `TaskPool`，临时目录）：①`forkTask(源任务, BETA)`：新任务 `--fork=<源会话文件>` 起，回溯后返回 `Reply with exactly: BETA. No tools.`，新会话文件 1 个，原文件不变；新任务的 `sessionFile` 记下新文件、`forkFrom` 清掉；②在新任务里发一句 DELTA：新文件里 DELTA 的 `parentId` = BETA 的父条目（真分叉在新文件里），原文件仍不变；树面板在发送前显示 ALPHA 当前、BETA 在别的分支，发送后 DELTA 当前；③原任务 `branchTask(BETA)`、再 `branchTask(ALPHA)`（第二次回溯同样成功）：文件不变，树里的"当前"跟着移动（回溯到 ALPHA 之前时两条用户消息都不在当前分支上，没有"当前"节点）。

## 设计

- **树**：`getSessionTree` 只读会话文件，不拉起进程（还没有会话文件 = 第一条回复之前，nodes 为空；文件 > 256 MB 拒绝读）。条目 → `{entry, children}` 嵌套（没有父或父不在文件里的当根），再用 `buildSessionTree`：只列用户消息（不含 `attribution:"agent"` 的 omp 注入消息），先序，分叉处缩进一级，叶子所在分支标 `onCurrentBranch`，分支上最后一条标 `current`；显式栈遍历（长会话的树很深）。回溯后发新消息就在同一个文件里长出分支，所以树里真的会出现分叉；omp 自己的 `/tree` 把当前分支排在前面，studio 按文件顺序。中间坏行抛错，写到一半的最后一行跳过。
- **回溯后"当前"的空档**：叶子移动不写文件，面板在你发新消息之前从文件看不出叶子移到了哪。`TspRunner` 在回溯成功后记 `LeafOverride{afterEntryId: 回溯时文件最后一个条目, leafId: 那条消息的父条目}`，文件最后一个条目还是它时叶子按 override 算，文件一长（新条目出现）自动失效。不是 studio 发起的回溯（比如用户在 omp 自己的界面里）看不到。
- **摘要**：面板底部有开关"回溯时让 omp 摘要被放弃的分支"（`session-tree-summarize`，默认关，不记忆）；勾上后 Enter / 点击 = `branchTask(id, entry, true)` → `select` + `action summarize`，面板保持打开、标题换成 `tree.summarizing` 直到 omp 写完（最长 120 秒），成功后关面板；`BranchTaskResult.summarized` 回报。没勾时如果 omp 开着 `branchSummary.enabled` 弹出摘要提示，studio 自动答 No summary（所以分叉出的新任务也不会被提示卡住）。
- **回溯**（`TspRunner.rewindTo`，`#exclusive` 串行）：校验目标是这个会话的用户消息 → `start()` → 要求这一轮已结束（`working`、有对话框、有在跑的工具/子代理都拒绝，错误文字 `the session is busy; wait for the current turn to finish`，界面 `error.sessionBusy`）→ 清空 omp 输入框 → `send "/tree"` → 等 `layout:"tree"` 的 picker，目标不在 `items` 里就 Esc 并报错 → `activate` → 等选择器关闭 → 最多等 1.5 秒预填/toast（等不到不算失败）→ 再清空输入框 → 记 `LeafOverride`。`branchTask`（面板选中）就是它：就地回溯，任务的会话文件不变，原会话文件和进程会话都在。
- **分叉**（`TaskPool.#forkTspTask`）：`prepareFork` 校验（这一轮已结束；有会话文件；条目是用户消息，null = 当前分支最后一条）→ 新增任务记录 `{sessionFile:null, forkFrom:<原会话文件>, 同项目/cwd/worktree/模型}` → 第一次启动 `omp --fork=<forkFrom>`（`buildTspArgs` 的 `forkSessionFile`，已有 `sessionFile` 时 `--resume` 优先）→ 新文件路径一落盘，`persistSessionFile` 记 `sessionFile` 并清掉 `forkFrom` → 在新进程里 `rewindTo(条目 id, 已查好的目标)`（目标取自原文件：`--fork` 保留条目 id，不依赖新文件路径已经报到）。`forkTask` 的第二个参数是**会话条目 id**（面板节点的 `entryId`），null = 最后一条用户消息。回溯失败时新任务保留（它是原会话的完整副本），错误照抛，不自动删。原任务全程不动、不需要进程。新任务同项目、同 cwd、同模型和思考强度（记录里复制），标题照抄原任务；worktree 任务的分叉共用同一个 worktree（omp 会话绑 cwd，分叉必须在同一目录恢复），所以新记录带同样的 `worktreePath/Branch/Base`，后果是两个任务改的是同一份工作区，`discardWorktree` 在还有别的任务（**含已归档的**）用同一个 worktree 时拒绝（`the worktree is shared with another task`，界面 `error.worktreeShared`）。
- **用户消息的回退图标**：omp 在每张 `omp.user` 卡片的工具行里画了 `icon` 节点（`actions.click:"rewind"`、title "Rewind the conversation to an earlier message"）；studio 接管：`features/tsp/actions.ts` 的 `rewind` 打开面板，并按"这张卡片是 main 里从末尾数第几张"对位到当前分支上同序的用户消息（从末尾数，因为压缩过的会话 omp 只画压缩点之后的消息）。不会再把 `rewind` 发给 omp（omp 自己的全屏回退选择器不出现）。
- **IPC 收窄**：`getSessionTree(taskId)`、`forkTask(taskId, entryId|null)`、`branchTask(taskId, entryId, summarize?)` 只作用于已存在的任务；entryId 限长 200，由主进程对照会话文件校验（必须是用户消息）；渲染进程不传路径。
- **界面**：面板（`SessionTreePanel`）键盘：`↑↓ Home End` 移动、`Enter` / 点击选中（回溯）、`Esc` 关闭并还焦点，焦点陷阱在面板内；每行有"从这里分叉"按钮（悬停/选中时出现，`session-tree-fork`；`Shift+Enter` 同效；任务不空闲时置灰），点后面板标题换成 `tree.forking`，成功后关面板并选中新任务、那条消息的文字进它的输入框，失败 toast `tree.forkFailed`。样式只用 token，动画用 `--dur-*`（reduced-motion 下自动退化）。`/tree`、`/fork`（`studio-slash-table.ts`）和命令面板"会话树"打开面板；`/fork` = 从当前分支最后一条用户消息分叉（不是 omp 自己 `/fork` 的"复制整个会话"语义）。

## 已知限制和没测的

- **回溯不持久**：叶子移动只在 omp 进程内存里，文件里直到下一条新消息才有痕迹。回溯后不发消息就关掉任务/退出应用，下次 `--resume` 回到文件最后一个条目（完整历史），回溯丢了；分叉出的新任务同理（没发消息之前，重新打开看到的是原会话的完整副本）。omp 自己的终端版也是这样。studio 没有办法写文件让它持久，也不该写。
- **分叉是整份复制**：新任务的会话文件里还保留着原会话在分叉点之后的消息（成了另一条分支）。omp 的 `--fork` 不能只复制到某个条目；对话流只显示当前分支，所以界面上看不到，面板里能看到那条旧分支。
- 同一个会话文件在原任务和新任务里同时被 omp 追加的情况不会出现（`--fork` 复制成了新文件）。
- 运行中（或有未答对话框、有在跑的工具/子代理）的任务不能回溯和分叉（`the session is busy…`）；面板里分叉按钮在任务不空闲时置灰，选中回溯由主进程拒绝。
- 压缩（compaction）之后，omp 只重画压缩点之后的消息；面板里仍列出更早的用户消息（回溯到压缩点之前已实测可用，见上），回退图标按"从末尾数"对位所以不错位。压缩后 omp 里没有 `omp.user` 卡片的那些消息没有回退图标，只能从面板进。
- 会话文件里的 `label`、`branch_summary`、`compaction` 条目面板不显示（只列用户消息）；`Shift+Enter` 摘要、`Shift+L` 标签是 omp `/tree` 里的功能，studio 面板没有标签。
- 界面（面板、按钮、回退图标）没有在真实 Electron 里截图核对；`test/e2e/session-tree.e2e.ts` 用假 omp 覆盖流程，由集成者运行。
