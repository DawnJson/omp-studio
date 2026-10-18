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

- 左侧导航：omp-studio 自己的三组（通用、模型与账号、omp），再接 omp 的 tab；顶部搜索框按 key、omp 英文描述、中英文标签和说明过滤（多个词要全部命中），`Ctrl F` 聚焦，`Esc` 先清搜索。
- 每项默认一行：标签 + ⓘ（描述、key、"omp 原文"标记都在悬停/聚焦/点击出现的说明里）+ "已修改"标记 + 保存反馈，右边是"恢复默认"和控件。搜索命中的是描述时，才在行下面显示那一句。被覆盖、保存或校验出错时才多一行。
- 控件：boolean 开关；enum 三个及以内且短的用分段，否则下拉；number 文本框（要求是数字）；string 文本框；array/record JSON 编辑器（解析失败、类型不对就地报错，不保存）。文本类停手 700 ms（JSON 1 s）、失焦或 Enter 保存；开关和选择立即保存。
- 常用项（模型角色、思考、审批/工具、上下文压缩、记忆、子代理 task、retry）有人话标签和中英文说明，在 i18n 的 `ompcfg` 命名空间（`<key>.label` / `<key>.desc`），排在每个 tab 的"常用"组最前面；其余项显示 key 和 omp 原文。tab 名也在 `ompcfg`（`tab.<名>`）。
- 长列表：非"常用"的小组（按 key 第一段）在超过 30 项的 tab 里默认折叠，折叠状态记在模块里。

## 打磨（第三轮）

- 自定义下拉 `Dropdown.tsx` 替换原生 `<select>`：token 样式、portal + fixed 定位（向下放不下就向上）、↑↓/Home/End/Enter/空格/Esc、首字母跳转、选中项打勾；Esc 只关弹层。右侧控件列统一宽度 `--st-control-w`（220px），开关和分段控件除外。
- 设置页没有"返回"按钮（顶栏有后退，Esc 仍然回去）；搜索框在导航列顶部；滚动用共用的 `OverlayScrollbar`；分组标题是正常字体、首字母大写，计数用正常字号的次要色；导航分组名不再大写。
- `modelRoles`、`retry.fallbackChains` 用结构化编辑（`StructuredEditors.tsx`）：角色一行一个、模型用下拉选（来自服务进程的模型列表，列表里没有的值原样保留）、回退链可增删和上下移；值的形状不符时退回 JSON 编辑器。其余 array/record 的 JSON 编辑器等宽、自动高度（`field-sizing: content`，最高 320px）。
- `getDefaultModel()` / `defaultModel` 事件：服务进程 `get_state` 读新任务实际会用的模型和思考强度；改了 modelRoles、defaultThinkingLevel 等之后约 0.7 秒重读并推事件（`src/main/service/default-model.ts`）。
