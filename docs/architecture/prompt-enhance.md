# 提示词优化（输入框的 ✦）

仓库所有者 2026-11-09 批准（调研和方案对比在那次的调研文档里，没有入库）：输入框**发送键左边**一个图标按钮，把草稿交给 omp 用小模型改写得更清楚，结果**直接替换**草稿，`Ctrl+Z` 回到原文。只发草稿，不进会话。界面规则见 `docs/design/spec.md` §4.14「提示词优化」、§5.2 Esc 栈。

## 代码

| 位置 | 作用 |
|---|---|
| `src/shared/prompt-enhance.ts` | 类型（`PromptEnhanceTarget`、`PromptEnhanceResult`）、`canEnhance`（能不能点）、附件占位符的比对 `missingMarkers` |
| `src/main/prompt-enhance/enhance.ts` | `omp -p` 的参数、模板、语言判断、输出清理、结果分类；`chooseModel` 选模型 |
| `src/main/ipc/prompt-enhance-handlers.ts` | IPC `enhancePrompt(target, text, fallback)` / `cancelEnhancePrompt(target)`：校验、定 cwd、读角色、每个输入框同时一次、退出时全部取消 |
| `src/renderer/src/features/composer/use-prompt-enhance.ts` | 发起 / 取消 / 过期判断 / 替换 / 提示；Esc |
| `src/renderer/src/features/composer/EnhanceButton.tsx` | 按钮（`enhance-button`，优化中 `data-busy`、换成转圈） |

## 调用 omp

参数数组、不经 shell：

```
omp -p --no-session --no-tools --no-skills --no-rules --no-context-files --no-title \
    --model <@smol | provider/model> --system-prompt "<模板>"
```

- **草稿走 stdin**（写完关闭），放在 `Draft to rewrite (do not answer it):\n<draft>\n…\n</draft>` 里；命令行里只有模板（`runCommand({ input })`，命令行里的中文和换行在 Windows 上不可靠）。
- **只发草稿和模板**：`--no-tools --no-context-files --no-rules --no-skills` 让 omp 不带工具、AGENTS.md、规则和 skill；不带会话历史、文件、图片。大段粘贴和附件只以占位符（`[Paste #1, +30 lines]`、`[Image #1, 800x600]`、`[File #2, a.ts]`）出现，原文和图片不发。
- **不落会话**（`--no-session`）：实测临时 agent 目录里没有 `sessions/`。这次花费在 provider 账单上；[推测] 不进 `omp stats` 和 studio 的会话费用（stats 是从会话文件同步的），没核实。
- **不带 `--no-extensions`**：studio 自带的 studio-accounts 扩展（`docs/architecture/client-accounts.md`）注册了一批 provider，关掉扩展这些模型就解析不到。代价是 omp 启动时照常加载扩展。
- **cwd**：任务的 cwd（项目 `.omp/config.yml` 的角色照常生效）；草稿页是项目目录，没有项目时是服务进程的中性目录（`serviceCwd()`）。
- 超时 90 秒；取消 = `runCommand` 的 `signal`，结束整个进程树。可执行文件同任务进程（自管 omp 的 bin 放到 PATH 前面）；未打包时 `STUDIO_TEST_ENHANCE_OMP`（JSON `{command, args}`，同 `STUDIO_TEST_COMMIT_OMP`）顶替。

### 模型

- 配了 `smol` 或 `default` 角色（`omp config list` 在 cwd 里读出的 `modelRoles`）：`--model @smol`。smol 没配时 omp 退到显式的 default。角色写法要带 `@`（`--model smol` 报 `Model "smol" not found`）。
- 两个都没配：omp 的 `@smol` 会按内置优先级挑一个模型，常常是没有 key 或没有额度的 provider（实测见下），所以改用界面传来的 **fallback**：任务输入框是任务正在用的模型（进程起来前是要起的那个），草稿页是新任务会用的模型（这个草稿选的，或 omp 自选的默认模型）。TSP 任务的模型有时只有显示名、`provider` 为空，这种拼不出 `provider/model`，不传。
- 读不到配置（omp 还没就绪，或 e2e 里任务进程是假 omp）不挡优化：记一行 WARN，交给 omp 解析 `@smol`。
- 不传 `--thinking`：沿用角色上的 `:level` 后缀。studio 不另设"优化模型"的设置：改 smol 角色就是改它（模型选择器的角色范围）。

### 模板（主进程常量，不开放自定义）

英文指令，按草稿语言写明输出语言：不写明时英文草稿 4 次里 2 次被改写成中文（调研时实测）。要点：不回答、不执行草稿；不加需求和猜测；原样保留路径、标识符、代码、命令、URL、数字、@提及和附件占位符；已经清楚的少改，短的保持短；只输出改写后的文字。

语言判断（`draftLanguage`）：去掉附件占位符、`` `代码` ``、带 `/ . _ \ @ :`、数字或驼峰的词（路径、标识符）之后，汉字占字母类字符 ≥ 30% 算中文，否则英文。"看 src/main/index.ts 里的 createWindow" 算中文。

### 结果

| 结果 | 条件 | 界面 |
|---|---|---|
| `enhanced` | 退出码 0，输出清理后非空，草稿里的附件占位符一个不少（按次数原样比） | 替换草稿 |
| `markers_lost` | 改写结果少了占位符：替换了附件会被 `reconcileDraft` 删掉 | toast `composer.enhance.markersLost` |
| `no_model` | stderr / stdout 有 `No model available` / `No API key` | toast `composer.enhance.noModel` + "设置模型角色"（打开模型选择器的角色范围） |
| `failed` | 其余非 0 退出（取 stderr 的 `error:` 行，没有就最后一行，跳过 `Working...`）、超时、空输出 | toast `composer.enhance.failed`，原话在悬停提示里 |
| `cancelled` | 取消 | 不提示 |

输出清理（`cleanOutput`）：去 ANSI、整段代码围栏、`<draft>` 标签、包住整段的成对引号（`"…"` `'…'` `“…”` `「…」`），去首尾空白；中间的引号和围栏不动。任何失败都不碰草稿。

日志只记结果类型、模型来源（`@smol` / `fallback`）、草稿和结果的字符数、失败时 omp 的错误行；**不记草稿和结果正文**（`security.md`）。

## 界面行为

- **能不能点**：草稿去掉附件占位符后为空，或以 `/` 开头（斜杠命令），按钮禁用；优化进行中总能点（= 停止）。任务运行中也能用：这次调用不碰会话。worktree 被删、输入框禁用时按钮禁用。
- **替换**：聚焦输入框 → `select()` → `document.execCommand("insertText", false, view 文本)`。插入的是 view 文本（占位符已换成芯片的零宽字符写法，`composer-tokens.ts` 的 `buildView`），React 回填的值和文本框里一样，不会重设 `value` 把撤销栈清掉，所以原生 `Ctrl+Z` 一步回到原文、芯片还在（e2e 用大段粘贴的芯片验过）。不自动发送，不弹预览或 diff。
- **过期就丢**：结果回来时草稿已经不是发起时那段，不替换。草稿一变（编辑、发送后清空、换任务）就立刻取消这次调用，转圈停下：结果反正不会用，早点结束进程省一次花费。
- **取消**：再点一次；`Esc`（在 `document` 冒泡阶段听：菜单、弹层已经先处理并 `preventDefault`；输入框的"停止任务"在 `window` 上，排在它后面；过程区里的 `Esc` 照旧写给 omp）；换输入框 / 卸载。主进程同一个输入框（`task:<id>` / `draft:<项目>`）再发起时先取消上一次；退出时（`window/shutdown.ts` 的退出 hook）全部取消。
- **没做**：命令面板项和快捷键（键位没定）；带最近对话做上下文；预览 / diff。

## 实测（omp 18.18.3，2026-11-09，临时 `PI_CODING_AGENT_DIR` / `HOME` / `USERPROFILE`，模型 `.env` 的 `STUDIO_TEST_MODEL` = DeepSeek V4 Flash）

- `modelRoles.default` = 测试模型，`--model @smol`：每次 3–5 秒，stdout 就是改写结果，stderr 只有 `Working...`，退出码 0。
  - `帮我看下登录那块为啥老是报错，截图在这 [Image #1, 800x600]` → `帮我排查一下登录那块为什么老是报错，报错截图见 [Image #1, 800x600]。`
  - `make the login button blue` → `Update the login button's styling so the button is blue. Verify the login button renders blue.`
  - `fix 一下 src/a.ts 的 bug` → `请修复 src/a.ts 里的 bug。`
- 一个角色都没配、`--model @smol`：omp 挑了 `.env` 里有 key 但没有额度的 provider，退出 1，`402 Purchase pre-paid credits…`（归为 `failed`）。所以没配角色时要传 fallback；直接传 `provider/model` 正常返回。
- 取消：运行中的 `omp.exe`（命令行带 `--no-title`）在 abort 后 1.5 秒内消失，没有残留进程。
- agent 目录里只有 `agent.db` / `models.db` / `skill-descriptions.db`（和 `config.yml`），没有 `sessions/`。

## 测试

- `test/prompt-enhance.test.ts`：`canEnhance`、占位符比对、语言判断、`chooseModel`、`cleanOutput`、参数（不含 `--no-extensions`）；对假 omp（`test/fake-omp/fake-omp-print.ts`）：草稿只走 stdin、cwd、围栏清理、`no_model` / `failed` / 空输出 / `markers_lost`、取消结束进程、超时。
- `test/e2e/prompt-enhance.e2e.ts`：草稿页按钮在发送键左边、空草稿和斜杠命令禁用、替换后 `Ctrl+Z` 回到原文、大段粘贴芯片在替换和撤回后都在、生成中改草稿立刻取消（假 omp 进程被结束）、再点 / `Esc` 取消、没有模型时的提示；任务运行中 `Esc` 先取消优化、不停止任务（假 omp 没收到 Esc），运行中照样能替换。
- `test/prompt-enhance-real-omp.test.ts`（`STUDIO_REAL_OMP=1`）：中文、英文草稿各一条，有输出、语言没变、`[Image #1, 800x600]` 还在、没有 `sessions/`。
