# 会话树、分叉、回溯

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
