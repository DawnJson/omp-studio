# 提示词优化（输入框的 ✦）

输入框**发送键左边**一颗无箭头图标按钮，把草稿交给 omp 用小模型流式改写得更清楚，完成后**一次替换**草稿，`Ctrl+Z` 一步回到原文。支持多风格自选和可选轻量上下文，不落会话。界面规则见 spec §4.14「提示词优化」、§5.1 快捷键、§5.2 Esc 栈。

## 代码

| 位置 | 作用 |
|---|---|
| `src/shared/prompt-enhance.ts` | 类型（风格、偏好、流式事件）、`canEnhance`、附件占位符比对 `missingMarkers` |
| `src/main/prompt-enhance/context.ts` | 可选轻量上下文：当前分支最近 2 轮纯文本对话摘要（增量读会话文件）+ Git 改动文件路径列表 |
| `src/main/prompt-enhance/enhance.ts` | `omp -p` 的参数、5 档风格模板、语言判断、`<think>` / 围栏清理、流式预览清洗、结果分类、`chooseModel` |
| `src/main/ipc/prompt-enhance-handlers.ts` | IPC `enhancePrompt` / `cancelEnhancePrompt` / `setPromptEnhanceSettings`：校验、定 cwd 与会话、采集上下文、节流推送 `promptEnhanceStream`、每个输入框同时一次、退出时全部取消 |
| `src/renderer/src/features/composer/use-prompt-enhance.ts` | 发起 / 流式预览 / 取消 / 过期判断 / 替换 / 提示；`Esc`、`Alt E` 与命令面板 |
| `src/renderer/src/features/composer/EnhanceButton.tsx` | 无箭头图标按钮（`enhance-button`，优化中 `data-busy` ✦ ↔ ×，非默认风格或开启 Git 文件时亮角标点 `data-differs`）与悬停 / 右键弹出的风格和上下文浮层 |

## 调用 omp

参数数组、不经 shell：

```
PI_AUTO_QA=0 OMP_MCP_TIMEOUT_MS=1 omp -p --no-session --tools= --no-lsp --no-skills --no-rules --no-context-files --no-title \
    --model <@smol | provider/model> --system-prompt "<模板>"
```

- **草稿和可选上下文走 stdin**：有上下文时先放只读 `<context>`，再放 `<draft>`，命令行里只有模板（命令行里的中文和换行在 Windows 上不可靠）。
- **不带工具和冗余能力**：`--tools=`（空列表）只关内置工具，扩展照常加载（omp 19.2 起 `--no-tools` 连扩展一起不加载，`studio-accounts` 注册的 provider 会解析不到，也不能和 `-e` 同用）；`--no-lsp` 关掉 LSP；环境变量 `PI_AUTO_QA=0` 关掉 Auto-QA 的 `report_issue`，`OMP_MCP_TIMEOUT_MS=1` 让慢启动的 MCP 服务器本次跳过（同 `pet.md` 实测，把 3 个 MCP 时的 token 从 6,895 压到 469）。
- **不落会话**（`--no-session`，实测 agent 目录里没有 `sessions/`）。花费在 provider 账单上；[推测] 不进 `omp stats` 和 studio 的会话费用，没核实。
- **cwd**：任务的 cwd（项目 `.omp/config.yml` 的角色照常生效）；草稿页是项目目录，没有项目时是服务进程的中性目录（`serviceCwd()`）。
- 超时见 `ENHANCE_TIMEOUT_MS`；取消 = `runCommand` 的 `signal`，结束整个进程树。可执行文件同任务进程（`prompt-enhance/one-shot-omp.ts`）；未打包时 `STUDIO_TEST_ENHANCE_OMP` 顶替。

### 模型

- 配了 `smol` 或 `default` 角色（cwd 里 `omp config list` 的 `modelRoles`）：`--model @smol`（smol 没配时 omp 退到 default）。要带 `@`：`--model smol` 报 `Model "smol" not found`。
- 两个都没配：改用界面传来的 **fallback**（任务正在用的模型 / 草稿页新任务会用的模型）。TSP 任务的模型有时 `provider` 为空，拼不出 `provider/model`，不传。
- 读不到配置（omp 未就绪、e2e 里是假 omp）不挡优化：记一行 WARN，交给 omp 解析 `@smol`。
- 不传 `--thinking`，沿用角色的 `:level` 后缀。不另设“优化模型”的设置：改 smol 角色就是改它。

### 风格与模板（所有者定，2026-11-27）

5 档风格持久化在 `StudioSettings.promptEnhance`：
- `polish`（克制润色，默认）：理顺表述、尽量少改、短草稿保持短。
- `spec`（清晰规格）：按目标、范围、约束、验收拆成清晰结构，不编造未提及需求。
- `debug`（排查定位）：突出症状、排查范围、约束与预期回归验证。
- `concise`（极简紧凑）：去掉口水话和重复，压缩为高密度指令。
- `custom`（自定义要求）：用户可在浮层里填写一小段附加要求（上限 `PROMPT_ENHANCE_CUSTOM_MAX_CHARS`，包在 `<style_preference>` 中，仍强制遵守不执行、不臆造、保留占位符与语言等核心规则；为空时退回 `polish`）。

英文指令，**按草稿语言写明输出语言**（`draftLanguage` 去掉占位符、代码、路径和标识符后按汉字占比 ≥ 30% 判断中文）。

### 可选轻量上下文（所有者定，2026-11-27）

- **最近对话**（任务内默认开；草稿页无对话自动禁用）：只读当前任务会话文件（不写 `~/.omp`），复用 `SessionReaderCache` 增量读取，从最后一个条目沿 `parentId` 回溯当前分支最近 2 轮用户/助手纯文本，跳过工具输出、思考块和 agent 注入条目，长代码块折叠为 `[code block]`，总长度硬截断在 1,500 字符内。
- **Git 改动文件**（默认关）：复用 `git/status.ts` 只列状态码和相对路径（最多 30 个文件 / 1,000 字符，不含 diff 正文）。
- 任一来源缺失或读取失败都静默跳过，不阻塞优化。

### 流式与结果

- stdout 经 `StringDecoder("utf8")` 逐块解码、`cleanStreamingPreview` 剥离 ANSI、完整或未闭合 `<think>` 块与开头围栏后，以 ~30ms 节流经 `promptEnhanceStream`（带 `requestId` 去重）推送到界面。
- 结束时用 `cleanOutput` 做最终清洗（去 ANSI、`<think>…</think>`、整段代码围栏、`<draft>` 标签、外层成对引号）并核对 `missingMarkers`。

| 结果 | 条件 | 界面 |
|---|---|---|
| `enhanced` | 退出码 0，输出清理后非空，附件占位符一个不少（按次数比） | 一次替换草稿 |
| `markers_lost` | 少了占位符：替换后附件会被 `reconcileDraft` 删掉 | toast `composer.enhance.markersLost` |
| `no_model` | 输出有 `No model available` / `No API key` | toast `composer.enhance.noModel` + "设置模型角色" |
| `failed` | 其余非 0 退出、超时、空输出 | toast `composer.enhance.failed`，omp 原话在悬停提示里 |
| `cancelled` | 取消 | 不提示 |

日志只记结果类型、模型来源、风格、上下文开关、字符数、失败时 omp 的错误行；**不记草稿、上下文和结果正文**（`security.md`）。

## 界面行为

- **入口（所有者定，2026-11-27）**：单颗无箭头 `✦` 按钮，点击按当前风格和上下文立刻优化；鼠标悬停停顿（240ms）、右键或键盘聚焦按 `↑` 向上浮出风格与上下文面板（无 `⌄`）。点击 4 档内置风格会保存偏好并在草稿可优化时立刻触发；选「自定义要求」在浮层内展开输入栏，按 `Enter` 直接触发。快捷键 `Alt E` 与命令面板“优化提示词”均可触发/取消。
- **能不能点**：草稿去掉占位符后为空、以 `/` 开头（斜杠命令）、worktree 被删、输入框禁用时禁用；优化进行中总能点（= 停止）。任务运行中也能用。
- **流式展示与原生撤销**：流式文本渲染在输入框内的临时 `.composer-stream` 层（带脉冲光标，点击取消），底层 `<textarea>` 保持挂载与焦点、不改写 `value`；完成时收起流式层，聚焦 → `select()` → `document.execCommand("insertText", false, view 文本)` 一次替换，因此原生 `Ctrl+Z` 一步回到原文、附件芯片不丢。
- **过期就丢与取消**：草稿一变（编辑、发送、换任务）立刻取消调用；再点一次、`Esc`（先关浮层，再停优化，再停任务）、换输入框或退出应用（`window/shutdown.ts`）均中止子进程。

## 实测

omp 18.18.3（临时 agent 目录 / home，模型 `STUDIO_TEST_MODEL` = DeepSeek V4 Flash）：

- `modelRoles.default` 设好、`--model @smol`：每次几秒，stdout 就是结果，stderr 只有 `Working...`，退出码 0。
- 一个角色都没配、`--model @smol`：omp 挑了有 key 没额度的 provider，退出 1；直接传 `provider/model` 正常。
- 取消：abort 后进程很快消失，无残留；agent 目录里没有 `sessions/`。

omp 19.2.1（2026-11-26，临时 agent 目录 / home，带扩展注册 provider）：

- `--no-tools --model <扩展的 provider>/<模型>`：退出 1，`Model "…" not found`，扩展没加载。
- `--tools= --model <扩展的 provider>/<模型>` + `PI_AUTO_QA=0`：扩展加载，请求里没有 `tools` 字段；`--no-lsp` 为独立参数可用；`OMP_MCP_TIMEOUT_MS=1` 跳过慢启动 MCP（`pet.md` 实测）。

## 测试

- `test/prompt-enhance.test.ts`：`canEnhance`、目标比较、占位符比对、语言判断、5 档风格模板、上下文拼装、`chooseModel`、`cleanOutput`（含 `<think>`）、`cleanStreamingPreview`、参数（`--tools= --no-lsp`，不含 `--no-tools` / `--no-extensions`）；对假 omp（`test/fake-omp/fake-omp-print.ts`）：草稿只走 stdin、`PI_AUTO_QA=0`、`OMP_MCP_TIMEOUT_MS=1`、流式分块与思考块隐藏、各结果分类、取消、超时。
- `test/prompt-enhance-context.test.ts`：最近对话分支回溯与截断、Git 改动文件路径格式化、缺失文件与非 git 目录静默降级、真实临时文件与临时仓库并行采集。
- `test/e2e/prompt-enhance.e2e.ts`：按钮位置与窄窗排版、禁用条件、流式预览与 `Ctrl+Z` 一步回原文、芯片保留、悬停/右键浮层选风格与自定义要求、`Alt E` 快捷键、改草稿 / 再点 / `Esc` 取消、没有模型的提示、任务运行中 `Esc` 先取消优化不停止任务。
- `test/prompt-enhance-real-omp.test.ts`（`STUDIO_REAL_OMP=1`）：扩展注册 provider，中英文草稿各一条，语言没变、占位符还在、每次请求没有工具、没有 `sessions/`。
