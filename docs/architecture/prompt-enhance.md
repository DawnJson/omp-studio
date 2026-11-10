# 提示词优化（输入框的 ✦）

仓库所有者批准（2026-11-09）：输入框**发送键左边**一个图标按钮，把草稿交给 omp 用小模型改写得更清楚，结果**直接替换**草稿，`Ctrl+Z` 回到原文。只发草稿，不进会话。界面规则见 spec §4.14「提示词优化」、§5.2 Esc 栈。

## 代码

| 位置 | 作用 |
|---|---|
| `src/shared/prompt-enhance.ts` | 类型、`canEnhance`（能不能点）、附件占位符比对 `missingMarkers` |
| `src/main/prompt-enhance/enhance.ts` | `omp -p` 的参数、模板、语言判断、输出清理、结果分类；`chooseModel` |
| `src/main/ipc/prompt-enhance-handlers.ts` | IPC `enhancePrompt(target, text, fallback)` / `cancelEnhancePrompt(target)`：校验、定 cwd、读角色、每个输入框同时一次、退出时全部取消 |
| `src/renderer/src/features/composer/use-prompt-enhance.ts` | 发起 / 取消 / 过期判断 / 替换 / 提示；Esc |
| `src/renderer/src/features/composer/EnhanceButton.tsx` | 按钮（`enhance-button`，优化中 `data-busy`、✦ 形变成 ×） |

## 调用 omp

参数数组、不经 shell：

```
omp -p --no-session --no-tools --no-skills --no-rules --no-context-files --no-title \
    --model <@smol | provider/model> --system-prompt "<模板>"
```

- **草稿走 stdin**（包在 `<draft>` 标签里），命令行里只有模板：命令行里的中文和换行在 Windows 上不可靠。
- **只发草稿和模板**：不带工具、AGENTS.md、规则、skill、会话历史、文件、图片。大段粘贴和附件只以占位符（如 `[Image #1, 800x600]`）出现。
- **不落会话**（`--no-session`，实测 agent 目录里没有 `sessions/`）。花费在 provider 账单上；[推测] 不进 `omp stats` 和 studio 的会话费用，没核实。
- **不带 `--no-extensions`**：studio-accounts 扩展（`client-accounts.md`）注册了一批 provider，关掉扩展这些模型就解析不到。
- **cwd**：任务的 cwd（项目 `.omp/config.yml` 的角色照常生效）；草稿页是项目目录，没有项目时是服务进程的中性目录（`serviceCwd()`）。
- 超时见 `ENHANCE_TIMEOUT_MS`；取消 = `runCommand` 的 `signal`，结束整个进程树。可执行文件同任务进程；未打包时 `STUDIO_TEST_ENHANCE_OMP`（同 `STUDIO_TEST_COMMIT_OMP`）顶替。

### 模型

- 配了 `smol` 或 `default` 角色（cwd 里 `omp config list` 的 `modelRoles`）：`--model @smol`（smol 没配时 omp 退到 default）。要带 `@`：`--model smol` 报 `Model "smol" not found`。
- 两个都没配：omp 的 `@smol` 按内置优先级挑，常常挑到没有 key 或没有额度的 provider（见实测），所以改用界面传来的 **fallback**：任务输入框是任务正在用的模型，草稿页是新任务会用的模型。TSP 任务的模型有时 `provider` 为空，拼不出 `provider/model`，不传。
- 读不到配置（omp 未就绪、e2e 里是假 omp）不挡优化：记一行 WARN，交给 omp 解析 `@smol`。
- 不传 `--thinking`，沿用角色的 `:level` 后缀。不另设"优化模型"的设置：改 smol 角色就是改它。

### 模板（主进程常量，不开放自定义）

英文指令，**按草稿语言写明输出语言**：不写明时英文草稿 4 次里 2 次被改写成中文（实测）。要点：不回答、不执行草稿；不加需求和猜测；原样保留路径、标识符、代码、命令、URL、数字、@提及和附件占位符；清楚的少改，短的保持短；只输出改写后的文字。

语言判断见 `draftLanguage`（去掉占位符、代码、路径和标识符后按汉字占比判断）。例："看 src/main/index.ts 里的 createWindow" 算中文。

### 结果

| 结果 | 条件 | 界面 |
|---|---|---|
| `enhanced` | 退出码 0，输出清理后非空，附件占位符一个不少（按次数比） | 替换草稿 |
| `markers_lost` | 少了占位符：替换后附件会被 `reconcileDraft` 删掉 | toast `composer.enhance.markersLost` |
| `no_model` | 输出有 `No model available` / `No API key` | toast `composer.enhance.noModel` + "设置模型角色" |
| `failed` | 其余非 0 退出、超时、空输出 | toast `composer.enhance.failed`，omp 原话在悬停提示里 |
| `cancelled` | 取消 | 不提示 |

输出清理（`cleanOutput`）：去 ANSI、整段代码围栏、`<draft>` 标签、包住整段的成对引号；中间的不动。任何失败都不碰草稿。

日志只记结果类型、模型来源、字符数、失败时 omp 的错误行；**不记草稿和结果正文**（`security.md`）。

## 界面行为

- **能不能点**：草稿去掉占位符后为空、以 `/` 开头（斜杠命令）、worktree 被删、输入框禁用时禁用；优化进行中总能点（= 停止）。任务运行中也能用：这次调用不碰会话。
- **替换**：聚焦 → `select()` → `document.execCommand("insertText", false, view 文本)`。插入 view 文本（占位符已是芯片写法，`composer-tokens.ts` 的 `buildView`），React 回填的值和文本框一致，不会重设 `value` 清掉撤销栈，所以原生 `Ctrl+Z` 一步回到原文、芯片还在。不自动发送，不弹预览或 diff。
- **过期就丢**：结果回来时草稿已经变了就不替换；草稿一变（编辑、发送、换任务）立刻取消调用，省一次花费。
- **取消**：再点一次；`Esc`（在 `document` 冒泡阶段听：菜单、弹层先处理并 `preventDefault`；输入框的"停止任务"在 `window` 上，排在它后面；过程区里的 `Esc` 照旧写给 omp）；换输入框 / 卸载。同一个输入框（`task:<id>` / `draft:<项目>`）再发起时先取消上一次；退出时（`window/shutdown.ts`）全部取消。
- **没做**：命令面板项和快捷键（键位没定）；带最近对话做上下文；预览 / diff。

## 实测（omp 18.18.3，临时 agent 目录 / home，模型 `STUDIO_TEST_MODEL` = DeepSeek V4 Flash）

- `modelRoles.default` 设好、`--model @smol`：每次几秒，stdout 就是结果，stderr 只有 `Working...`，退出码 0。例：`fix 一下 src/a.ts 的 bug` → `请修复 src/a.ts 里的 bug。`
- 一个角色都没配、`--model @smol`：omp 挑了有 key 没额度的 provider，退出 1（`402`，归为 `failed`）；直接传 `provider/model` 正常。所以没配角色时要传 fallback。
- 取消：abort 后进程很快消失，无残留。
- agent 目录里没有 `sessions/`。

## 测试

- `test/prompt-enhance.test.ts`：`canEnhance`、占位符比对、语言判断、`chooseModel`、`cleanOutput`、参数（不含 `--no-extensions`）；对假 omp（`test/fake-omp/fake-omp-print.ts`）：草稿只走 stdin、cwd、各结果分类、取消、超时。
- `test/e2e/prompt-enhance.e2e.ts`：按钮位置、禁用条件、替换后 `Ctrl+Z`、芯片保留、改草稿取消、再点 / `Esc` 取消、没有模型的提示；任务运行中 `Esc` 先取消优化、不停止任务。
- `test/prompt-enhance-real-omp.test.ts`（`STUDIO_REAL_OMP=1`）：中英文草稿各一条，语言没变、占位符还在、没有 `sessions/`。
