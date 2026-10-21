
# 会话开关菜单与模型预设（S4）

输入框工具行的"会话开关"菜单，加模型选择器里的"预设"一节。界面规格见 `docs/design/spec.md` §4.14（"会话开关菜单与模型预设"）。omp 版本 18.12.5（`omp --version` → `omp/18.12.5`），实测日期 2026-10-21，临时 `PI_CODING_AGENT_DIR`，模型 `deepseek/deepseek-v4-flash`。

## 命令面

| 命令 | 实测（TSP 状态 toast 原文） | studio 发的命令 |
|---|---|---|
| `/skillful` | 不带参数 = **切换**："Skill listing disabled for this session."；`/skillful status` → "Skill listing: on."（rpc-ui：`… on (session override; default from the skillful setting).`） | `/skillful on\|off` |
| `/extended-context` | 不带参数 = 切换："Extended context enabled."；`status` → "Extended context is off." | `/extended-context on\|off`（omp 文档 settings.md:746、models.md:99 写明 `on` / `off` / `status`） |
| `/computer` | 切换："Computer use enabled for this session. Computer use: enabled · prelude: active · configured: display=active, …"；`status` → "Computer use: disabled · prelude: inactive · configured: …" | `/computer on\|off`（computer-use.md:31） |
| `/advisor` | 切换："Advisor enabled."；`/advisor status` 在 TSP 里开弹窗（所以只用开关命令自己的 toast） | `/advisor on\|off`（advisor-watchdog.md:104-105） |
| `/browser` | "Browser mode: visible"；`/browser status` → "Usage: /browser [headless\|visible]"（不是状态查询） | `/browser visible\|headless` |
| `/prewalk` | "prewalk: Prewalk: target … already matches the active model and thinking level; nothing to switch."；`/prewalk status` → "Usage: /prewalk [restart\|off]" | `/prewalk`（arm）、`/prewalk restart`、`/prewalk off` |
| `/fast` `/slow` | 已有（`setFastMode` / `setSlowMode`）；不支持的模型：`/fast` → "priority: The current model has no service-tier control for /fast to toggle."、`/slow` → "The current model has no slow mode: …" | 菜单里的快捷入口走现有 `setTaskFastMode` / `setTaskSlowMode` |
| `/modelpreset` | 无预设时 "No model presets saved. Use /modelpreset save <name> to create one." | `/modelpreset save\|switch\|delete <名字>` |

**没有实测、按 omp 文档/对称措辞推断的**：各开关"关"那一半的措辞（"Skill listing enabled for this session."、"Computer use disabled …"、"Extended context disabled."、"Advisor disabled." 等）、`/browser headless` 的 toast（"Browser mode: headless"）、`/prewalk restart|off` 的 toast、`/modelpreset save|switch|delete` 的结果文字。解析器 `parseToggleToast` 的动词表同时接受 `enabled|disabled|on|off`，所以措辞小改也能认；认不出的文字返回 null，界面把 omp 的原文弹成 toast，不吞。`fixtures/tsp/status-toggles.jsonl` 里只有 `Browser mode: headless` 是推断的，其余 toast 原文都来自 `tsp-slash-overlays` / `tsp-status-subcommands` 的实录；`send` 的文字改成了显式的 `on/off` 形式（录制里是不带参数的切换），帧结构（`add u` / 之后 `set u` 原地换文字）照录制。

**`/modelpreset switch` 不是只对本会话生效**（omp models.md "Model presets"）：它像模型选择器一样把预设里各角色的模型写进配置（`modelRoleStorage` 决定写全局还是项目），预设的 `defaultThinkingLevel` 写全局配置，再把当前会话切到预设的 `default` 模型；预设的 `default` 模型不可用时什么都不改。`save` 只写全局配置里那一项。所以预设一节应用后会重读配置快照并关闭选择器，提示文字写明会写配置。

## 数据流

```
omp（任务进程）──状态 toast──▶ TspRunner.#syncToggles ──parseToggleToast──▶ TaskState.sessionToggles ──▶ SessionTogglesMenu
                                       ▲（每次文档变化，读 statusNotes + toast 节点）
菜单 / 斜杠命令 ──runTaskCommand(TaskCommand)──▶ 主进程拼 `/命令` 文本 ──▶ TspRunner.runSessionCommand（send 事件）
```

- 状态来源只有 omp 的 toast：用户在输入框里自己敲 `/skillful` 也会同步。两条读取路径：`DocSurface.statusNotes`（toast 在 main 里 `add` 的那一帧记下来，只增不减，见 `docs/architecture/tsp-migration.md` 状态行一节）和仍在文档里的 `omp.toast.status` 节点（`freshToasts` 取新出现 / 同位置换了文字的；实测 `tsp-status-subcommands` 里 omp 复用同一个节点 `set` 换文字，`statusNotes` 只记 `add`，所以两条都要读）。两条路径重复读到同一句没有副作用（合并是幂等的）。
- `TaskState.sessionToggles`：`{skillful, extendedContext, computer, advisor, browser, prewalk}`，`null` = 本会话没动过。新进程（任务重启）清零。`/slow` 的状态顺便在同一处记进 `#slowEnabled`（用户自己敲 `/slow on` 也同步）；`/fast` 的状态本来就从输入框卡片读（`composer-state`），不在这里。
- 初始值 = 配置默认值：渲染进程用设置页同一份快照（`omp config list --json`）的 `skillful`、`extendedContext`、`computer.enabled`、`advisor.enabled`、`browser.headless`、`prewalk.enabled` 补"没动过"的开关（`toggleDefaults` / `toggleView`），和默认不同时画圆点。读不到快照时按关显示、不画圆点。不在主进程里再起一个 `omp config list`：快照已经是现成的、设置页刷新时跟着更新。
- rpc 任务：`sessionToggles` 恒为全 null（rpc 引擎下一轮删除，不为它再做一套状态读取）；命令仍能执行（S0 的 rpc `runSessionCommand`），菜单按配置默认值显示。
- `/computer on`（菜单里或斜杠）必须先确认（仓库所有者决定 2026-10-21）：确认页在菜单里就地换出，取消不发命令。

## 代码

- `src/shared/omp-output/toggles.ts`：`parseToggleToast`、`applyToggleObservation`、`freshToasts`、`toggleDefaults`、`toggleView`、`listModelPresets`、`presetNameUsable`（新名字，`/modelpreset save`）、`presetRefUsable`（已有名字，switch / delete）。纯函数，`test/session-toggles.test.ts`（全部实录原文 + 状态 toast 回放）。
- **`/modelpreset` 名字（omp 18.12.5 实测，临时 agent 目录 + rpc 模式）**：命令把参数按空白切开、再用单个空格拼回名字，所以 `/modelpreset switch my preset` 成功（`Switched to preset "my preset" (openai/gpt-5.2 · high)`），名字里的连续空格找不到（`switch dbl  sp` → `Preset not found: dbl sp`）；`save` 另外校验 `^[a-zA-Z][\w-]*$`，`delete` 与 `switch` 一样不校验。所以 switch / delete 接受“单个空格隔开的词”，save 只收规范名字。
- `src/shared/omp-output/index.ts`（S0）：`TaskCommand` 的 `toggle` / `browserMode` / `prewalk` / `modelPreset` 成员和文本映射。
- `src/main/tasks/tsp-runner.ts`：`#syncToggles`、`#toggles`；`test/task-tsp.test.ts` "会话开关"用 fake-tsp-omp 回放 `fixtures/tsp/status-toggles.jsonl`，经 `pool.runTaskCommand` 断言 `TaskState.sessionToggles` 逐项更新。
- `src/renderer/src/features/session-toggles/`：`SessionTogglesMenu`（Composer 工具行挂载点）、`ToggleRow`、`PresetSection`（ModelPicker 里）、`toggle-slash.ts`（斜杠参数判定，纯函数，`test/toggle-slash.test.ts`）、`toggle-actions.ts`、`toggle-bus.ts`（斜杠命令请求打开菜单）、`toggles-slash.ts`（命令表里的七行）。
- e2e：`test/e2e/session-toggles.e2e.ts`（fake-tsp-omp 回放；`getOmpConfig` 在主进程里被替换成固定的配置默认值）。
