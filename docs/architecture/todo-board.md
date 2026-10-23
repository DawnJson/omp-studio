# 待办板、上下文压缩、作业计数、Shell 标签（B1Board）

> 实测 omp **18.12.6**，2026-10-23；临时 `PI_CODING_AGENT_DIR`，模型 deepseek-v4-flash，PATH 上的 omp.exe。录制在 `fixtures/tsp/`：`todo-commands.jsonl`、`handoff-ok.jsonl`、`handoff-error.jsonl`、`jobs-bash-18126.jsonl`（路径已脱敏）。

## `/todo` 子命令（真实反馈）

| 命令 | 成功 | 失败 |
|---|---|---|
| `/todo` | toast = Markdown 清单；没有待办 `No todos. Use /todo append <task> to start one.` | — |
| `/todo append Alpha write tests` | `Appended to Alpha: Write tests`（首字母大写，阶段不存在就新建） | 无参数：`Error: Usage: /todo append [<phase>] <task...>` |
| `/todo start write` | `Started: Write tests`（模糊匹配） | `Error: No task matched "zzz". …`；无参数 `Error: Usage: /todo start <task>` |
| `/todo done` / `drop` / `rm` | `Marked all tasks completed.` / `Marked abandoned: X` / `Removed: X` / `Removed phase: Beta` / `Cleared all todos.` | 未匹配 `Error: No task or phase matched …` |
| `/todo copy` | `Copied todos as Markdown to clipboard.`（**写 omp 所在机器的剪贴板**，studio 本地拼） | |
| `/todo expand` / `collapse` | 无反馈，HUD 无变化 | |
| `/todo bogus` | — | `Error: Unknown /todo verb "bogus".` + 用法清单 |

- 成功是 `omp.toast.status`，失败是 main 里新增的 `Error: ` 文字行（无 toast）：`shared/tsp/error-lines.ts`，`TspRunner.runTodoCommand` 二者择一。
- `append` 按空白切词（`"…"` 内不切，`\` 转义）：只有一个词时是任务，多词时第一个词是阶段。所以 TaskCommand 把阶段和任务都加引号。
- 全部做完 / 放弃后 HUD 阶段带 `collapsed:true`，条目状态 `done` / `dropped`；阶段标题在出现第二个阶段后才带罗马数字。
- 备注：HUD 条目 `note` = `blocker ?? notes.at(-1)`（读源码）；18.12.6 的 todo 工具和 `/todo` 都不写 notes，没录到带备注的真实帧，单测用真实帧形状 + 补 `note`。
- 重名条目只能操作第一个（命令按内容匹配）；没有待办时板不出现，也就没有"添加条目"入口。

## `/handoff` 与自动压缩

- 成功：dock loader `Generating handoff… (esc to cancel)`；main 新增 `omp.compaction` 分隔（头 `Handed-off · 13K → 9.8K tokens`）、toast `Session compacted 1 time`、文字 `Context handed off and compacted in place`。判定与 `/compact` 相同（`compaction.ts`）。
- 失败：`Error: Handoff failed: Nothing to hand off (already compacted)`——会话没超过 `compaction.keepRecentTokens`（默认 20000）就是这个；实测把它调到 300 才交接成功。之后 `/compact` → `Error: Compaction failed: Already compacted`。
- 自动压缩阈值：输入框卡片上 `omp.composer.context` 的 `marks`（`context.compaction` 的 `at`、预生成 `context.speculation` 的 `at`），是 omp 算好的生效值（含项目配置、按模型阈值）。键名 `compaction.thresholdPercent/thresholdTokens/modelThresholds/reserveTokens/enabled`；任务里不自己再算，草稿页仍用 `compaction-trigger.ts`。
- 摘要状态：标题多一行 `Compaction summary in progress` / `ready`（读源码，**未在真机触发**）；没有就不显示。

## 作业

`/jobs` 弹窗行 `Running · bash · bg_1`（18.12.6 实测）。类型 bash / eval / task；id 有 `agent` 节点的是子代理（`agent`），药丸不计。hud 里 bash 与 eval 的 id 都是 `bg_N`，只能靠弹窗区分（eval 未录到真实帧）。

## 输入框前缀

`!`/`!!`（bash）、`$`/`$$`（Python，后面必须是空白，单 `$` 后像 shell 命令的不算）：`shared/ui/shell-prefix.ts`，照 18.12.6 input-controller。
