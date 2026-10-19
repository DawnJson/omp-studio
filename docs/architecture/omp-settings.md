# omp 的全部设置（设置页）

实现：`src/main/omp-config/`（`schema.ts` 合并解析、`config-service.ts` 读写）、`src/main/ipc/omp-handlers.ts`（`getOmpConfig`/`setOmpConfig`/`resetOmpConfig`）、`src/renderer/src/features/settings/`（`config-store.ts`、`ConfigRow.tsx`、`ConfigControls.tsx`、`ConfigSection.tsx`、`OmpConfigPane.tsx`）。实测版本 omp 18.12.1（555 项、11 个 tab）。样本输出在 `fixtures/omp-config/`，`test/omp-config.test.ts` 用它。

## 读

- 值：`omp config list --json`，形如 `{ "<key>": { type, description, value?, redacted? } }`。`type` 是 `boolean|enum|number|string|array|record`。没有默认值的可选项（如 `compaction.reserveTokens`）没有 `value`；凭据没有 `value`，`redacted:true` 表示已设置。
- 分组和枚举可选值：`omp config list`（文本）。`[tab]` 行分组（appearance、context、files、interaction、internal、memory、model、providers、shell、tasks、tools），枚举行 `  key = <值> (a|b|c)`，括号里不是类型名就是可选值。值部分可能自带括号（`(not set)`、数组），取**最后**一个括号组。`FORCE_COLOR` 会让 omp 在管道里也输出颜色转义码：解析前先去掉，spawn 时也设 `NO_COLOR=1 FORCE_COLOR=0`（测试时 Playwright 就设了 FORCE_COLOR，第一次跑 e2e 因此读不到分组）。
- schema（tab、类型、描述、可选值、**omp 自己的默认值**）在一个**空的临时 agent 目录 + 干净环境**（只带 PATH、临时目录、用户目录等系统变量）里读，按 omp 版本缓存（内存 + `userData/omp-config-schema.json`）。默认值用来判断"已修改"：当前值和默认值不同就是已修改。要干净环境，是因为带着环境变量读出来的"默认值"会被覆盖（实测 `HINDSIGHT_API_URL` 会让 `hindsight.apiUrl` 的默认值变成它）。残留风险：`~/.omp/.env` 里的覆盖仍会被读到。
- 每次打开设置页静默刷新一次（终端里可能改过）；`ompStatus` 变成 ready 时才读。

## 写

- `omp config set --json <key> -- <value>`、`omp config reset --json <key>`。**`--` 必须有**：不加的话负数（`-1`）被当成选项（实测 `Unknown option '-1'`）。字符串、数字、布尔、枚举按类型转参数；数组/对象传 JSON 文本。
- 主进程只放行 schema 里的 key（渲染进程的字符串不会变成命令行选项），并按类型先检查一遍。omp 拒绝时（退出码 1，stderr 一行 `Error: …`）把原话去掉 `Error: ` 前缀后作为错误透传，界面就地显示，不弹 toast。
- 返回 `{ key, value }`，被别处覆盖时多 `overriddenBy`（环境变量名，或 `project`/`overlay`/`runtime`），空白值回退到环境变量时有 `fallbackEnv`。界面在那一项下面显示"已保存，但实际生效的值来自 …"。实测：`HINDSIGHT_API_URL=… omp config set --json hindsight.apiUrl -- http://y` → `{"key":"hindsight.apiUrl","value":"http://y","overriddenBy":"HINDSIGHT_API_URL"}`。
- **凭据**（omp 标了 `redacted`，或 key 以 token/secret/password/credentials/apikey 结尾）：只显示"已设置/未设置"，值不进渲染进程，不在界面里编辑（`omp config set` 的值走命令行，进程列表里看得到），可以"恢复默认"（清除）。`omp config get` 会明文返回凭据，所以从不用它。
- RPC/RPC-UI 进程监听 config.yml 自动重载，改完不用重启任务（决策 10，没有在本机逐项实测）。

## 界面

- 左侧导航只有一列，不分"omp-studio 的 / omp 的"（仓库所有者 2026-10-19 定；omp 的设置和终端共用，就是 omp-studio 的设置）：通用、模型与账号、工具与权限、上下文与记忆、子代理与规划、对话行为、集成、语音、其他、用量、omp 版本、关于（`SettingsView.tsx` 的 `navOrder`）。omp 的"模型与推理"组并进"模型与账号"页，排在账号和模型下面（`defaultThinkingLevel` 上面已有"默认思考强度"，组里不再重复，`OmpConfigPane` 的 `omit`；搜索照样找得到）；命令面板等定位到 `cfg:models` 时打开这一页。主进程自己改了设置（启动时 `goal.continuationModes` 的默认值）会发 `ompConfigChanged`，打开着的设置页静默重读。分组按用户要做的事分，不照搬 omp 的 tab（那是按终端菜单分的）；分组规则在 `src/shared/ui/config-groups.ts`（`test/config-groups.test.ts`）。rpc-ui 下没有作用的项隐藏（见下节），搜索也不找它们；顶部搜索框按 key、omp 英文描述、中英文标签和说明过滤（多个词要全部命中），`Ctrl F` 聚焦，`Esc` 先清搜索。
- 每项默认一行：标签 + ⓘ（描述、key、"omp 原文"标记都在悬停/聚焦/点击出现的说明里）+ "已修改"标记 + 保存反馈，右边是"恢复默认"和控件。搜索命中的是描述时，才在行下面显示那一句。被覆盖、保存或校验出错时才多一行。
- 控件：boolean 开关；enum 三个及以内且短的用分段，否则下拉；number 文本框（要求是数字）；string 文本框；array/record JSON 编辑器（解析失败、类型不对就地报错，不保存）。文本类停手 700 ms（JSON 1 s）、失焦或 Enter 保存；开关和选择立即保存。
- **`goal.continuationModes` 画成开关「目标自动推进」**（`ConfigControls.tsx`，`ompcfg` 里有标签和说明，所以也在“常用”里）：开 ⇔ 列表里有 `"rpc"`；切换时只增减 `"rpc"`，别的条目保留（`src/shared/ui/goal-continuation.ts`，`test/goal-continuation.test.ts`），写的就是上面那条 `omp config set`，不另存副本、不用 `--config` 覆盖，所以终端里的 omp 看到同一份值，反过来也一样。omp-studio 启动时若发现它没被用户明确设置过，会加上 `"rpc"` 一次（默认允许，细节和“怎么分辨设过”见 `conversation.md` 目标一节）。终端版 omp 只看 `"interactive"`，不受影响。
- 常用项（模型角色、思考、审批/工具、上下文压缩、记忆、子代理 task、retry）有人话标签和中英文说明，在 i18n 的 `ompcfg` 命名空间（`<key>.label` / `<key>.desc`），排在每个 tab 的"常用"组最前面；其余项显示 key 和 omp 原文。tab 名也在 `ompcfg`（`tab.<名>`）。
- 长列表：非"常用"的小组（按 key 第一段）在超过 30 项的 tab 里默认折叠，折叠状态记在模块里。

## 打磨（第三轮）

- 自定义下拉 `Dropdown.tsx` 替换原生 `<select>`：token 样式、portal + fixed 定位（向下放不下就向上）、↑↓/Home/End/Enter/空格/Esc、首字母跳转、选中项打勾；Esc 只关弹层。右侧控件列统一宽度 `--st-control-w`（220px），开关和分段控件除外。
- 设置页没有"返回"按钮（顶栏有后退，Esc 仍然回去）；搜索框在导航列顶部；滚动用共用的 `OverlayScrollbar`；分组标题是正常字体、首字母大写，计数用正常字号的次要色；导航分组名不再大写。
- `modelRoles`、`retry.fallbackChains` 用结构化编辑（`StructuredEditors.tsx`）：角色一行一个、模型用下拉选（来自服务进程的模型列表，列表里没有的值原样保留）、回退链可增删和上下移；值的形状不符时退回 JSON 编辑器。其余 array/record 的 JSON 编辑器等宽、自动高度（`field-sizing: content`，最高 320px）。
- `getDefaultModel()` / `defaultModel` 事件：服务进程 `get_state` 读新任务实际会用的模型和思考强度；改了 modelRoles、defaultThinkingLevel 等之后约 0.7 秒重读并推事件（`src/main/service/default-model.ts`）。

## rpc-ui 下的逐项核对（2026-10-18，omp 18.12.1，555 项）

原则（PLAN 设计原则 7、阶段 2.6）：**omp 有的 omp-studio 也要有**，只隐藏在 rpc-ui 下不起作用的项（终端外观、状态栏、终端里的快捷键和提示）。**认不出的项一律显示**（新版本 omp 的新键落进"其他"），只有确认没用的才进隐藏名单。

### 怎么核对的

1. **差分实测（全量布尔/枚举）**：临时 agent 目录 + `--mode rpc-ui`，对 316 个布尔/枚举项逐个翻一次，比较启动后 rpc-ui 能看到的东西（`get_state`、`get_available_commands`、启动帧类型）是否和基线不同。基线重复两次完全一致（无噪声）。**58 项有变化**，其余 258 项没有。有变化的包括：`steeringMode`/`followUpMode`/`interruptMode`/`defaultThinkingLevel`、`compaction.enabled`、系统提示相关（`includeModelInPrompt`、`personality`、`skillful`、`includeWorkspaceTree`、`inlineToolDescriptors`、`memory.backend`、`autolearn.enabled`、`memories.enabled`、`ttsr.enabled`、`tools.intentTracing`、`tools.xdev`、`secrets.enabled`）、所有工具开关（`bash.enabled`、`todo.enabled`、`glob/grep/find/astGrep/astEdit/debug/launch/speechgen/generate_image/computer/ratchet/checkpoint/archive/github/web_search/ask/security/async/fetch/browser/lsp/eval.*.enabled` 等）、`edit.mode`、`task.*`（`isolation`、`eager`、`batch`、`structured`、`enableEffort`）、`skills.*` 与 `commands.*` 的几个开关（改命令列表）、`dev.autoqa`。前缀是终端专用、却在差分里改变了 `get_state` 的只有 `tui.reactions`（原因没查），所以单独放出来显示（`measuredEffective`），其余 `tui.*` 仍隐藏。
2. **行为实测**（真实模型，临时目录）：`bash.enabled=false` 后模型没有 bash 工具（`tool_execution_start` 一次都没有，true 时有）；`todo.enabled=false` 同样没有 `todo` 工具；`hideThinkingBlock=true` 和 `omitThinking=true` 时 `thinking_start/delta/end` 事件照常到达（所以 `hideThinkingBlock` 只是 TUI 的显示开关，omp-studio 自己决定怎么显示思考；`omitThinking` 的作用是模型侧，保留）；**运行中改 `config.yml` 不会发任何事件，但 `get_state` 马上反映**（`omp config set compaction.enabled false` 后 `autoCompactionEnabled` 变 false），所以改完设置不用重启任务（omp 文档"Live file changes"确认）。`plan.defaultOnStartup` 被忽略见 PLAN 的 plan 模式一项。
3. **文档依据**：启动面没变化的项里，大量是只在一轮对话里才起作用的运行时行为（`retry.*`、`compaction.*` 的阈值、`tools.approvalMode`、`edit.*`、`bash.*`、`read.*`、`lsp.*`、`providers.*`、`tier.*`、温度等采样参数、`advisor.*`、`mnemopi.*`/`hindsight.*` 记忆等），按 `omp://settings.md`、`models.md`、各工具文档判定为有效并保留；这类项没有逐个发真实请求验证。

### 隐藏的项（78 项，只在终端界面里有意义）

| 键（前缀） | 为什么没用 |
|---|---|
| `theme.*`、`symbolPreset`、`colorBlindMode`、`statusLine.*`（含 `leftSegments`/`rightSegments`/`segmentOptions`）、`showHardwareCursor` | TUI 的配色、符号、状态栏、光标；rpc-ui 不渲染（差分实测无变化，描述都是 TUI） |
| `tui.*`（含 `tui.vimMode`、`tui.maxInline*`）、`display.*`、`terminal.*` | 终端渲染、鼠标、超链接、标题栏、进度条、内联图片等 |
| `composer.*` | TUI 输入框的形状、token 速率、被清空草稿的回溯、"预测下一条"灰字；omp-studio 有自己的输入框 |
| `input.*`、`doubleEscapeAction`、`treeFilterMode`、`autocompleteMaxVisible`、`spelling.*`、`emojiAutocomplete`、`paste.*` | TUI 编辑器的键位和自动补全 |
| `startup.*`、`update.channel`、`marketplace.autoUpdate`、`setupVersion`、`autoResume` | 交互式启动时的闪屏、更新检查、引导；rpc-ui 由 omp-studio 自己管会话和更新（`autoResume` 是"续上当前目录最近会话"，omp-studio 总是显式打开会话） |
| `completion.notify`、`error.notify`、`ask.notify`、`recap.*` | 终端通知和"终端空闲后"的回顾 |
| `hideThinkingBlock`、`expandThinkingBlocks` | TUI 里折叠思考块（`hideThinkingBlock` 已实测事件照常到达） |
| `title.icons`、`task.showResolvedModelBadge`、`goal.statusInFooter`、`git.enabled` | TUI 标题图标、子代理徽标、页脚、git 状态栏 |

"未能确认、保留显示"：`power.sleepPrevention`、`loop.*`、`magicKeywords.*`、`stt.*`、`speech.*`、`tts.*`、`live.*`、`collab.*`、`share.*`、`stream.*`。差分实测无变化，但描述不是纯终端界面，可能在 rpc-ui 的某些命令（`live_start`、`/share` 等）里起作用，没有逐个实测，按"认不出的不隐藏"保留。

### 分组结果

| 组 | 项数 | 主要内容 |
|---|---|---|
| 模型与推理 | 100 | 模型角色/预设/提供商开关、思考强度和预算、采样参数、`retry.*`、`providers.*`、`tier.*`、`prewalk.*`、`advisor.*`、图像发送、`auth.*`、订阅重置 |
| 工具与权限 | 112 | `tools.approval*`、各工具开关与参数（bash、edit、read、grep、lsp、eval、python、todo…） |
| 上下文与记忆 | 112 | 压缩（`compaction.*`、`snapcompact.*`）、上下文文件、记忆后端（`memory`、`mnemopi`、`hindsight` 等）、`ttsr.*` |
| 子代理与规划 | 60 | `task.*`、隔离/worktree、`plan.*`、`goal.*`、标题生成、skills、commands、扩展 |
| 对话行为 | 14 | 插话/稍后消息/打断、`ask.*`、`loop.*`、魔法关键词、`power.*` |
| 集成 | 37 | MCP、浏览器、搜索（exa、searxng）、`secrets.*`、扩展处理器 |
| 语音 | 11 | `stt.*`、`tts.*`、`speech.*`、`live.*` |
| 其他 | 31 | `gc.*`、`dev.*`、`commit.*`、`collab.*`、`share.*`、`stream.*`、`telemetry.*` 和以后新增的键 |
