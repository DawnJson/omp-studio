# 登录、API key 和模型列表

实现：`src/main/service/`（服务进程、OAuth 登录）、`src/main/omp-manager/api-key-store.ts`、`src/main/ipc/account-handlers.ts`；界面是设置 → Provider 与订阅（`features/settings/ProviderRow.tsx`）。协议出处：omp 文档 `rpc.md`（`get_login_providers`、`login`、`get_logout_accounts`、`logout`，以及 `extension_ui_request` 的 `open_url`/`input`/`notify`）；`environment-variables.md` §1（API key 的变量名）。

## 路线（决策 D3）

- **OAuth**：走 RPC `login {providerId}`，在"服务进程"上发（`omp --mode rpc-ui --no-session`，cwd 是 `userData/service/`，按需启动，空闲 5 分钟关掉，放进应用 Job Object）。`login` 在登录结束时才应答。
- **API key**：omp 对 `secret:true` 的提示一律以失败的 `login` 应答拒绝（`rpc.md` 登录一节），所以 key 不走 RPC。设置页输入的 key 用 Electron `safeStorage`（Windows 是 DPAPI）加密存在 `userData/api-keys.json`（`{version, keys:{<provider id>: base64 密文}}`），之后每次启动 omp 子进程，`getApiKeyEnv()` 把它们解密成环境变量放进 `env`。不用 `--api-key`（命令行在进程列表里看得到），不写 `~/.omp`，终端版看不到这些 key。
  - provider id → 变量名的表在 `src/shared/provider-keys.ts`（出自 `environment-variables.md`；没有写 id 的行按命名推断，标了 [推测]）。表里没有的 provider 不能用这条路线，界面不显示"设置 API key"，主进程也拒绝。
  - 系统没有可用的加密存储时 `saveApiKey` 失败，**不退回明文**。
  - 解不开的条目（换了 Windows 账户、文件被拷走）在注入时跳过，不阻止 omp 启动。
  - key 只进不出：`saveApiKey` 之外没有任何接口、事件、日志带 key；`listApiKeyProviders` 只返回 provider id。
  - omp 只在启动时读环境变量，所以保存/清除 key 后会关掉服务进程；已经在跑的任务进程要等下次启动才带上新 key。

## OAuth 登录流程

1. 界面 `startLogin(providerId)`；主进程确保同一时间只有一个登录，在服务进程上发 `login`，同时监听 `extension_ui_request`：
   - `open_url {url, launchUrl?, instructions?}`：主进程只放行 http/https，用系统浏览器打开 `url`，同时推 `login` 事件 `{type:"open_url"}`；界面显示 `launchUrl ?? url`（`rpc.md` 推荐复制 `launchUrl`，避免 OAuth 参数被截断）、`instructions` 和"重新打开浏览器"。
   - `notify`：推 `{type:"progress", level, message}`（`level` 是 omp 的 `notifyType`，默认 `info`）。界面把它们**按到达顺序全部保留**（`login-progress` 列表，不只显示最后一条），`warning` / `error` 分别用警告色 / 错误色（`data-level`），`info` 用次要色。
   - `input`：推 `{type:"input", inputId}`（`inputId` 就是请求 id）；界面回答走 `answerLoginInput(inputId, value|null)`，主进程只接受仍在等的 `inputId`，回 `extension_ui_response`（`null` = `cancelled:true`）。omp 给的 `timeout`（`login` 固定 600000 ms）**不传给界面、不显示倒计时**：授权码要用户去浏览器授权后再贴回来，10 分钟的上限不是用户能据以决策的数字，倒计时反而制造压力；到点时 omp 发 `cancel`，界面按下一条处理。
   - `cancel {targetId}`（omp 撤销了一个输入：超时或被取消）：如果 `targetId` 是还在等的 `input`，推 `{type:"input_closed", inputId}`，界面收起输入框和"提交"按钮（进度历史保留，没提交的字清掉）；之后不会再出现提交时抛 `no login input is waiting`。
   - 登录用不到的 `select/confirm/editor/ask`：立刻回 `cancelled:true`，免得 omp 一直等。判断和连接层的常驻默认应答共用 `src/main/omp/extension-ui.ts` 的 `cancelledReply`。
   - 登录期间 `login.ts` 通过 `connection.claimExtensionUi()` 认领应答权，连接层的默认应答（`omp-rpc.md`"后台进程对 extension_ui_request 的处理"）不会同时回答同一个请求；登录结束（含失败）释放。
2. `login` 应答 → `startLogin` resolve `{ok:true}`；`RpcCommandError`（含 secret 提示被拒）或服务进程退出 → `{ok:false, message}`，界面显示 `login.failed` 加原因；原因里带 `secret`/`terminal` 时（omp 升级后新增、`provider-login.ts` 表里还没有的多步登录 provider）界面不再给"复制命令"，主按钮改成"在应用内登录"，改走下面"应用内登录"。
3. **取消**：没有公开的取消命令。有未答的 `input` 就回 `cancelled:true`；否则（omp 停在等浏览器回调）关掉服务进程，`login` 随之失败，主进程按"已取消"返回，界面回到空闲。
4. 登录或登出之后界面重新读 provider、账号和模型。

## 登出和状态显示

- 状态：`authenticated` 且有账号 → `login.signedIn · <label>`（多个账号显示 `+N`）；`authenticated` 但没有账号 → 通过环境变量或配置使用（`login.viaEnv`；这是 `get_logout_accounts` 为空推出来的，**契约里 `logout` 不返回 `remainingSource`**）；有自存 key 显示"已设置 API key"。
- `logout`：1 个账号直接退出，多个先让用户选（`login.chooseAccount`）。选择列表里 `LogoutAccount.active` 为 true 的账号（omp 报告它正被使用）带"正在使用"徽标（`login.accountActive`，`account-active-<credentialId>`），让用户知道退出的是正在用的凭据；只有 1 个账号时不弹选择，看不到徽标。
- 退出只影响 omp 自己存的凭据；自存的 API key 用"清除 API key"（`clearApiKey`）。

## 提供商列表：搜索、排序、登录方式

- 列表（`features/settings/ModelsSection.tsx`，纯函数在 `src/shared/ui/provider-list.ts`）：顶部搜索框按名称和 id 过滤（多个词都要命中）；已配置的（omp 报 `authenticated`，或 studio 存了 key）排前面，组内保持 omp 的顺序。
- 登录方式（`src/shared/provider-login.ts`）：`get_login_providers` 只有 `{id, name, available, authenticated}`，**没有登录方式的字段**（实测 omp 18.12.2，84 个 provider 的 `available` 全是 true），所以按实测分类。方法：隔离 agent 目录、`omp --mode rpc-ui --no-session`、对每个 provider 发 `login`，看 open_url 之后 omp 要什么：授权码/等浏览器或设备授权 = `oauth`（17 个）；"Paste your … API key" 输入框 = `api-key`（Tavily、Exa、Kagi、Parallel、DeepSeek 等 60 个）；直接以"requires interactive prompts which are not supported in RPC mode"失败 = `terminal`（github-copilot、alibaba-coding-plan、alibaba-token-plan、perplexity、snowflake、lm-studio）。没在表里的新 provider 按 `oauth` 处理（保留登录按钮，失败有原因）；omp 升级后要重测更新表。
- 界面：`oauth` 显示"登录"；`api-key` 不显示"登录"——有环境变量名（`provider-keys.ts`）的走"设置 API key"（studio 自存），没有的显示"添加 API key"，走 omp 的 `login`（key 存进 omp 的凭据库，输入框不明文显示）；`terminal` 显示"登录"，走"应用内登录"（下面一节），元信息写"多步登录"。

## 模型列表

`listModels` 在服务进程上发 `get_available_models`（会等 omp 后台发现完成），映射成 `ModelOption`（`acceptsImages` = `input` 含 `image`）。新任务的默认模型/思考强度就是 omp 的 `modelRoles.default` / `defaultThinkingLevel`，omp-studio 不另存（omp 的设置就是 omp-studio 的设置）；新任务启动时不传 `--model`/`--thinking`。`modelRoles` 只能整体写（实测 18.12.1：`omp config set modelRoles.default` 报 Unknown setting），所以总是读出角色表只换 `default`；`defaultThinkingLevel` 不接受 `off`，胶囊里不提供。

**智能分和目录速度**（实测 omp 18.12.6，2026-10-22，临时 agent 目录 + 真实 key）：`get_available_models` 回的每个模型除了 wire 类型 `ModelInfo` 列出的字段，还带 omp 从模型目录补好的 `int`（智能分）和 `tps`（输出速度），没有就不带。omp 查目录前按 provider 的各种写法归一（`packages/catalog/src/identity/metrics.ts`），所以中转站（如 `relay-x/claude-fable-5-1`）也能查到；studio 原来自己按 `provider/id` 原样读 `models.db` 的 `model_cache`，同一批模型大多查不到。现在 `toModelOption`（`src/main/tasks/convert.ts`）直接取这两个值（`ModelOption.intelligence` / `catalogTps`，非有限数或 `tps ≤ 0` 当没有），`model-insights.ts` 只读 `agent.db` 的实测速度和压缩设置。启动缓存格式版本因此升到 2。

启动缓存（`src/main/service/startup-cache.ts`，单例在 `startup-cache-instance.ts`）：服务进程每次现读成功（默认模型、`listModels`、各项目的 `getModelDefaults`、`listAccounts` 得出的"有没有 OAuth 凭据"、`tools.approvalMode`）就记进 `userData/startup-cache.json`（原子写，串行）。渲染进程在第一次渲染前取一次 `getStartupSnapshot()`，工具行先用它画，现读到了再替换；缓存只用来显示，不参与任何决定，文件坏了或版本不对当成没有。应用启动时 `prewarmToolbarData()` 就拉起服务进程读默认模型和模型目录。任务进程起来之前，`TaskRunner` 用缓存的模型目录（`knownModel`）给胶囊名字和上下文窗口，查不到才用模型 id。

项目配置（实测 omp 18.12.1，2026-10-18，临时 agent 目录 + 带 `.omp/config.yml` 的临时项目）：

- 项目 `.omp/config.yml` 里有 `modelRoles.default` 时，在这个项目里启动的 omp 用项目的值（`get_state` 返回项目的模型），全局的被盖过。`omp config list` 在项目目录里运行显示项目的值，在别处显示全局的值。
- `omp config set modelRoles` 不管 `modelRoleStorage` 设成什么（全局或项目里设 `project` 都试过），**永远写全局配置**；在项目目录里运行时返回 `overriddenBy: "project"`。`modelRoleStorage` 只影响 omp 终端里模型选择器的保存位置（文档：`project` 时只更新项目 `.omp/config.yml` 的 `modelRoles`；没在 TUI 里实测）。
- RPC 的 `set_model` 只换当前会话的模型，不写任何配置文件（`modelRoleStorage` 为 global 和 project 都试过）。

omp-studio 的做法（`src/main/omp-config/model-defaults.ts`）：

- 读：草稿输入框在**项目目录里**跑 `omp config list --json`（`getModelDefaults(projectId)`），显示这个项目实际会用的默认模型和思考强度；设置页（没有项目）只看全局。
- 写模型角色（`setModelRole(role, model)`；入口是设置 → 模型的角色表、模型选择对话框里点角色后的“应用”）：**一律**经 `omp config set modelRoles` 写全局（先读出全局角色表再改一项，去掉最后一个角色时 `omp config reset modelRoles`）。仓库所有者 2026-10-22 定：给角色指定模型就是全局的事；项目 `.omp/config.yml` 自带 `modelRoles.<role>` 的项目照旧用项目的值（omp 的覆盖规则），omp-studio 不写项目文件。2026-10-18 到 10-22 曾在生效的 `modelRoleStorage` 是 `project` 时改项目文件，已去掉；`modelRoleStorage` 只影响 omp 终端的模型选择器，设置页里它在“高级”。
- 草稿胶囊里改模型 / 思考强度（“用于此任务”、`Alt T`）**不写配置**：选择按草稿键记在渲染进程内存里（`composer/draft-model-choice.ts`），发第一条时随 `createTask({ model, thinkingLevel })` 进任务记录，任务以 `--model` / `--thinking` 起 omp，只对这个会话生效；没改的项不传，跟 omp 的默认值。实测（2026-10-22，omp 18.12.6，`test/e2e/model-picker.e2e.ts`）：配置里 `default: table-local/table-one`，草稿里选 table-two + high 发第一条，任务胶囊是 table-two·high，`config.yml` 没变，新草稿回到 table-one。
- 写思考强度：`omp config set defaultThinkingLevel`，永远是全局（omp 也只有角色走 `modelRoleStorage`）；入口只有设置 → 模型。

## 角色和备用模型的候选

omp 的角色（读源码 omp 18.12.6 `packages/coding-agent/src/config/model-roles.ts` 的 `MODEL_ROLES`，没逐个实测）分两类：对话角色 default、smol、slow、vision、plan、commit、tiny、memory、task、advisor、widget（选对话模型；tiny、memory 也收 tiny 类的小模型）；特定能力的角色 image、web、speech、dictation、judge（分别选生图、搜索服务、语音合成、语音识别、评判模型，judge 也收 tiny 和对话模型）。`modelRoles` 里别的名字是自定义角色，当对话角色。设置 → 模型按这个分两组列出全部角色，模型选择对话框的角色范围只列对话角色（特定能力的角色不选对话模型）。

- 对话模型照旧来自服务进程的 `get_available_models`（受 `enabledModels` 限制）。别的类别 RPC 里没有，要跑 `omp models --kind all --json`（`listRunnerModels`，`src/main/ipc/account-handlers.ts`，解析在 `src/shared/omp-output/models.ts`，只留 `kind` 不是 `chat` 的）。实测（omp 18.12.6，2026-10-22，临时 agent 目录、没有任何凭据）：stdout 只有一行 `{"models":[{provider,kind,id,selector,name,...}]}`，按 provider、id 排好；`kind` 有 chat、tiny、search、image、tts、stt、judge 等；没登录也列出 `web/*` 的二十多个搜索服务（brave、exa、tavily、duckduckgo...）、`local/*` 的 tiny 和语音模型；`models.yml` 校验失败时的警告写 stderr，不混进 JSON。这条命令会刷新没缓存的 provider 目录（联网），超时 60 秒；渲染进程打开模型页或角色 / 备用链编辑器时读一次、留缓存，读不到时只影响特定能力那组的候选。
- 候选按角色筛（`src/renderer/src/features/settings/role-options.ts`）：角色 → 能用的类别（`composer/model-groups.ts` 的 `roleKinds`）→ 那些类别的模型。`retry.fallbackChains` 的 key 可以是角色、`provider/model` 或 `provider/*`：角色按角色筛；具体模型按它的类别；`provider/*` 按那个 provider 有的全部类别；认不出的当对话模型。设置页的角色表和搜索里 `modelRoles` / `retry.fallbackChains` 的“编辑…”对话框用同一份候选。
- 备用模型（`retry.fallbackChains.<角色>`）是请求出错时依次换用的列表，和 `modelRoles` 的值里用逗号分开的多个选择器不是一回事（后者是“第一个能用的”，omp 文档 `docs/models.md`）。omp 的默认值是空对象；移除一个角色的最后一个备用模型时整条 key 去掉，不留空列表。

## 没有实测的

实现时没有真实账号可登录，下面都没跑过真实 OAuth：`open_url` 之后 `input` 的实际时机、取消时关闭服务进程后 `login` 应答的形状、secret 提示被拒的错误文案（所以"改走应用内登录"的判断是按关键词，可能漏）。截图里的 provider 列表来自 omp 18.12.1（`get_login_providers`，隔离的临时 agent 目录，全部未登录）。应用内登录的实测和没实测的部分见下一节。

## 应用内登录（终端类 provider）

实现：`src/main/login/terminal-login.ts`（逻辑，不 import electron）、`terminal-login-instance.ts`（单例、Electron 接线）、`src/shared/tsp/login-flow.ts`（从文档判断结果）；界面 `features/settings/TerminalLoginBody.tsx` + `ProviderFlowDialog.tsx`。实测 omp 18.12.6，2026-10-23。

### 为什么要一个临时 omp

`github-copilot`、`alibaba-coding-plan`、`alibaba-token-plan`、`perplexity`、`snowflake`、`lm-studio` 的登录要多步交互（企业域名、区域、设备码、选登录方式……），rpc-ui 的 `login` 直接以 "requires interactive prompts which are not supported in RPC mode" 拒绝，只有交互式 omp 里的 `/login <provider>` 走得完。所以应用起一个临时的交互式 omp（和任务同一套 TSP：握手、文档、关进程树），发 `/login <provider>`，用过程区的渲染器画 omp 自己的登录窗，结果出来就关进程。

### 主进程

- 入口 `startTerminalLogin(providerId)` / `cancelTerminalLogin()`（`StudioInvokeApi`，`account-handlers.ts`）。`providerId` 不可信：`TerminalLogin.start` 先在 omp 的登录 provider 列表（服务进程的 `get_login_providers`）里查，不在就 reject `unknown login provider`，**不起进程**（`test/terminal-login.test.ts` 用 `nope`、`github-copilot --model x`、`../../x`、大小写不同、带换行的 id 验证；`settings-functional.e2e.ts` 的用例对真实 IPC 断言同样的拒绝）。
- 临时 omp：`buildTspLaunch({ cwd, noSession: true })`——同一个 omp 可执行文件、同一套 PATH 和 studio 自存 key 的环境变量，参数多一个 `--no-session`（不在用户的会话目录留会话文件；探针跑完 `~/.omp/agent/sessions` 里没有当天新建的目录）。cwd 是 `userData/login-cwd`（studio 自己的空目录，不是任何项目，omp 不会读到项目配置）。**`PI_CODING_AGENT_DIR` 不动**：登录就是要把凭据写进用户真实的 agent 目录，由 omp 自己写（AGENTS.md "omp 的边界"：只经 omp 修改 `~/.omp`，studio 不碰凭据）。首次运行引导（`startup.setupWizard`）照任务的做法等启动默认写完再起。
- 进程管理全部复用 `TspSession`：node-pty 自带 ConPTY（`useConptyDll`）、`assignToOwnJob`（主进程被强杀时系统回收）、关闭时 `taskkill /T /F` 等退出事件再 `pty.kill()`、spawn / kill 都在 `withPtyLock` 里。退出入口：对话框取消（`cancelTerminalLogin`）、被新的登录顶掉、应用退出（`registerShutdownHook`，经 `window/shutdown.ts`，托盘退出 / 菜单退出 / 安装更新 / 注销都会走）。结果（`start` 的 Promise）在进程关掉**之后**才 resolve。
- 同一时间一个登录：`start` 遇到还没结束的旧登录先结束它（渲染进程重载后旧对话框没了，不能被挡住）。
- 启动：等握手（30 秒超时，`TspHandshakeError`）→ 等输入框就绪（`findMessageTarget` 是 `ready`，30 秒超时）→ 发 `send` 事件 `/login <providerId>`（和任务发话同一条路径）→ 每次文档变化用 `deriveLoginFlow` 判断。omp 在握手前退出：失败，原因是 omp 终端上最后几行文字或退出码。
- 成功后 `serviceOmp.close()`：凭据是别的进程写进去的，服务进程里 omp 缓存的认证状态是旧的（同保存 API key 后的 `applyKeyChange`），下次用时重启读到新的；界面随后重读 provider、账号和模型。已经在跑的任务进程要等下次启动才用上新凭据（和终端版一样）。

### 渲染进程怎么画、怎么交互

- 登录窗的节点树和用户操作走**现有 TSP 通道**，不加第二套：登录会话用固定的"任务 id" `TERMINAL_LOGIN_ID`（`"terminal-login"`，`shared/ipc.ts`），主进程在 `getTspSnapshot` / `sendTspEvent` / `sendTspKeys` 里按它路由到 `TerminalLogin`（任务池不认识它），批次经 `tspBatch` 事件推（序号规则同任务：每个进程结束后序号往后让一格，渲染进程手里的旧镜像发现丢帧就重拉快照）。preload 只多暴露 `startTerminalLogin`、`cancelTerminalLogin` 两个函数。
- `TerminalLoginBody` 只画那个会话的 `layer`（`TspChildren`），对话区（main）、dock、toast 不画；每次打开 / 重试先 `dropTspDocument` 再 `ensureTspDocument`（新进程，镜像从空开始），卸载时丢掉。omp 的弹窗是盖在过程区上的绝对定位浮层，`providers.css` 的 `.pv-terminal` 把它摊平成对话框正文：去掉遮罩、阴影、omp 自带的标题（对话框标题是 provider 名），并隐藏 omp 自己的 Cancel 按钮（页脚的"取消"是同一件事）。
- 点击和输入：按钮发 `action`、输入框发 `edit` / 按键字节，都经 `sendTspEvent` / `sendTspKeys`；主进程拒绝 `send` 事件（登录窗不需要，放行就是让渲染进程把临时 omp 当成可以提问的会话）。链接：`omp.btn` 的 `open` 动作走 `openHref` → `openExternal`（主进程只放行 http / https）。
- 取消 / 关闭对话框（取消按钮、Esc、×）= `cancelTerminalLogin` = 结束进程；`start` 以 `cancelled` 结束，对话框直接关。渲染进程自己重载时旧进程不会被自动结束（对话框没了，没人调 cancel），它跑到 omp 自己结束（设备码过期会以失败结束）、被下一次 `start` 顶掉或应用退出为止。

### 实测：`/login github-copilot`（omp 18.12.6，临时 agent 目录，没有账号）

方法：`TspSession` 驱动真实 omp（`--no-session`，`PI_CODING_AGENT_DIR` 指向临时目录，`PI_TUI_TSP_RECORD` 录制），`send` `/login github-copilot`，再用 `action` 事件点按钮。录制裁进 `fixtures/tsp/login-github-copilot.jsonl`（设备码换成 GitHub 文档里的示例 `WDJB-MJHT`；录制里相邻帧间隔超过 400 ms 的压到 400 ms）和 `login-failed.jsonl`。

1. `/login github-copilot` 之后：main 里一个 status toast `Logging in to github-copilot…`，layer 里一个 modal `overlay`（`role: omp.overlay.login`，`head: Sign in to GitHub Copilot`，`size: md`），里面 `omp.login.body` → `omp.login.prompt`（`omp.login.label` 文字 `GitHub Enterprise URL/domain (blank for github.com)`）→ 一个 `input` 节点（`placeholder: company.ghe.com`，focus 在它上），底下 `omp.actions` 行：`cancel`（`actions.click: cancel`）和 `submit`（`Continue`，`tone: accent`），都是 `omp.btn`。
2. 空着点 `Continue`（`action act=submit id=r.^sheet/0/actions/submit`）：输入框步骤被删，body 里出现 `omp.login.lead`（"Enter this code on the sign-in page to connect your account."）、`omp.login.code`（row，`actions.click: copy`，`href` = 设备码，`title: Copy code`）、`omp.login.link`（`omp.login.url` 文字 `https://github.com/login/device`，旁边一个 `copyLink` 按钮，`copy` 动作，`href` = 链接）、`omp.login.status` → `omp.login.waiting`（spinner "Waiting for you to finish in the browser…"）；actions 行多一个 `openLink`（`Open sign-in page`，`actions.click: open`，`href`，`tone: accent`），`submit` 被删。设备码是 GitHub 真实发的（联网，不需要账号）。
3. 点 `cancel`（或 Esc）：同一帧里 `set` 已有的 status toast 文字为 `Login cancelled`（**不是新增**，所以 `statusNotes` 里没有它），登录窗和 `r` 一起被删，omp 输入框（`omp.editor`）恢复。进程不退出。
4. 失败（`HTTPS_PROXY` 指向关闭的端口，Continue 之后）：同一帧里 main 末尾多一个 text `Error: Login failed: ECONNREFUSED: Unable to connect. Is the computer able to access the url?`（`s: error`），登录窗被删，输入框恢复。进程不退出。
5. 其他五个 provider 的第一步（只发 `/login`，看登录窗的 `omp.login.label`）：`lm-studio` "Optional: Paste LM Studio API key (to customize endpoint URL, set LM_STUDIO_BASE_URL env var)"；`perplexity` "Login method: sso (browser) or email; blank for sso"（同时有一行 `omp.login.waiting`）；`snowflake` "Enter your Snowflake account identifier or URL"；`alibaba-coding-plan` "Select Alibaba Coding Plan endpoint: 1=International (default), 2=China, 3=Custom — enter 1, 2, or 3"；`alibaba-token-plan` 同样的区域选择。都是 `input` 节点 + Continue / Cancel，和 github-copilot 同一个结构。

### 结果判断（`deriveLoginFlow`）

- `running`：有 `overlay`、role 以 `omp.overlay.login` 开头；`success`：任何 text 节点含 `Successfully logged in to`；`failed`：text 节点含 `Login failed:`，原因取它后面的文字；`cancelled`：status toast 文字是 `Login cancelled`；否则 `idle`。结果优先于 `running`（结果文字和关窗同帧）。
- 登录窗开过、之后没了、又没有任何结果文字（omp 措辞变了）：宽限 1.5 秒后以失败结束（"omp closed the sign-in window without reporting a result"），不让对话框空着。
- **成功的帧没有实测**（没有真实账号，也不能真的登录）：文字出自 omp 18.12.6 源码 `selector-controller.ts` 的 `#b`（`ctx.present` 一行 "<图标> Successfully logged in to <provider>[ as <账号>]" 和 "Credentials saved to <路径>"，再关登录窗；凭据在 `oauth.login` 返回时已经写进 agent.db，`refreshProvider` 也在这行文字之前）。单测里的成功帧是把失败录制的结果帧里那行错误文字换成这行文字（`test/tsp-login-flow.test.ts`、`test/terminal-login.test.ts`），不是录制。omp 改了这行文字，成功会被当成"登录窗关了没结果"报失败；界面重读 provider 状态后列表仍然是对的。

### 没实测的

- 成功帧（见上）、`perplexity` / `snowflake` / `lm-studio` / `alibaba-*` 第一步之后的步骤（只实测了每个的第一屏）；omp 在设备码页是否自己也去开系统浏览器（源码里登录窗的第四个构造参数 `hm` 会在 `showAuth` 时被调用 [推测：就是开浏览器]）——开了的话用户点 `Open sign-in page` 会多开一次，无害。
- 渲染进程重载时旧登录进程的清理（见上，没有自动结束）。

## 已知风险：API key 会被 agent 执行的命令继承

自存的 key 以环境变量传给 omp 进程，omp 起的 bash 等子进程默认继承环境，所以 agent 执行的命令能读到它们。已查 `omp://providers.md`、`omp://secrets.md`、`omp://environment-variables.md`：没有"只给 provider 用、不下传给工具"的注入方式（`secrets.md` 的脱敏只处理发给模型的文本，不限制进程环境；`omp config set` 写进 `agent.db` 是另一条路，要碰 `~/.omp`，违反决策 D3）。所以保持现状，不改实现。用户要避免时：用 OAuth 登录，或不要在 omp-studio 里存 key，改在 omp 自己的配置里设置。保存时已拒绝含控制字符的 key。

## 服务进程的关闭

`serviceOmp.close()`（`IdleOmp.close()`）会递增代号：启动到一半（准备参数、等 ready）时被关掉的进程在 ready 后自己关闭并报错；放进 Job Object 失败的进程立刻关闭，不留下没有兜底的进程。

## 自定义模型（第三方 API 提供商）：omp 没有写 `models.yml` 的接口

实测/查证（omp 18.12.1，2026-10-18）：

- 自定义 provider 只能写在 `<agent 目录>/models.yml`（`omp://models.md`）：`providers.<id>` 下有 `baseUrl`、`apiKey`（环境变量名或字面量，`!命令` 取密钥）、`api`、`auth`、`models[]`（`id`、`name`、`contextWindow`、`maxTokens`、`reasoning`、`input`、`cost`…）和 `discovery`。非法文件时 omp 退回内置模型，错误经 `ModelRegistry.getError()` 暴露。
- **写入接口：没有。** 查过：`omp config`（只有 `list/get/set/reset/path/init-xdg`，键必须是设置 schema 里的，`models.yml` 不是设置）；RPC wire schema 的全部命令（`rpc-wire.generated.ts`，没有任何 provider/models 的增删改；只有 `get_available_models`、`get_login_providers`、`login`、`logout`）；`omp models`（只有 `ls/find/refresh`）；`--config <overlay>`（是 `config.yml` 风格的设置叠加层，不含 `providers`）。文档里唯一的"程序化"入口是扩展 API `pi.registerProvider(...)`（进程内注册，不落盘）。
- 读：`omp models --json` / RPC `get_available_models` 能读到最终合并后的模型列表（含自定义的），但不暴露 `models.yml` 的原文，也不暴露 transport `api`。
- 按 `AGENTS.md`「omp 的边界」（omp 的设置就是 omp-studio 的设置，只经 omp 写），没有写入接口原本不该写 `models.yml`；仓库所有者 2026-10-18 在四个方案（直接改 `models.yml` / 只生成 YAML 片段 / 给 omp 提 PR / 自带扩展）里选了**方案 1：omp-studio 直接改 `models.yml`**，作为和"项目 `.omp/config.yml` 的 `modelRoles`"同一类的第二个例外。实现、校验、key 存法、一键拉取、保存后 omp 如何重新加载（实测：只在启动时读，同进程里改了不生效）见 `custom-models.md`。

## 界面（3.2）

设置 → Provider 与订阅只列"已连接"（`ProviderRow` 卡片：provider 的单色 logo（`ProviderLogo.tsx`，图形拷自 LobeHub Icons，没有的写首字母）+ 徽标 + sm 按钮，清除 key 在 ⋯ 里）和自定义提供商；没连接的不铺开，页头"连接提供商…"打开 `ProviderPickDialog`（可搜索），选中后进 `ProviderFlowDialog`——OAuth 进度、授权码 / API key 输入、选账号退出、失败重试都在这一个对话框里走。IPC 和登录行为不变。
