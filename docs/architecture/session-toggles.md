# 会话开关菜单与模型预设（S4）

输入框工具行的"会话开关"菜单，加模型选择器里的"预设"一节。界面规格见 spec §4.14（"会话开关菜单与模型预设"）。实测 omp 18.12.5（2026-10-21，临时 `PI_CODING_AGENT_DIR`，`deepseek/deepseek-v4-flash`）。

## 命令面

| 命令 | 实测（TSP 状态 toast 原文） | studio 发的命令 |
|---|---|---|
| `/skillful` | 不带参数 = **切换**："Skill listing disabled for this session."；`/skillful status` → "Skill listing: on." | `/skillful on\|off` |
| `/extended-context` | 切换："Extended context enabled."；`status` → "Extended context is off." | `/extended-context on\|off`（omp settings.md、models.md） |
| `/computer` | 切换："Computer use enabled for this session. Computer use: enabled · prelude: active · …"；`status` → "Computer use: disabled · …" | `/computer on\|off`（computer-use.md） |
| `/advisor` | 切换："Advisor enabled."；`/advisor status` 在 TSP 里开弹窗，所以只用开关命令自己的 toast | `/advisor on\|off`（advisor-watchdog.md） |
| `/browser` | "Browser mode: visible"；`/browser status` → usage 文字（不是状态查询） | `/browser visible\|headless` |
| `/prewalk` | "prewalk: Prewalk: target … already matches …; nothing to switch."；`/prewalk status` → usage 文字 | 在模型选择器的 Prewalk 一行：`/prewalk`（arm）、`/prewalk restart`、`/prewalk off` |
| `/fast` `/slow` | 不支持的模型：`/fast` → "…no service-tier control…"、`/slow` → "The current model has no slow mode: …" | 只在模型选择器里（`SpeedToggle`，`setTaskFastMode` / `setTaskSlowMode`），不在会话开关菜单 |
| `/modelpreset` | 无预设时 "No model presets saved. …" | `/modelpreset save\|switch\|delete <名字>` |

**没有实测、按 omp 文档 / 对称措辞推断的**：各开关"关"那一半的措辞、`/browser headless` 的 toast、`/prewalk restart|off` 的 toast、`/modelpreset save|switch|delete` 的结果文字。所以 `parseToggleToast` 的动词表同时接受 `enabled|disabled|on|off`，措辞小改也能认；认不出返回 null，界面把 omp 原文弹成 toast，不吞。`fixtures/tsp/status-toggles.jsonl` 里只有 `Browser mode: headless` 是推断的，其余 toast 原文来自 `tsp-slash-overlays` / `tsp-status-subcommands` 实录；`send` 的文字改成了显式 `on/off`（录制里是不带参数的切换），帧结构照录制。

**`/modelpreset switch` 不是只对本会话生效**（omp models.md "Model presets"）：它像模型选择器一样把预设各角色的模型写进配置（`modelRoleStorage` 决定全局还是项目），`defaultThinkingLevel` 写全局配置，再把当前会话切到预设的 `default` 模型；`default` 模型不可用时什么都不改。`save` 只写全局配置里那一项。所以预设应用后重读配置快照并关闭选择器，提示文字写明会写配置。

## 数据流

```
omp（任务进程）──状态 toast──▶ TspRunner.#syncToggles ──parseToggleToast──▶ TaskState.sessionToggles ──▶ SessionTogglesMenu
                                       ▲（每次文档变化，读 statusNotes + toast 节点）
菜单 / 斜杠命令 ──runTaskCommand(TaskCommand)──▶ 主进程拼 `/命令` 文本 ──▶ TspRunner.runSessionCommand（send 事件）
```

- 状态来源只有 omp 的 toast：用户自己敲 `/skillful` 也会同步。两条读取路径都要读：`DocSurface.statusNotes`（只记 toast `add` 的那一帧，见 `tsp-migration.md` 状态行一节）和仍在文档里的 `omp.toast.status` 节点（`freshToasts`；实测 omp 会复用同一个节点 `set` 换文字，`statusNotes` 看不到）。重复读到同一句没有副作用（合并幂等）。
- `TaskState.sessionToggles`：`{skillful, extendedContext, computer, advisor, browser, prewalk}`，`null` = 本会话没动过。新进程（任务重启、重开会话）清零。
- **哪些开关写 omp 配置**（omp 18.12.6 实测）：`/extended-context on` 往 agent 目录 `config.yml` 写 `extendedContext: true`，`/browser headless` 写 `browser.headless: true`；`/skillful`、`/computer`、`/advisor` 不写配置，重开会话后回到配置默认值（对话上下文还在）。所以界面上这两项不标"本会话"、改完重读配置快照（`SAVED_TO_CONFIG`，`shared/omp-output/toggles.ts`），说明写"写进 omp 配置"。`/slow` 的状态顺便在同一处记进 `#slowEnabled`（用户自己敲也同步）；`/fast` 的状态从输入框卡片读（`composer-state`）。
- 初始值 = 配置默认值：渲染进程用设置页同一份快照（`omp config list --json`）的 `skillful`、`extendedContext`、`computer.enabled`、`advisor.enabled`、`browser.headless`、`prewalk.enabled` 补"没动过"的开关（`toggleDefaults` / `toggleView`），和默认不同时画圆点；读不到快照时按关显示、不画圆点。不在主进程再起一个 `omp config list`：快照现成、设置页刷新时跟着更新。
- `/computer on`（菜单或斜杠）必须先确认（仓库所有者定，2026-10-21）：确认页在菜单里就地换出，取消不发命令。

## 代码

- `src/shared/omp-output/toggles.ts`：`parseToggleToast`、`applyToggleObservation`、`freshToasts`、`toggleDefaults`、`toggleView`、`listModelPresets`、`presetNameUsable`（新名字，save）、`presetRefUsable`（已有名字，switch / delete）。纯函数，`test/session-toggles.test.ts`（全部实录原文 + 状态 toast 回放）。
- **`/modelpreset` 名字（omp 18.12.5 实测）**：命令把参数按空白切开、再用单个空格拼回名字，所以 `switch my preset` 成功，名字里的连续空格找不到；`save` 另外校验 `^[a-zA-Z][\w-]*$`，`delete` 同 `switch` 不校验。所以 switch / delete 接受"单个空格隔开的词"，save 只收规范名字。
- `src/shared/omp-output/index.ts`：`TaskCommand` 的 `toggle` / `browserMode` / `prewalk` / `modelPreset` 成员和文本映射。
- `src/main/tasks/tsp-composer-observer.ts`：`#syncToggles`、`#toggles`；`test/task-tsp.test.ts` "会话开关"用 fake-tsp-omp 回放 `fixtures/tsp/status-toggles.jsonl`。
- `src/renderer/src/features/session-toggles/`：`SessionTogglesMenu`、`ToggleRow`、`PresetSection`（ModelPicker 里）、`toggle-slash.ts`（斜杠参数判定，`test/toggle-slash.test.ts`）、`toggle-actions.ts`、`toggle-bus.ts`（斜杠命令请求打开菜单）、`toggles-slash.ts`（命令表里的行）。
- e2e：`test/e2e/session-toggles.e2e.ts`（fake-tsp-omp 回放；`getOmpConfig` 在主进程里被替换成固定的配置默认值）。
- 界面控件：会话开关浮层用 `ui/Switch` / `ui/Segmented` / `ui/Badge`（"本会话"，testid `toggle-<name>-session`）；"电脑操作"确认是 `Popover kind="confirm"`。模型选择器里 Prewalk 一行是三个按钮（启用 / 重来 / 停用：不写"关闭"，免得和对话框"关闭"同字不同义），预设是 `ui/Select`（选一项即应用，testid `model-preset-select`；命名保存时换成 `ui/TextField` + 取消 / 保存）。
