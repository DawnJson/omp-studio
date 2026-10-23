# 输入框：斜杠菜单、参数接管、发送方式、输入历史、omp 输入框回填

> 实测 omp **18.12.6**，2026-10-23（`PI_TUI_TSP_RECORD`，临时 `PI_CODING_AGENT_DIR`，`deepseek/deepseek-v4-flash`）。录制：`fixtures/tsp/history-select.jsonl`、`queue-follow-up-esc.jsonl`、`queue-command.jsonl`。`queue-follow-up-esc.jsonl` 里没录下 Esc 键，第 307 行的 `k` 条目是事后补的，放在 omp 中断这一轮、把排队文字写回输入框的那一帧（第 308 行）之前，这样回放时假 omp 收到 Esc 才放这一帧。

## 1. 斜杠菜单的命令表

- 来源：任务目录（`TspRunner.cwd`，含 `/move`、worktree）里的项目 rpc-ui（`main/service/project-omp-instance.ts` 的 `ProjectOmpPool`）的 `get_available_commands`；项目 skill、自定义命令、扩展命令都在里面。草稿页（没有目录）仍用服务进程。
- 推送：池里的进程在 `spawn` 之后同步挂 `onFrame`（`IdleOmp.onSpawn`，不漏握手期间的帧），收到 `available_commands_update` 就按目录找任务，发 `slashCommands` 事件；渲染进程整份替换。用户敲 `/` 时再主动取一次（`refreshSlashCommands`），项目里新建的命令不用重启。
- TUI 才有的命令：TSP 任务跑的是 TUI，`/plan` `/vibe` `/loop` `/queue` 等能用，但 rpc-ui 列表只含有 `handle` 的内置命令。`src/shared/omp-tui-commands.ts` 是从 omp 18.12.6 `slash-commands/builtin-*.ts`（只有 `handleTui`、没有 `handle`）整理的表，渲染进程的 `slash-commands.ts` 发布列表时合并（`mergeTuiCommands`）。omp 升级后要重新对一遍。
- 守卫（`slash-guard.ts`）：只有这张合并表和 studio 接管的命令里都没有的才提示"没有这个命令"；原来的 `terminalOnly` 表和 `slash.terminalOnly` 文案已删。
- 菜单里隐藏会结束或重启 omp 进程的命令（`MENU_HIDDEN_COMMANDS`：`exit`、`quit`/`q`、`restart`；依据 omp 18.12.6 `builtin-control.ts` 的 `quit`/`exit`、`builtin-lifecycle.ts` 的 `restart`，描述分别是 Quit / Exit the application、Restart omp with the same launch flags）。只过滤菜单（`slash-match.ts` 的 `matchSlash`）；守卫仍认得它们，手敲照常原样发给 omp。`/new` `/delete` 由 studio 接管，`/clear` 只清上下文，不在此列。

## 2. 按参数接管（`composer/slash-args.ts`）

| 命令 | 规则 |
|---|---|
| `/model` | 无参数开选择器；`@角色` 开选择器的角色范围；词用选择器同一个 `groupModels` 匹配：唯一（或 id / `provider/id` 全等的唯一一个）直接切换，多个开选择器并填好搜索词，没有交给 omp；`:档位` 后缀同时设思考强度 |
| `/effort` | 档位在 `TaskState.thinkingLevels` 里直接设置，否则交给 omp |
| `/todo` | `start/done/drop/rm/append` 走 `TaskCommand { kind: "todo" }`（返回 omp 的 toast 文字）；无参数开待办板；其余子命令交给 omp |
| `/settings 词` | 打开设置并搜索；`/usage` `/hotkeys` 打开界面（设置页搜索只覆盖 omp 配置项，快捷键页不支持搜索词，参数忽略） |

`run` 返回 `"omp"` = 原文照常发给 omp（`sendDraft` 里 studio 分支落空后走普通发送）。

## 3. 运行中的发送方式

发送键右边的下拉（`SendStop.tsx`）："插话"（`send`，运行中 omp 把它放进队列，条目标题 `Steering`）/"等这一轮结束再发" = `/queue <文字>`（`shared/tsp/queue-command.ts`，只在运行中且文字不是 `/` `!` `$` 开头时由 `TspRunner.sendPrompt` 套上）。实测：

- omp 弹 toast `Queued message for when the agent yields`，队列条目标题 `After yield`；这一轮结束后作为一条用户消息发出，多行文字保留（单条）。
- 文字像编号清单（`1. a` / `2. b`）时 omp 拆成多条；空 `/queue` 报 `Usage: /queue <message> (or start a prompt with -> / =>)`。
- 设置里"运行中按 Enter"选"稍后"时，Enter 现在是真正的 follow-up（以前 TSP 下 `whenBusy` 没有任何作用）。
- 图片 / 文件的 `@"路径"` 提及放在 `/queue` 的文字里：是否被 omp 展开**没有实测**。

## 4. 输入历史

studio 自己持久化（`userData/input-history.json`，按项目，每项目 200 条，单条 ≤ 20000 字，只存文字；`main/tasks/input-history-store.ts`，IPC `getInputHistory` / `recordInputHistory`）。↑ 翻看和 Ctrl+R 浮层（`HistorySearch.tsx`：↑↓ 选、Enter 填入、Esc 关，多词不分大小写搜索）共用 `mergeEntries(会话里的用户消息, 项目历史)`。Ctrl+R 在 studio 输入框里归 studio（React 的 keydown 先 `preventDefault`，`use-forward-omp-keys` 看 `defaultPrevented` 不转发）；焦点在过程区时仍转发给 omp，omp 自己的 `History` 选择器照常。

## 5. omp 输入框回填（通用规则）

studio 的 `send` 从不往 omp 的输入框填字（录制 `queue-command` 里整段对话输入框始终为空），所以那里出现的任何文字都是 omp 自己放的：Ctrl+R 选中的历史（`history-select`：选择器关闭时整张 `omp.editor` 卡重新 `add`，带着文字）、Esc 中断时退回的排队消息（`queue-follow-up-esc`，`/queue` 条目也一样）、⌥↑ 取回、回溯预填、`/annotate`、`/plan`。`TspRunner.#syncEditorText` 看到非空文字就 `#takeEditorText`（读出来、发 `edit` 清空、等确认）并发 `composerPrefill` 事件，渲染进程 `appendToDraft`。Esc 取回排队消息和 `#exclusive` 里的界面操作（回溯）自己读自己清，期间 `#editorClaims > 0`，通用规则让开，结束后再检查一次。原来渲染进程里的 `restore-dequeued` / `dequeue-restore` 已删。
