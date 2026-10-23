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

- 导航只有一列（3.2 起占侧栏的位置：进设置时 App.tsx 在侧栏位置渲染 `SettingsNav`，顶上 `‹ 返回任务 Esc`、搜索全部设置、9 节；窗口窄到侧栏变抽屉、或侧栏被收起时，导航改成内容顶上的一个节下拉 + 搜索框 `SettingsCompactNav`；当前节和搜索词在 `ui-store` 的 `settingsPage` / `settingsQuery`，内容从 x≈281 开始、最宽 880 左对齐），不分"omp-studio 的 / omp 的"（仓库所有者 2026-10-19 定；omp 的设置和终端共用，就是 omp-studio 的设置）：通用、模型、Provider 与订阅、工具与权限、Context 与记忆、Subagent 与规划、集成与插件（`extensions`，2026-10-23 由原来的集成、插件两节合并，旧节名不留别名）、高级、关于，9 节固定（`SettingsNav.tsx` 的 `settingsPages`；2026-10-22 仓库所有者定，原来按 omp 分组自动出节，共 13 节）。**各节只放常用项**——有人话标签的键（`ompcfg` 字典里有 `<key>.label` 的，`config-meta.ts` 的 `commonItems`，按字典顺序），和管理卡片同页：模型 = 默认模型 / 思考强度 + "模型与 reasoning"组的常用项（`defaultThinkingLevel` 上面已有控件，不再重复一行，`useCommonConfigItems` 的 `omit`）；通用的"任务运行中"卡 = studio 的 Enter 行为 + "对话行为"组的常用项；工具与权限、Context 与记忆、Subagent 与规划 = 各自组的常用项。**其余全部在"高级"**（`AdvancedConfig`）：每个 omp-studio 分组一个小标题，组内按 key 第一段折叠成小组（`prefixGroups`，只有一项的前缀并进末尾的"其他"），默认收起；常用项不在高级里重复。搜索覆盖全部可见项。主进程自己改了设置（启动时 `goal.continuationModes` 的默认值）会发 `ompConfigChanged`，打开着的设置页静默重读。分组按用户要做的事分，不照搬 omp 的 tab（那是按终端菜单分的）；分组规则在 `src/shared/ui/config-groups.ts`（`test/config-groups.test.ts`）。rpc-ui 下没有作用的项隐藏（见下节），搜索也不找它们；顶部搜索框按 key、omp 英文描述、中英文标签和说明过滤（多个词要全部命中），`Ctrl F` 聚焦，`Esc` 先清搜索。
- 每项是一个 `ui/Row`（最小 40 高，标签列 200，控件一律 sm 28）：标签 + ⓘ（描述、key、"omp 原文"标记都在悬停/聚焦/点击出现的说明里，紧贴标签文字），控件后面是保存反馈、被覆盖的徽标；改过的值（和 omp 默认不同）左侧一道强调色竖线 + 控件后一个"恢复默认"图标（悬停提示写出默认值）。搜索命中的是描述时，才在控件下面显示那一句。保存或校验出错时才多一行。没有人话标签的项显示 key（等宽、不截断）。
- 控件（`ConfigControls.tsx`，两种语言一致、只看个数不看宽度）：boolean → 开关；enum ≤4 个值 → 分段，更多 → 下拉（有人话标签的常用项显示翻译后的取值，其余原样显示 omp 的取值并用等宽字）；number → 112 宽数字框，单位从 key 末段后缀推（`Ms` → ms、`Seconds` → 秒 / s、`Percent` → %），标签里不再写单位；omp 说明里写了 -1 / 0 含义的四个键（`compaction.thresholdPercent`、`compaction.thresholdTokens`、`task.maxRuntimeMs`、`retry.maxDelayMs`，`config-meta.ts` 的 `numberSpecials`）在框里显示成占位文字（`ompcfg` 的 `<key>.special`），清空输入 = 存回特殊值，没有说明的键照原值；string → 文本框；字符串数组 → 标签输入（`TagInput.tsx`，增删立即存）；对象和其余 JSON → "编辑…"按钮 + 等宽摘要，点开 `ui/Dialog` 里编辑并校验（解析失败、类型不对就地报错、不能保存）。文本和数字停手 700 ms、失焦或 Enter 保存；开关、选择、标签增删立即保存。
- **`goal.continuationModes` 画成开关「目标自动推进」**（`ConfigControls.tsx`，`ompcfg` 里有标签和说明，所以也在“常用”里）：开 ⇔ 列表里有 `"rpc"`；切换时只增减 `"rpc"`，别的条目保留（`src/shared/ui/goal-continuation.ts`，`test/goal-continuation.test.ts`），写的就是上面那条 `omp config set`，不另存副本、不用 `--config` 覆盖，所以终端里的 omp 看到同一份值，反过来也一样。omp-studio 启动时若发现它没被用户明确设置过，会加上 `"rpc"` 一次（默认允许，细节和“怎么分辨设过”见 `conversation.md` 目标一节）。终端版 omp 只看 `"interactive"`，不受影响。
- **`startup.setupWizard` 启动时默认关掉**：空 agent 目录里 omp 的 5 步首次运行引导会占满第一个 TSP 任务（`tsp-real-omp-probes.md` §1）。omp-studio 启动时若 config.yml 里没有这个键（嵌套或平铺都算；读不了、解析不了按设过处理），就经 `omp config set startup.setupWizard false` 设一次并发 `ompConfigChanged`（`omp-config/setup-wizard-default.ts`，`test/setup-wizard-default.test.ts`；仓库所有者 2026-10-21 批准）。设过的（包括明确设成 true）不碰，设置页照常能改。和 goal 的默认依次执行，TSP 任务的 omp 进程启动前等它们（`omp-config/startup-defaults.ts`）。
- 常用项（模型角色、思考、审批/工具、上下文压缩、记忆、子代理 task、retry）有人话标签和中英文说明，在 i18n 的 `ompcfg` 命名空间（`<key>.label` / `<key>.desc`），排在每个 tab 的"常用"组最前面；其余项显示 key 和 omp 原文。tab 名也在 `ompcfg`（`tab.<名>`）。
- 高级（`ConfigSection.tsx` 的 `AdvancedConfig`）：页内左侧目录 = 8 个分组 + 当前分组下的前缀小组（带个数），右侧是选中分组的行，全部平铺、没有折叠；前缀做小标题（`服务商 providers.*  20 项 · 1 项改过`），行里的 key 去掉前缀；选中的分组记在模块里。搜索在导航顶上，覆盖全部设置。

## 打磨（第三轮）

- 下拉用 `ui/Select`（portal + fixed 定位、↑↓/Home/End/Enter/空格/Esc、首字母跳转、当前项 ✓、Esc 只关弹层）；旧的 `settings/Dropdown.tsx`、`InfoTip.tsx`、`controls.tsx` 已被 `ui/` 取代。
- 导航顶上有"返回任务"（Esc 也回去，Ctrl+F 聚焦搜索）；滚动用共用的 `OverlayScrollbar`；页头右侧有一个槽（`PageHeadActions.tsx`），各节用它放范围下拉、"连接提供商…"这类 sm 控件。
- `modelRoles`、`retry.fallbackChains` 用结构化编辑（`StructuredEditors.tsx`），行上同样是"编辑…"按钮 + 摘要（角色名 / 回退链条数），对话框里：角色一行一个、模型用下拉选（候选按角色或备用链 key 能用的模型类别筛，和设置 → 模型的角色表同一份，见 `login.md`「角色和备用模型的候选」；列表里没有的值原样保留）、回退链可增删和上下移，每次改动立即保存；值的形状不符时退回 JSON 对话框。
- `getDefaultModel()` / `defaultModel` 事件：服务进程 `get_state` 读新任务实际会用的模型和思考强度；改了 modelRoles、defaultThinkingLevel 等之后约 0.7 秒重读并推事件（`src/main/service/default-model.ts`）。
- **角色值的格式与"选了模型前缀消失"（2026-10-23 实测，omp 18.x，临时 `PI_CODING_AGENT_DIR`）**：`omp config set modelRoles '{"default":"anthropic/claude-opus-5-5:xhigh","smol":"anthropic/claude-haiku-4-5"}'` 之后 `omp config get modelRoles` 和 config.yml 原样是 `provider/model-id[:档位]`。原先的现象有两个独立原因：①显示——值能在模型目录里匹配上（`provider/id`）时下拉触发器显示模型显示名（`Claude Opus 5.5`，没有 provider），匹配不上（带 `:xhigh` 后缀，选择器不等于目录项）时退回原文；②**写入真的丢档位**——`writeModelRole` 原来一律写 `provider/modelId`，在设置里给已有 `:xhigh` 的角色换模型会把后缀丢掉（provider 前缀没丢）。现在 `setModelRole(role, model, thinking)` 带档位写（`omp-config/model-defaults.ts`，`test/model-defaults.test.ts`），拆 / 拼在 `shared/ui/role-value.ts`（`test/role-value.test.ts`）；设置 → 模型的角色格里主模型下拉始终显示 `provider/模型 id`，档位是同格里单独一个下拉（见 spec §4.19）。模型选择对话框里给角色"应用"仍只写模型、不带档位。

## rpc-ui 下的逐项核对（2026-10-18，omp 18.12.1，555 项）

原则（omp 的设置就是 omp-studio 的设置；阶段 2.6 定）：**omp 有的 omp-studio 也要有**，只隐藏在 rpc-ui 下不起作用的项（终端外观、状态栏、终端里的快捷键和提示）。**认不出的项一律显示**（新版本 omp 的新键落进"其他"），只有确认没用的才进隐藏名单。

### 怎么核对的

1. **差分实测（全量布尔/枚举）**：临时 agent 目录 + `--mode rpc-ui`，对 316 个布尔/枚举项逐个翻一次，比较启动后 rpc-ui 能看到的东西（`get_state`、`get_available_commands`、启动帧类型）是否和基线不同。基线重复两次完全一致（无噪声）。**58 项有变化**，其余 258 项没有。有变化的包括：`steeringMode`/`followUpMode`/`interruptMode`/`defaultThinkingLevel`、`compaction.enabled`、系统提示相关（`includeModelInPrompt`、`personality`、`skillful`、`includeWorkspaceTree`、`inlineToolDescriptors`、`memory.backend`、`autolearn.enabled`、`memories.enabled`、`ttsr.enabled`、`tools.intentTracing`、`tools.xdev`、`secrets.enabled`）、所有工具开关（`bash.enabled`、`todo.enabled`、`glob/grep/find/astGrep/astEdit/debug/launch/speechgen/generate_image/computer/ratchet/checkpoint/archive/github/web_search/ask/security/async/fetch/browser/lsp/eval.*.enabled` 等）、`edit.mode`、`task.*`（`isolation`、`eager`、`batch`、`structured`、`enableEffort`）、`skills.*` 与 `commands.*` 的几个开关（改命令列表）、`dev.autoqa`。前缀是终端专用、却在差分里改变了 `get_state` 的只有 `tui.reactions`（原因没查），所以单独放出来显示（`measuredEffective`），其余 `tui.*` 仍隐藏。
2. **行为实测**（真实模型，临时目录）：`bash.enabled=false` 后模型没有 bash 工具（`tool_execution_start` 一次都没有，true 时有）；`todo.enabled=false` 同样没有 `todo` 工具；`hideThinkingBlock=true` 和 `omitThinking=true` 时 `thinking_start/delta/end` 事件照常到达（所以 `hideThinkingBlock` 只是 TUI 的显示开关，omp-studio 自己决定怎么显示思考；`omitThinking` 的作用是模型侧，保留）；**运行中改 `config.yml` 不会发任何事件，但 `get_state` 马上反映**（`omp config set compaction.enabled false` 后 `autoCompactionEnabled` 变 false），所以改完设置不用重启任务（omp 文档"Live file changes"确认）。`plan.defaultOnStartup: true` 在 rpc-ui 下被忽略：RPC 没有进入 plan 模式的命令（`/plan` 会被当成普通文本交给模型），`get_state` 里也没有 plan 字段（实测 18.12.1）。
3. **文档依据**：启动面没变化的项里，大量是只在一轮对话里才起作用的运行时行为（`retry.*`、`compaction.*` 的阈值、`tools.approvalMode`、`edit.*`、`bash.*`、`read.*`、`lsp.*`、`providers.*`、`tier.*`、温度等采样参数、`advisor.*`、`mnemopi.*`/`hindsight.*` 记忆等），按 `omp://settings.md`、`models.md`、各工具文档判定为有效并保留；这类项没有逐个发真实请求验证。

### 隐藏的项（78 项，只在终端界面里有意义）

| 键（前缀） | 为什么没用 |
|---|---|
| `theme.*`、`symbolPreset`、`colorBlindMode`、`statusLine.*`（含 `leftSegments`/`rightSegments`/`segmentOptions`）、`showHardwareCursor` | TUI 的配色、符号、状态栏、光标；rpc-ui 不渲染（差分实测无变化，描述都是 TUI） |
| `tui.*`（含 `tui.vimMode`、`tui.maxInline*`）、`display.*`、`terminal.*` | 终端渲染、鼠标、超链接、标题栏、进度条、内联图片等 |
| `composer.*` | TUI 输入框的形状、token 速率、被清空草稿的回溯、"预测下一条"灰字；omp-studio 有自己的输入框 |
| `input.*`、`doubleEscapeAction`、`treeFilterMode`、`autocompleteMaxVisible`、`spelling.*`、`emojiAutocomplete`、`paste.*` | TUI 编辑器的键位和自动补全 |
| `startup.*`、`update.channel`、`marketplace.autoUpdate`、`setupVersion`、`autoResume` | 交互式启动时的闪屏、更新检查、引导；rpc-ui 由 omp-studio 自己管会话和更新（`autoResume` 是"续上当前目录最近会话"，omp-studio 总是显式打开会话） |
| ~~`completion.notify`、`error.notify`、`ask.notify`、`recap.*`~~、~~`hideThinkingBlock`、`expandThinkingBlocks`~~ | **2026-10-23 起不再隐藏**：TSP 下实测起作用 / studio 的通知读它们，见下面「TSP 下的逐项核对」 |
| `title.icons`、`task.showResolvedModelBadge`、`goal.statusInFooter`、`git.enabled` | TUI 标题图标、子代理徽标、页脚、git 状态栏 |

"未能确认、保留显示"：`power.sleepPrevention`、`loop.*`、`magicKeywords.*`、`stt.*`、`speech.*`、`tts.*`、`live.*`、`collab.*`、`share.*`、`stream.*`。差分实测无变化，但描述不是纯终端界面，可能在 rpc-ui 的某些命令（`live_start`、`/share` 等）里起作用，没有逐个实测，按"认不出的不隐藏"保留。

### 分组结果

| 组 | 项数 | 主要内容 |
|---|---|---|
| 模型与 reasoning | 100 | 模型角色/预设/提供商开关、思考强度和预算、采样参数、`retry.*`、`providers.*`、`tier.*`、`prewalk.*`、`advisor.*`、图像发送、`auth.*`、订阅重置 |
| 工具与权限 | 112 | `tools.approval*`、各工具开关与参数（bash、edit、read、grep、lsp、eval、python、todo…） |
| Context 与记忆 | 112 | 压缩（`compaction.*`、`snapcompact.*`）、上下文文件、记忆后端（`memory`、`mnemopi`、`hindsight` 等）、`ttsr.*` |
| Subagent 与规划 | 60 | `task.*`、隔离/worktree、`plan.*`、`goal.*`、标题生成、skills、commands、扩展 |
| 对话行为 | 14 | 插话/稍后消息/打断、`ask.*`、`loop.*`、魔法关键词、`power.*` |
| 集成 | 37 | MCP、浏览器、搜索（exa、searxng）、`secrets.*`、扩展处理器 |
| 语音 | 11 | `stt.*`、`tts.*`、`speech.*`、`live.*` |
| 其他 | 31 | `gc.*`、`dev.*`、`commit.*`、`collab.*`、`share.*`、`stream.*`、`telemetry.*` 和以后新增的键 |

## TSP 下的逐项核对（2026-10-23，omp 18.12.6）

上一节是 rpc-ui 时代（0.3.26 删掉经典 rpc 任务引擎之前）定的隐藏名单。现在任务是 TSP（伪终端里的交互式 omp，studio 渲染它发来的节点），"在 TSP 下有没有用"要重新核对。方法和工具：真实 omp 18.12.6（PATH 上的 Tern 版），临时 `PI_CODING_AGENT_DIR`，`TERM_PROGRAM=tern`，node-pty `useConptyDll: true`，回 hello、每帧 ack，用 `send` 事件发一句话，对比两次运行收到的 TSP 帧（节点 role 集合、`collapsed`、`del`/`add` 操作）。结果：

### 放出来的（从 `terminalOnly` 名单移到对应分组）

| 项 | 分组 | 依据 |
|---|---|---|
| `hideThinkingBlock`、`expandThinkingBlocks` | 模型与 reasoning（模型页“思考块”小块） | **实测，TSP 下起作用**（`STUDIO_TEST_MODEL` 那个便宜模型，`--thinking high`，同一句 prompt，三次运行：默认 / `hideThinkingBlock=true` / `expandThinkingBlocks=true`）。默认：思考块 `omp.thinking.live` 以 `collapsed:false` 出现，思考结束时 `set q.k0 {role:"omp.thinking", collapsed:true, took}`、头部换成 `Thought for 1s`。`expandThinkingBlocks=true`：结束时 **不再** 发 `collapsed:true`，块保持展开（`took` 照发）。`hideThinkingBlock=true`：思考中的块一出现就是 `collapsed:true`（正文仍在流），思考一结束整个块 `del q.k0`（对话里不留）。omp 的 `assistant-message` 组件按这两个设置取舍同一棵节点树，studio 的折叠状态跟着节点的 `collapsed` 走，所以两项都直接生效，studio 不用另做 |
| `recap.enabled`、`recap.idleSeconds` | 对话行为 | omp 空闲一段时间后发 `omp.recap` 节点（studio 的 `RecapRow` 渲染，只显示最新一条）；关掉就不再发、也不再写 `history.db` 的 `session_recaps`（恢复会话时补的回顾同样没有）。设置决定 omp 发不发这个节点，所以放出来。没有逐项录制对比，依据是 omp 源码 `interactive-mode` 里的回顾定时器和 studio 已有的 `omp.recap` 处理 [推测，未单独实测关掉后的帧] |
| `ask.notify`、`completion.notify`、`error.notify` | 对话行为（通用页“通知与回顾”一节） | **studio 的系统通知直接读这三项**（见下），不再有 studio 自己的开关。取值 `on` \| `off`，默认 ask 开、completion 开、error 关（`omp config list` 实测） |

### 仍然隐藏的，以及核对结果

- `terminal.programStatus`：**保持隐藏**。studio 靠 omp 发的 OSC 7501 做任务状态（运行 / 等你 / 完成 / 出错），用户不应该能关掉它（关掉状态点就坏了）。同前缀的 `terminal.showImages`、`terminal.showProgress` 也隐藏：进度条是终端标签页的东西；`terminal.showImages=false` 的对比运行里节点集合多出了 `omp.overlay.console` / `omp.actions` / `omp.btn`，但没有一个和图片显示相关，看起来是那次运行里模型出错弹出的控制台浮层，不是这项设置的效果 [推测，未重复]。
- **差分实测（`display.*`、`tui.*`、`composer.*`、`terminal.*`、`git.enabled`、`goal.statusInFooter`、`task.showResolvedModelBadge`、`statusLine.showHookStatus`、`colorBlindMode`，共 27 项，每项翻一次，让模型跑一次 bash 再答）**：节点 role 集合、节点种类和用量行文字 **没有变化** 的有：`display.hideToolActivity`、`display.showTurnTime`、`display.cacheMissMarker`、`display.collapseCompacted`、`display.subagentLivePreview`、`display.smoothStreaming`、`display.pinnedAgents`、`tui.tight`、`tui.renderMermaid`、`tui.renderSvg`、`tui.autoGraph`、`tui.hyperlinks`、`tui.titleState`、`tui.vimMode`、`tui.reactions`（提示词变了、节点不变；`tui.reactions` 本来就在 `measuredEffective` 里单独放出）、`composer.tokenRate`、`composer.predictions`、`git.enabled`、`goal.statusInFooter`、`task.showResolvedModelBadge`、`statusLine.showHookStatus`、`colorBlindMode`、`terminal.showProgress`——这些在这一次简单对话里看不到效果，保持隐藏（它们改的是终端里的显示；studio 不画对应的东西）。**有变化的只有 `display.showTokenUsage`**：打开后每条助手消息多一个 `omp.usage.turn` 节点（含 `rate` 速率节点），studio 已经有自己的每轮用量脚注（`omp.turn.usage`），多一行重复信息，所以也保持隐藏。**没能测的**：`display.shimmer=none`、`title.icons=none` 两次运行都因探针脚本的错误没跑出来，按原判断（终端动画、标题图标）隐藏。
- `composer.*`、`input.*`、`doubleEscapeAction`、`treeFilterMode`、`autocompleteMaxVisible`、`spelling.*`、`emojiAutocomplete`、`paste.*`、`startup.*`、`update.channel`、`marketplace.autoUpdate`、`setupVersion`、`autoResume`、`theme.*`、`symbolPreset`、`statusLine.*`、`showHardwareCursor`、`title.icons`：理由同上一节，studio 的输入框、会话管理、更新、外观都是自己的；没有再逐个实测。

### studio 的系统通知遵守 omp 的 `*.notify`

`GateNotifier`（`src/main/tasks/gate-notifier.ts`）每次要发通知前问 `notifyEnabled(task, kind)`：主进程在任务所在项目目录里跑 `omp config list --json`（和审批模式、模型默认值同一条通道，项目的 `.omp/config.yml` 盖过全局），取对应的 `ask.notify` / `completion.notify` / `error.notify`，`on` 才发（`omp-config/notify-settings.ts`，`test/notify-settings.test.ts`、`test/task-gate-notifier.test.ts`）：

| 场景 | 看哪一项 | 其余条件（不变） |
|---|---|---|
| 任务进入 `needs_you`（提问、审批） | `ask.notify` | 窗口没有焦点 |
| 一轮正常跑完 | `completion.notify` | 窗口看不见（托盘 / 最小化） |
| 任务出错 | `error.notify` | 窗口看不见 |

- **去掉了 studio 自己的 `notifyOnGate` 开关**（设置 → 通用里的“有任务在等你时通知我”）：它和 omp 的三项管同一件事，只留 omp 的。要关通知，在通用页“通知与回顾”里改 omp 的那三项（终端版 omp 共用）。“任务完成时响提示音”（`soundOnDone`）是另一件事（声音，不是系统通知），仍是 studio 自己的设置：窗口在托盘、且 `completion.notify` 开着时发了通知就不再另响；`completion.notify` 关着时照样按它响。
- **没有迁移**（仓库所有者 2026-10-23 定）：AGENTS.md 只批准了两处自动写 omp 配置，studio 不为这个开关新增第三处。旧开关已删，`settings.json` 里残留的 `notifyOnGate` 由 `sanitize` 丢掉；以前关过它的用户需要在“通知与回顾”里自己把 omp 的三项关掉，否则会按 omp 的默认值收到通知。
- 行为变化：`error.notify` 默认是 `off`，所以不改设置的话，窗口在托盘时任务出错不再有系统通知（以前有）；要保留就在设置里把“任务出错时通知”打开。
- `ask.notify` 在 omp 里的说明是 “Notify when the ask tool is waiting for input”；studio 的“等你处理”包括审批门（`needs_you` 状态），这里把审批也算在 `ask.notify` 下 [推测：omp 对审批门用不用同一项没有从源码里确认，omp 打包的 JS 里读这个键的位置没提取到]。

### omp 快捷键（转发给 omp 的键）

见 `docs/design/spec.md` §5.1 和 `docs/architecture/tsp-real-omp-probes.md` §17。键位来自 omp 自己：默认键位（`packages/tui/src/app-keybindings.ts` 的 `app.*` defaultKeys，omp 18.12.6）加用户 `<agent 目录>/keybindings.yml`（其次 `.yaml`、再其次旧的 `.json`；`omp://keybindings.md`）。文件是 `动作 ID: 键 | [键…]` 的映射，覆盖是整个动作换掉，`[]` 禁用，不认识的形状当没写，旧的不带命名空间的名字（`cycleThinkingLevel`…）也认。主进程只读（`omp-config/keybindings.ts`，不迁移、不写，omp 自己加载旧 `.json` 时才会迁移），算法在共享的纯函数 `src/shared/tsp/omp-keybindings.ts`（`resolveOmpKeybindings`），经 IPC `getOmpKeybindings` 给渲染进程；输入框 / 过程区拿到焦点、窗口回到前台、打开设置页时重读。studio 自己占用的键（`STUDIO_RESERVED`）永远赢：用户把 omp 的动作改到 studio 的键上时这个键不转发；单个字符、Shift+方向键这类输入框要用的键也不转发（只转发带 Ctrl / Alt 的、功能键、Shift+Tab）；带 Super / Cmd 的 studio 发不出去，跳过。不处理命名 profile 的继承（同 `models.yml`、会话索引：只认默认 profile）。

设置页“通用 → 快捷键”表下面多一组“omp 快捷键”（`data-testid="omp-shortcuts"`），列出当前会转发的动作和键，作用文字是 omp 的英文描述（英文界面）或其中文化（`shortcut.omp*`）。

## 审批模式（输入框胶囊）

- 取值（`omp config list` 的 enum 选项，omp 18.12.5）：`always-ask` | `always-ask-cached` | `write` | `yolo`；`always-ask-cached` 在 omp 里叫 Ask and remember（读文件也询问，批准可记住文件/文件夹，记住的批准用 `/forget-approvals` 清）。取值和 `toApprovalMode` 在 `src/shared/approval-mode.ts`；omp 给了不认识的值，胶囊显示 `approval.loading`，不当成别的档位。
- **项目盖过全局**（实测 18.12.5，临时 `PI_CODING_AGENT_DIR`）：全局 `omp config set tools.approvalMode write`，项目 `.omp/config.yml` 写 `tools.approvalMode: always-ask-cached`；在项目目录里 `omp config list --json` / `omp config get` 给 `always-ask-cached`，在别处给 `write`。omp 只看 cwd 下的 `.omp/config.yml`，父目录里的不算（cwd 在 `proj/sub`、`proj/.omp/config.yml` 设了值：读到 omp 默认 `yolo`）。`PI_APPROVAL_MODE` 环境变量 [推测，未实测] 会盖过两者（`test/omp-config.test.ts` 的假数据里 `omp config set` 结果带 `overriddenBy`），studio 不处理。
- **读**：`getApprovalMode(projectId)`（`omp-config/approval-mode.ts`）在项目目录里跑 `omp config list --json` 得生效值；`list` 不带来源，所以另外只读解析项目 `.omp/config.yml`，`tools.approvalMode` 是字符串就记 `source: "project"`，否则 `"global"`（项目文件解析不了会报错，不当成没设）。projectId 为 null（无项目的聊天）只看全局。只有全局来源的值记进启动缓存。
- **写**：只经 `omp config set tools.approvalMode`（全局，用设置页同一条 `setOmpConfig`）。omp 没有写项目层的命令（实测 18.12.5：`omp config set --help` 只有 `--json`；在项目目录里 `omp config set tools.approvalMode write` 仍然写全局，项目文件不动，并提示 “Project settings override this value here; edit or remove it there for the saved value to apply.”），studio 不自己改项目文件（AGENTS 只允许两处例外）。所以项目 `.omp/config.yml` 设了这一项时，胶囊菜单里的四档置灰不可选，悬停提示加一句 `approval.projectLocked`（“由项目配置决定（.omp/config.yml）”）；「清除已记住的批准」不受影响。
- **清除已记住的批准**：胶囊菜单里给任务的 omp 会话发 `/forget-approvals`（`sendPrompt`，同 `/retry`）。实测 18.12.5 `omp --mode rpc-ui` 下 `prompt` 发 `/forget-approvals` 不调模型（应答 `agentInvoked:false`），先回一条 `command_output`：“Remembered approvals forgotten; the next read or write asks again.”。清的是整个 agent 目录的批准库，不分项目。草稿、标题为空（还没发过消息）的任务里禁用，否则第一次 `sendPrompt` 会拿这条命令当标题。
- worktree 任务：胶囊按项目目录（不是 worktree 根）读；worktree 里没有的未提交 `.omp/config.yml` 在那里不生效，这种情况显示可能和 omp 实际行为不同。
- 测试：`test/approval-mode.test.ts`（生效值与来源、四档文案）。

## 集成卡片：MCP、SSH、可用工具、记忆、更新日志（S5，omp 18.12.5 实测）

斜杠命令 `/mcp /ssh /tools /memory /changelog` 由 studio 接管（`tsp:"studio"`），界面是设置页对应节里的卡片（集成与插件 = MCP + SSH + 插件与市场，工具与权限 = 可用工具，Context 与记忆 = 记忆，关于 = 更新日志里 omp 那一项，只取最新一节；spec §4.19「集成卡片」）。代码：`src/renderer/src/features/settings/{McpCard,McpForm,SshCard,SshForm,ToolsCard,MemoryCard,Changelog,ScopePicker}.tsx`；解析器 `src/shared/omp-output/{mcp,ssh,tools,changelog}.ts`；SSH 的主进程 `src/main/integrations/ssh.ts` + `src/main/ipc/integrations-handlers.ts`；MCP / 记忆 / 工具 / 更新日志走 S0 的 `runBuiltin`（用户范围 = 服务进程，项目范围 = 项目目录里的短命 rpc-ui）。文本格式不是 omp 的契约：解析不了的行原样显示，omp 的话原样给用户，不吞。以下都是临时 `PI_CODING_AGENT_DIR` + `--mode rpc-ui --no-session`（或 CLI）实测，2026-10-21。

### `/mcp`（rpc-ui 的 `command_output`，全部 `agentInvoked:false`，不调模型）

- **切词（要紧）**：`add` 认双引号（`/mcp add "b c" --scope user -- node -e 1` 存成名字 `b c`；`-- "C:\Program Files\nodejs\node.exe" -e 1` 存成 `command: C:\Program Files\nodejs\node.exe`；双引号里的单引号、反斜杠原样保留），但**不认转义**：`"a\"b"` 存成 `a\b`（引号照样开合、被吃掉）。所以 studio 对 `add` 的 `-- <命令> <参数…>`：含空白或单引号的词加双引号，含 `"` 的拒绝（`plainArg` / `quoteArg`，`src/shared/omp-output/index.ts`）。`remove / enable / disable / test` **按空白切词**（`remove "b c"` → `Unknown option: c"`，`remove b\ c`、`remove 'b c'` 同样失败）：所以名字有空格的服务器管不了，界面里只读；添加表单的名字只收 `[A-Za-z0-9._-]`（omp 自己允许字母数字、`- _ . :` 和单个空格，`../y` 被拒：`Server name can only contain …`）。
- **失败也是普通输出**：`Unknown option: --header`、`Failed to add server: Server "x1" already exists in <path>`、`Invalid --transport value. Use http or sse.`、`Server name required…`、`Failed to remove MCP server: Server "nope" not found in <path>`、`Server "x" not found. Run /mcp list…`，`success` 仍是 true。所以 `mcpOutcome` 只认已知成功句式（`Added MCP server "x" (user).`、`Removed server "x" from user config.`、`Server "x" enabled|disabled (user config).`、`MCP runtime reload requested.`），其余一律当失败并显示原话。
- **范围**：`add` 默认写**项目**（不带 `--scope` 写 `<cwd>/.omp/mcp.json`），studio 总是显式带 `--scope`。`/mcp list` 不分范围，合并用户和项目两层：`名 | 传输 | enabled|disabled | 目标 [user|project]`，`list --scope project` 被忽略；stdio 的目标只有命令（参数不显示）。`remove` 默认也是 project。`enable / disable` 不带 scope，按服务器所在的文件改（`disabled (user config)`）。用户范围的写入落在 `<agentDir>/mcp.json`（`mcpServers`，`enabled:false` 表示关），项目范围在 cwd 的 `.omp/mcp.json`。
- **`add` 的参数**：`--url <u> --transport http|sse [--token <t>]`（`--token abc` 写成 `headers.Authorization: "Bearer abc"`；没有 `--header`）或 `-- <命令…>`。令牌走 rpc 的 stdin 帧，不在任何进程的命令行里。
- **`test <name>`**：成功 `Server "real" connected (1 tools).\n  - ping`；失败 `Connection to "a" failed: MCP subprocess closed stdout before responding`。
- **`reauth` / `unauth` / `reconnect`**：rpc-ui 只回 `/mcp reauth requires OAuth or browser flows only available in the TUI client.`（终端版 TUI 的帮助里才有 `reauth`、`unauth`、`--token`）。所以卡片没有这三个按钮，底部说明去终端做；`MCP_SIMPLE_OPS` 也不收它们。`/mcp reload` → `MCP runtime reload requested.`：改完配置，已打开的任务要在它自己的会话里 reload（omp 的 mcp-config.md）。

### `omp ssh … --json`（CLI，数组参数）

- `list --json` → `{"project":{…},"user":{…}}`（两层都在，project 取决于 cwd：中性目录里是空的）；字段 `host / username / port / keyPath / description / compat`。`add` / `remove` 即使带 `--json` 也只输出一句话（`Added SSH host "box" to user config`）。**错误写在 stdout** 且退出码 1（`Error: Host "box" already exists in <path>`、`Error: --host is required`、`Error: Host name can only contain letters, numbers, dash, underscore, and dot`、`Error: Port must be an integer between 1 and 65535`），命令行解析错误才写 stderr（`Option '--desc' argument is ambiguous`）。`sshWriteResult` 取 stdout 的原话去掉 `Error: ` 前缀。
- **`-` 开头的值**：`--desc - x` 报 ambiguous，`--desc=- x` 可以（`--host -oProxyCommand=x` 同样被当缺参）。所以 studio 一律写 `--flag=value`；地址和用户名另外拒绝空白和 `-` 开头（它们之后会交给 ssh）。
- 项目范围：cwd 是项目目录，`--scope=project` 写 `<项目>/.omp/ssh.json`（`{"hosts":{…}}`）；用户范围在中性目录 `userData/service` 里跑，写 `<agentDir>/ssh.json`。

### `/tools`

每行 `* 名` 已启用、`- 名` 可用但当前没启用（如 `ast_edit`、`lsp`、`debug`）、`~ xd://…` xd 设备。把 `bash.enabled` 设成 false 后，**`bash` 从列表里整行消失**（不是变成 `-`）；把 `lsp.enabled` 设成 true 没有改变 `- lsp`（还需别的条件）。运行中改 config.yml，下一次 `/tools` 就反映。所以工具卡片的开关是 `<工具>.enabled` 设置项本身（`ast_edit` → `astEdit.enabled`，`web_search` → `web_search.enabled`，`toolConfigKey` 两种写法都试），关掉后行保留、点刷新才重读。列表是服务进程（无项目）的全局结果。

**为什么有些行没有开关（2026-10-23 实测，omp 18.12.6，rpc-ui 发 `/tools`；仓库所有者本机和"空 `PI_CODING_AGENT_DIR` + 空 HOME"两边对比）**：不是本地配置的问题，也不是 studio 坏了。

- 空目录的输出里同样有 `- ast_edit`、`- debug`、`- lsp`、`- goal`、`- init_experiment`、`- run_experiment`、`- log_experiment`、`- update_notes` 和 `~ xd://ast_edit`、`~ xd://debug`、`~ xd://lsp`；仓库所有者本机多出来的只有 `- mcp__pro_image_*`、`- mcp__tavily_*` 和对应的 `~ xd://mcp__*`，来自他 `mcp.json` 里的两台 MCP 服务器。
- `- 名` 且同名有 `~ xd://名`（ast_edit、debug、lsp、`mcp__*`）：`tools.xdev` 默认 `true`（settings.md），可发现的工具挂在 `xd://` 设备下按需调用，不在顶层工具列表里，所以 `-`；工具本身是可用的（omp 文档 mcp-runtime-lifecycle.md：MCP 工具连上后立即启用，只是呈现为 `xd://` 设备）。`ast_edit` / `debug` / `lsp` 有 `astEdit.enabled` / `debug.enabled` / `lsp.enabled`，所以有开关；`mcp__*` 没有任何按工具的设置项，omp 只能按服务器启停（`mcp.json` 的 `enabled`、`disabledServers`，即设置页 MCP 卡片的开关）。
- `- 名` 且没有设备（init_experiment、run_experiment、log_experiment、update_notes 是 autoresearch 的实验工具，session.md 里有 `autoresearch-control` 记录说明它由 `/autoresearch` 模式开关；goal 对应 `/goal`）：当前会话没启用，由模式或命令启用，没有 `<工具>.enabled`（`omp config list` 里没有 experiment 相关键）。`goal.enabled` 有，所以 goal 有开关。
- `~ xd://名`：同一个工具的设备入口，不是单独的工具；整体收起用 `tools.xdev`（关掉后工具直接放进模型的工具列表）。
- 结论：omp 本身不支持按单个 MCP 工具 / 实验工具 / 设备开关，所以 studio 不做开关，改成在徽标 tooltip 里写原因和去哪里改（`ToolsCard.tsx`，`toolKind`）。

### `/memory`

- **按项目分**：omp 文档 memory.md：local 后端是项目级摘要；sharpshooter 的 bank 来自工作目录——实测 `/memory diagnose` 的锁路径是 `<agentDir>/memories/sharpshooter/proj-dir-27egy5ntf4fkg/consolidate`（`proj dir` 这个 cwd 派生的 bank）；hindsight 默认 `per-project-tagged`。所以记忆卡片只能选项目，每次操作在该项目目录里的短命 rpc-ui 跑（`runBuiltin(cmd, {projectId})`）。
- 输出：后端 off：`stats`/`diagnose` → `Memory backend is off — there is nothing to show.`，`queue` → `Memory queue is not available for the off backend.`，`view` → `Memory payload is empty.`；local：`stats` / `diagnose` / `queue` → `Memory <op> is not available for the local backend.`；sharpshooter：`stats` 是 markdown（`# Sharpshooter Memory Stats` + Files / Queue / Consolidation），`diagnose` 同（Model、Interval、Lock、Due in、Last error），`queue` → `Queue is empty.`。`sync` → `Memory consolidation ran.`（立即整理，会调模型），`rebuild` / `enqueue` → `Memory consolidation enqueued.`，`clear` / `reset` → `Memory cleared.`，不认识的子命令 → `Usage: /memory <view|stats|diagnose|clear|reset|enqueue|rebuild|queue|sync>`。输出原文放 `<pre>`，不当 HTML。Hindsight 的 `clear` 只清本地状态（omp 文档），确认框里写明。
- **立即整理 / 重建没有做成按钮**（实测 omp 18.12.5，临时 agent 目录 + `memory.backend: local` + `memories.minRolloutIdleHours: 0` + `.env` 里的便宜模型先用 `omp -p` 造一个过去的会话，再开 rpc-ui）：① `--no-session` 的 rpc-ui（服务进程 / 项目 rpc-ui）里 `/memory sync`、`/memory rebuild` 都回成功句（`Memory consolidation ran.` / `enqueued.`），40 秒后 `<agentDir>/memories/` 仍不存在，`/memory view` 一直是 `Memory payload is empty.`；② 带会话的 rpc-ui（和任务进程同一种）**启动时自己**跑 phase 1+2：什么命令都不发，约 40 秒后就写出 `memories/<项目>/{MEMORY.md,memory_summary.md,raw_memories.md,rollout_summaries/…}`，`/memory view` 变成 `# Memory Guidance …`——所以"发了 sync 之后出现文件"不能归功于 sync；③ 先启动带会话的 rpc-ui、**之后**再造会话，再发 `/memory sync`：40 秒内没有任何文件。结论：本地记忆只在会话进程启动时生成，`sync` / `rebuild` / `enqueue` 在那之外没有可观察的效果（`--no-session` 里更是什么都不会发生），没有一条可用的路径，所以不提供这两个按钮。`runBuiltin` 仍接受这两个 op（S0 的封闭集合），界面不用。**`clear` 有效**：`--no-session` 的项目 rpc-ui 里发 `/memory clear` 后 `memories/` 下的文件全部消失，带会话的进程里同样；下一次会话启动又会按过去的会话重新生成（确认框里写明）。sharpshooter 的 `sync` 同样回 `Memory consolidation ran.`，没有用真实对话验证它的队列效果。

### `/changelog`

整段 markdown：`## [18.12.3] - 2026-10-19` + `### Added` 等。`splitChangelog` 按 `## ` 拆版本（代码块里的不算），界面按节折叠、只展开最新一节，渲染用对话流的 `Markdown`（markdown-it）。输出很长，所以点开才读。

**顺序和范围（2026-10-21 实测，`omp --version` = 18.12.5，PATH 上的 Tern 管理的 `omp.exe`；服务进程用的就是它）：** omp 的 `/changelog` 按**时间正序**输出，而且只有最近几版：`rpc-ui` 里发 `/changelog` 得到 `## [18.12.3] - 2026-10-19`、`18.12.4`、`18.12.5` 三节，最新的在**最后**（18.12.5 的二进制里内嵌的更新日志也含 18.12.0–18.12.5 各节，所以不是 studio 读了旧来源，也不是 omp 没带上新版本）。早先界面按原顺序列、只展开第一节，于是最上面是 18.12.3 而不是已装的 18.12.5。现在 `splitChangelog` 按版本号从新到旧排（`Unreleased` 之类非数字版本排最前，版本比较用 `shared/omp-version.ts` 的 `compareVersions`，和主进程共用），最新的一节在最上面并默认展开。来源仍是服务进程里 omp 的 `/changelog`，studio 不自己读任何更新日志文件（"最近更新"用的是随包的 `CHANGELOG.md`，是 studio 自己的）。

### 测试

`test/omp-output-integrations.test.ts`（上面所有原文样本、`/mcp add` 命令文本的引号规则）、`test/integrations-ssh.test.ts`（`omp ssh` 参数和假 omp 读写）；e2e `settings-functional.e2e.ts` 的「集成」用例（真实 omp + 临时 agent 目录 + 空的用户目录：添加 / 开关 / 删除 MCP 与 SSH，原话报错，工具、记忆卡片、更新日志）。
