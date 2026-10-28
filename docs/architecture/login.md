# 登录、API key 和模型列表

实现：`src/main/service/`（服务进程、OAuth 登录）、`src/main/login/api-key.ts`（API key）、`src/main/ipc/account-handlers.ts`；界面是设置 → Provider 与订阅（`features/settings/ProviderRow.tsx`）。协议出处：omp 文档 `rpc.md`（`get_login_providers`、`login`、`get_logout_accounts`、`logout`，以及 `extension_ui_request` 的 `open_url`/`input`/`notify`）；`environment-variables.md` §1（API key 的变量名）；`omp auth --help`（`omp auth import`，omp 18.10.0 起有）。

## 路线（决策 D3）

- **OAuth**：走 RPC `login {providerId}`，在"服务进程"上发（`omp --mode rpc-ui --no-session`，cwd 是 `userData/service/`，按需启动，空闲 5 分钟关掉，放进应用 Job Object）。`login` 在登录结束时才应答。
- **API key**：omp 对 `secret:true` 的提示一律以失败的 `login` 应答拒绝（`rpc.md` 登录一节），所以 key 不走 RPC，走 omp 自己的命令 `omp auth import -`：主进程把 `{"version":1,"credentials":[{"provider":<id>,"credential":{"type":"api_key","key":<key>}}]}` 写进 stdin（不进命令行），key 存进 omp 的凭据库（`agent.db`），和终端版共用。2026-10-24 起（仓库所有者批准）；之前是 studio 用 safeStorage 加密存在 `userData/api-keys.json`、启动 omp 时注入环境变量，已整段删除，旧文件不迁移、不读。
- **key 已在 `.env` 里时**：omp 18.12.6 实测（临时 agent 目录，`omp token tavily` / `omp token anthropic`）：agent 目录 `.env` 里有 `TAVILY_API_KEY`（或 `ANTHROPIC_API_KEY`），再用 `omp auth import` 存一个 key，omp 用的仍是 `.env` 的；去掉 `.env` 才用凭据库里的。所以 omp 实际用的 key 变量（`providerKeyEnv`，见下面"能填 key 的 provider"）写在 agent 目录 `.env` 里时，"设置 API key"改写 `.env` 那一行（`env-file.ts` 的 `setEnvKey`，写法同自定义 provider 的 `.env`：只改这一行、留 `.env.bak`、原子写），不存凭据库；对话框说明写"替换 agent 目录 .env 里的 {变量}"（`login.apiKey.noteEnvFile`）。变量设在系统（进程）环境变量里时 studio 不能改，照旧存凭据库，说明写"这里存的不生效"（`login.apiKey.noteSystem`）。2026-10-24 起，仓库所有者批准。
  - 实测 omp 18.12.6（临时 `PI_CODING_AGENT_DIR`）：同一 provider 再导入一次，旧的 API key 被替换，OAuth 凭据保留；导入后是 `get_logout_accounts` 里一条 `type: "api_key"`、标签 `API key #<n>` 的账号，`logout` 它只删这条；同一个 rpc-ui 进程的 `get_login_providers` 不会马上把它算成 `authenticated`（`get_logout_accounts` 能看到），所以保存后关掉服务进程；不认识的 provider id 它也照收，所以主进程先按 `acceptsApiKey` 拒绝。
  - 能填 key 的 provider（`acceptsApiKey`，`src/shared/provider-keys.ts`）：omp 认它的 key 环境变量（表出自 `environment-variables.md`；没有写 id 的行按命名推断，标了 [推测]），或者它在 omp 里的登录就是粘贴 key（`provider-login.ts` 的 `api-key`）。一个 provider 可以认几个变量（主名在前，文档写的 fallback / 别名在后，如 Hugging Face 的 `HUGGINGFACE_HUB_TOKEN`、`HF_TOKEN`），omp 取第一个设了的：实测 omp 18.12.6（临时 agent 目录，`omp token huggingface`）：`.env` 只有 `HF_TOKEN` 时回 `HF_TOKEN` 的值（凭据库里另存了 key 也一样）；两个都写时回 `HUGGINGFACE_HUB_TOKEN` 的；`.env` 去掉后才回凭据库的。所以 studio 按同样的先后算"实际用的变量"（`providerKeyEnv`）：主进程 `apiKeyEnvSources` 一次查出所有 provider 的变量设在哪，和提供商列表一起读（`accounts-store.ts`），卡片元信息写这个变量，"设置 API key"打开时说明就是对的（2026-10-25 前对话框打开后才异步查主名：先闪一下"存进凭据库"，`HF_TOKEN` 写在 `.env` 时还会存进凭据库、被 `.env` 盖住），保存改写这个变量那一行。已经有 key（`.env` 里或凭据库里）时输入框占位写"留空保持不变"（`login.apiKey.keepStored` / `custom.form.key.envValue.keep`）。
  - 空 key、带控制字符的 key 在起 omp 之前拒绝；`omp auth import` 失败时报错里的 key 原文换成 `***`。
  - key 只进不出：`saveApiKey` 之外没有任何接口、事件、日志带 key。
  - 已经在跑的任务进程什么时候用上新 key 没有实测 [推测：omp 每次请求从凭据库取，可能马上生效]。

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

- 状态（2026-10-24 起徽标按凭据来源分）：有 `type: "oauth"` 账号 → `已登录`（`login.badge.signedIn`），元信息是账号名（多个账号显示 `+N`）；只有 `type: "api_key"` 账号（设置页或终端 `/login` 粘贴的 key，标签 `API key #<n>`）→ `已设置 key`（`login.badge.key`）；`authenticated` 但凭据库里没有账号 → `已配置`（`login.badge.configured`，元信息 `login.badge.env` + 变量名）：key 来自环境变量、agent 目录的 `.env` 或 `models.yml` 的 `apiKey`。这一条是 `get_logout_accounts` 为空推出来的，**契约里 `logout` 不返回 `remainingSource`**。实例：开发机 `~/.omp/agent/.env` 里写了 `HF_TOKEN`、`TAVILY_API_KEY`、`EXA_API_KEY`，这三张卡片就是"已配置"，不是登录过。
- 元信息里的变量名来自 `shared/provider-keys.ts` 的表；搜索服务 `tavily` / `exa` / `kagi` / `parallel` 2026-10-24 起也在表里（omp 文档 `environment-variables.md` §3），之前这四张卡只写 `环境变量`。实测（omp 18.12.6，真实配置只读，`omp -p --no-session --tools web_search` + 一次性 `--config` 把 `modelRoles.web` 定成 `web/tavily`、`retry.fallbackChains.web: []`）：key 只在 agent 目录 `.env` 的 `TAVILY_API_KEY` 时，内置 `web_search` 走 Tavily（结果 `provider: tavily`、`authMode: api_key`），和装没装 Tavily 的 MCP 服务器无关。
- `logout`：1 个账号直接退出，多个先让用户选（`login.chooseAccount`）。选择列表里 `LogoutAccount.active` 为 true 的账号（omp 报告它正被使用）带"正在使用"徽标（`login.accountActive`，`account-active-<credentialId>`），让用户知道退出的是正在用的凭据；只有 1 个账号时不弹选择，看不到徽标。
- 清除 API key 就是退出那条 `api_key` 账号：只有 key 账号时按钮写 `清除 key`（`login.apiKey.remove`），有 OAuth 账号时写 `退出登录`。只有环境变量 / 配置文件的没有退出按钮。

## 内置 magpie 插件：第三方客户端账号

`src/main/client-accounts/`（设计、注册出来的 provider 列表和实测见 `client-accounts.md`）：studio 内置 magpie 社区的账号插件，包在一个 omp 扩展里，启动时写进 omp 的扩展目录 `<agent 目录>/extensions/studio-accounts/`，omp 的每个进程（studio 起的和终端里的）自动加载。扩展按每个插件自己的声明在 omp 里注册带 `oauth` 的 provider（`qoder-cn`、`workbuddy`、`trae-cn`、`kiro`……），所以它们和别的 provider 一样出现在上面的列表里，登录走同一条 RPC `login`（`onAuth` → `open_url`、`onProgress` → `notify`），凭据进 omp 自己的 agent.db；登录后 omp 自己 `refreshProvider` 重新发现模型。

和本文其余部分不同的两点：它们的请求不走 HTTP provider，而是扩展注册的自定义 `api`（内部按模型转成 omp 自带的 OpenAI Chat、Anthropic Messages 或 OpenAI Responses 流）；只暴露不用打字的登录（浏览器、设备码、免账号；PAT、手机号、企业域名在 RPC 登录里收不到，"读桌面版登录"会读别的应用的文件，都没接）。

## 提供商列表：搜索、排序、登录方式

- 列表（`features/settings/ProvidersSection.tsx`，纯函数在 `src/shared/ui/provider-list.ts`）：顶部搜索框按名称和 id 过滤（多个词都要命中）；已配置的（omp 报 `authenticated`）排前面，组内保持 omp 的顺序。
- 登录方式（`src/shared/provider-login.ts`）：`get_login_providers` 只有 `{id, name, available, authenticated}`，**没有登录方式的字段**（实测 omp 18.12.2，84 个 provider 的 `available` 全是 true），所以按实测分类。方法：隔离 agent 目录、`omp --mode rpc-ui --no-session`、对每个 provider 发 `login`，看 open_url 之后 omp 要什么：授权码/等浏览器或设备授权 = `oauth`（17 个）；"Paste your … API key" 输入框 = `api-key`（Tavily、Exa、Kagi、Parallel、DeepSeek 等 60 个）；直接以"requires interactive prompts which are not supported in RPC mode"失败 = `terminal`（github-copilot、alibaba-coding-plan、alibaba-token-plan、perplexity、snowflake、lm-studio）。没在表里的新 provider 按 `oauth` 处理（保留登录按钮，失败有原因）；omp 升级后要重测更新表。
- 界面：能填 key 的（`acceptsApiKey`）都有"设置 API key"（已有 `api_key` 账号时是"更换 key"），走 `omp auth import`；`oauth` 另有"登录"；`terminal` 显示"登录"，走"应用内登录"（下面一节），元信息写"多步登录"。`api-key` 类不再走 omp 的 `login`（2026-10-24 起和"设置 API key"合并）。

## 模型列表

`listModels` 在服务进程上发 `get_available_models`（会等 omp 后台发现完成），映射成 `ModelOption`（`acceptsImages` = `input` 含 `image`）。新任务的默认模型/思考强度就是 omp 的 `modelRoles.default` / `defaultThinkingLevel`，omp-studio 不另存（omp 的设置就是 omp-studio 的设置）；新任务启动时不传 `--model`/`--thinking`。`modelRoles` 只能整体写（实测 18.12.1：`omp config set modelRoles.default` 报 Unknown setting），所以总是读出角色表只换 `default`；`defaultThinkingLevel` 不接受 `off`，胶囊里不提供。

**智能分和目录速度**（实测 omp 18.12.6，2026-10-22，临时 agent 目录 + 真实 key）：`get_available_models` 回的每个模型除了 wire 类型 `ModelInfo` 列出的字段，还带 omp 从模型目录补好的 `int`（智能分）和 `tps`（输出速度），没有就不带。omp 查目录前按 provider 的各种写法归一（`packages/catalog/src/identity/metrics.ts`），所以中转站（如 `relay-x/claude-fable-5-1`）也能查到；studio 原来自己按 `provider/id` 原样读 `models.db` 的 `model_cache`，同一批模型大多查不到。现在 `toModelOption`（`src/main/tasks/convert.ts`）直接取这两个值（`ModelOption.intelligence` / `catalogTps`，非有限数或 `tps ≤ 0` 当没有），`model-insights.ts` 只读 `agent.db` 的实测速度和压缩设置。启动缓存格式版本因此升到 2。

启动缓存（`src/main/service/startup-cache.ts`，单例在 `startup-cache-instance.ts`）：服务进程每次现读成功（默认模型、`listModels`、各项目的 `getModelDefaults`、`listAccounts` 得出的"有没有 OAuth 凭据"、`tools.approvalMode`）就记进 `userData/startup-cache.json`（原子写，串行）。同一个文件还记着 `omp --version` 的结果（按可执行文件的路径、大小、修改时间；文件没变就不再跑，见 omp-install.md）和按目录的斜杠命令列表（见 composer-input.md），它们不在 `StartupSnapshot` 里。渲染进程在第一次渲染前取一次 `getStartupSnapshot()`，工具行先用它画，现读到了再替换；文件坏了或版本不对当成没有。主窗口第一次淡入完成后（`main-window.ts` 的 `afterFirstReveal`）`prewarmToolbarData()` 才读默认模型和模型目录，不和首帧抢 CPU。任务进程起来之前，`TaskRunner` 用缓存的模型目录（`knownModels`）给胶囊名字和上下文窗口，查不到才用模型 id；进程起来后服务进程的目录还没读到时，输入框上的模型名也先按它认（模型、思考档位），目录读到后换成现读的（见 tsp-migration.md 的 `model` 一行）。是不是唯一的模型、要不要记进任务记录仍只按读到的目录判断。

**模型目录和默认模型缓存优先**（2026-10-28 起，`service/default-model.ts`；之前每次启动、每次任务启动、每次草稿挂载都问服务进程，服务进程不在就起一个，约 600 MB、几秒 CPU，omp 18.13.3）：读到时连同 omp 输入的指纹一起记（`catalogStamps`，`service/input-stamp.ts`：studio 版本（自带 studio-accounts 扩展注册 provider）+ omp 版本 + 系统环境里各内置 provider 的 key 变量的摘要（不存原值）+ agent 目录 `config.yml` / `config.yaml`、`models.yml`、`.env` 的修改时间）。

- 缓存优先（指纹对得上、模型目录非空就直接用，不碰服务进程）：启动预读、任务启动（`TspRunner.#refreshCatalog(false)`）、新任务默认值、草稿和起进程前的输入框（`getDefaultModel`、`listModels(false)`）。缓存里两样都有、输入没变时，启动不起服务进程。
- 一定现读：打开模型选择器（任务的 `listTaskModels`、草稿的 `listModels(true)`、`/model`）、设置页（`accounts-store.ts`）、omp 设置里改了模型相关项（`onOmpConfigChanged`，重载后）。`listModels(true)` 同时现读默认模型并推 `defaultModel` 事件；现读的目录和记着的不一样时默认模型也作废。新登录的 provider 的模型在选择器里一打开就有。
- 作废（`StartupCache.forgetCatalog`，值留着给胶囊显示，下次读现读）：OAuth 登录成功、退出账号；凭据和模型注册表在服务进程之外变了的（应用内登录、保存 API key、自定义 provider 的保存 / 删除 / 覆盖、`omp models refresh`）走 `reloadServiceModels()`，作废并关掉服务进程。作废之前已经开始的读（`catalogGeneration`）结果晚到也不记，不会把登录前的目录当成现成的。
- 盲区：终端里登录、OAuth 过期（凭据库 `agent.db` 一直在写，实测 omp 18.13.3 有任务在跑时 `agent.db-wal` 几秒就改一次，不进指纹）、provider 的在线目录变了，要等打开模型选择器或上面的作废。
- 测试：`test/model-catalog-cache.test.ts`（数服务进程被用的次数）、`test/startup-cache.test.ts`。

项目配置（实测 omp 18.12.1，2026-10-18，临时 agent 目录 + 带 `.omp/config.yml` 的临时项目）：

- 项目 `.omp/config.yml` 里有 `modelRoles.default` 时，在这个项目里启动的 omp 用项目的值（`get_state` 返回项目的模型），全局的被盖过。`omp config list` 在项目目录里运行显示项目的值，在别处显示全局的值。
- `omp config set modelRoles` 不管 `modelRoleStorage` 设成什么（全局或项目里设 `project` 都试过），**永远写全局配置**；在项目目录里运行时返回 `overriddenBy: "project"`。`modelRoleStorage` 只影响 omp 终端里模型选择器的保存位置（文档：`project` 时只更新项目 `.omp/config.yml` 的 `modelRoles`；没在 TUI 里实测）。
- RPC 的 `set_model` 只换当前会话的模型，不写任何配置文件（`modelRoleStorage` 为 global 和 project 都试过）。

omp-studio 的做法（`src/main/omp-config/model-defaults.ts`）：

- 读：草稿输入框在**项目目录里**跑 `omp config list --json`（`getModelDefaults(projectId)`），显示这个项目实际会用的默认模型和思考强度；设置页（没有项目）只看全局。
- 写模型角色（`setModelRole(role, model)`；入口是设置 → 模型的角色表、模型选择对话框里点角色后的“应用”）：**一律**经 `omp config set modelRoles` 写全局（先读出全局角色表再改一项，去掉最后一个角色时 `omp config reset modelRoles`）。仓库所有者 2026-10-22 定：给角色指定模型就是全局的事；项目 `.omp/config.yml` 自带 `modelRoles.<role>` 的项目照旧用项目的值（omp 的覆盖规则），omp-studio 不写项目文件。2026-10-18 到 10-22 曾在生效的 `modelRoleStorage` 是 `project` 时改项目文件，已去掉；`modelRoleStorage` 只影响 omp 终端的模型选择器，设置页里它在“高级”。
- 草稿胶囊里改模型 / 思考强度（“用于此任务”、`Alt T`）**不写配置**：选择按草稿键记在渲染进程内存里（`composer/draft-model-choice.ts`），发第一条时随 `createTask({ model, thinkingLevel })` 进任务记录，任务以 `--model` / `--thinking` 起 omp，只对这个会话生效；没改的项不传，跟 omp 的默认值。实测（2026-10-22，omp 18.12.6，`test/e2e/model-picker.e2e.ts`）：配置里 `default: table-local/table-one`，草稿里选 table-two + high 发第一条，任务胶囊是 table-two·high，`config.yml` 没变，新草稿回到 table-one。
- 写思考强度：`omp config set defaultThinkingLevel`，永远是全局（omp 也只有角色走 `modelRoleStorage`）；入口只有设置 → 模型。
- `defaultThinkingLevel` 是角色没写强度时的兜底，不是多余的一项。实测（2026-10-24，omp 18.12.6，临时 agent 目录 + rpc-ui `get_state`）：`defaultThinkingLevel: high`、`modelRoles.default: fake/m1` → `high`；角色写成 `fake/m1:low` → `low`（角色自己的优先）；改成 `minimal` → `minimal`。所以设置 → 模型里角色强度选“跟随默认”时，用的就是这一项。

## 角色和备用模型的候选

omp 的角色（读源码 omp 18.12.6 `packages/coding-agent/src/config/model-roles.ts` 的 `MODEL_ROLES`，没逐个实测）分两类：对话角色 default、smol、slow、vision、plan、commit、tiny、memory、task、advisor、widget（选对话模型；tiny、memory 也收 tiny 类的小模型）；特定能力的角色 image、web、speech、dictation、judge（分别选生图、搜索服务、语音合成、语音识别、评判模型，judge 也收 tiny 和对话模型）。`modelRoles` 里别的名字是自定义角色，当对话角色。设置 → 模型按这个分两组列出全部角色，模型选择对话框的角色范围只列对话角色（特定能力的角色不选对话模型）。

- 对话模型照旧来自服务进程的 `get_available_models`（受 `enabledModels` 限制）。别的类别 RPC 里没有，要跑 `omp models --kind all --json`（`listRunnerModels`，`src/main/ipc/account-handlers.ts`，解析在 `src/shared/omp-output/models.ts`，只留 `kind` 不是 `chat` 的）。实测（omp 18.12.6，2026-10-22，临时 agent 目录、没有任何凭据）：stdout 只有一行 `{"models":[{provider,kind,id,selector,name,...}]}`，按 provider、id 排好；`kind` 有 chat、tiny、search、image、tts、stt、judge 等；没登录也列出 `web/*` 的二十多个搜索服务（brave、exa、tavily、duckduckgo...）、`local/*` 的 tiny 和语音模型；`models.yml` 校验失败时的警告写 stderr，不混进 JSON。这条命令会刷新没缓存的 provider 目录（联网），超时 60 秒；渲染进程打开模型页或角色 / 备用链编辑器时读一次、留缓存，读不到时只影响特定能力那组的候选。
- 候选按角色筛（`src/renderer/src/features/settings/role-options.ts`）：角色 → 能用的类别（`composer/model-groups.ts` 的 `roleKinds`）→ 那些类别的模型。`retry.fallbackChains` 的 key 可以是角色、`provider/model` 或 `provider/*`：角色按角色筛；具体模型按它的类别；`provider/*` 按那个 provider 有的全部类别；认不出的当对话模型。设置页的角色表和搜索里 `modelRoles` / `retry.fallbackChains` 的“编辑…”对话框用同一份候选。
- 备用模型（`retry.fallbackChains.<角色>`）是请求出错时依次换用的列表，和 `modelRoles` 的值里用逗号分开的多个选择器不是一回事（后者是“第一个能用的”，omp 文档 `docs/models.md`）。omp 的默认值是空对象；移除一个角色的最后一个备用模型时整条 key 去掉，不留空列表。
- **备用模型的思考强度**（读 omp 18.12.6 文档 `settings.md`、`advisor-watchdog.md`，2026-10-23；没有另外起 omp 实测）：`retry.fallbackChains` 的条目可以带 `:<档位>` 后缀（文档示例 `anthropic/claude-sonnet-4-5:medium`），没有后缀的条目沿用出错那一轮的思考强度，显式后缀替换它；非对话模型（web、image 等）不用对话的思考预算。所以模型页给每个备用模型一个思考强度下拉（`ChainLevel.tsx`，档位来源同主模型：`thinkingLevelOptions`），写回 `provider/model:档位`，选“沿用当前”去掉后缀；解析用 `role-value.ts` 的 `splitRoleValue` / `joinRoleValue`。去重（`添加备用…` 里不再列已加的）按去掉后缀的选择器比。`provider/*` 条目、不支持思考的模型没有下拉。e2e：`test/e2e/model-picker.e2e.ts`（模型页写入 `role-local/role-two:high`、编辑器改档位 / 换模型去后缀、900/1200 × 中英文不越界）。

## 没有实测的

实现时没有真实账号可登录，下面都没跑过真实 OAuth：`open_url` 之后 `input` 的实际时机、取消时关闭服务进程后 `login` 应答的形状、secret 提示被拒的错误文案（所以"改走应用内登录"的判断是按关键词，可能漏）。实现时界面上的 provider 列表来自 omp 18.12.1（`get_login_providers`，隔离的临时 agent 目录，全部未登录）。应用内登录的实测和没实测的部分见下一节。

## 应用内登录（终端类 provider）

实现：`src/main/login/terminal-login.ts`（逻辑，不 import electron）、`terminal-login-instance.ts`（单例、Electron 接线）、`src/shared/tsp/login-flow.ts`（从文档判断结果）；界面 `features/settings/TerminalLoginBody.tsx` + `ProviderFlowDialog.tsx`。实测 omp 18.12.6，2026-10-23。

### 为什么要一个临时 omp

`github-copilot`、`alibaba-coding-plan`、`alibaba-token-plan`、`perplexity`、`snowflake`、`lm-studio` 的登录要多步交互（企业域名、区域、设备码、选登录方式……），rpc-ui 的 `login` 直接以 "requires interactive prompts which are not supported in RPC mode" 拒绝，只有交互式 omp 里的 `/login <provider>` 走得完。所以应用起一个临时的交互式 omp（和任务同一套 TSP：握手、文档、关进程树），发 `/login <provider>`，用过程区的渲染器画 omp 自己的登录窗，结果出来就关进程。

### 主进程

- 入口 `startTerminalLogin(providerId)` / `cancelTerminalLogin()`（`StudioInvokeApi`，`account-handlers.ts`）。`providerId` 不可信：`TerminalLogin.start` 先在 omp 的登录 provider 列表（服务进程的 `get_login_providers`）里查，不在就 reject `unknown login provider`，**不起进程**（`test/terminal-login.test.ts` 用 `nope`、`github-copilot --model x`、`../../x`、大小写不同、带换行的 id 验证；`settings-functional.e2e.ts` 的用例对真实 IPC 断言同样的拒绝）。
- 临时 omp：`buildTspLaunch({ cwd, noSession: true })`——同一个 omp 可执行文件、同一套 PATH，参数多一个 `--no-session`（不在用户的会话目录留会话文件；探针跑完 `~/.omp/agent/sessions` 里没有当天新建的目录）。cwd 是 `userData/login-cwd`（studio 自己的空目录，不是任何项目，omp 不会读到项目配置）。**`PI_CODING_AGENT_DIR` 不动**：登录就是要把凭据写进用户真实的 agent 目录，由 omp 自己写（AGENTS.md "omp 的边界"：只经 omp 修改 `~/.omp`，studio 不碰凭据）。首次运行引导（`startup.setupWizard`）照任务的做法等启动默认写完再起。
- 进程管理全部复用 `TspSession`：node-pty 自带 ConPTY（`useConptyDll`）、`assignToOwnJob`（主进程被强杀时系统回收）、关闭时 `taskkill /T /F` 等退出事件再 `pty.kill()`、spawn / kill 都在 `withPtyLock` 里。退出入口：对话框取消（`cancelTerminalLogin`）、被新的登录顶掉、应用退出（`registerShutdownHook`，经 `window/shutdown.ts`，托盘退出 / 菜单退出 / 安装更新 / 注销都会走）。结果（`start` 的 Promise）在进程关掉**之后**才 resolve。
- 同一时间一个登录：`start` 遇到还没结束的旧登录先结束它（渲染进程重载后旧对话框没了，不能被挡住）。
- 启动：等握手（30 秒超时，`TspHandshakeError`）→ 等输入框就绪（`findMessageTarget` 是 `ready`，30 秒超时）→ 发 `send` 事件 `/login <providerId>`（和任务发话同一条路径）→ 每次文档变化用 `deriveLoginFlow` 判断。omp 在握手前退出：失败，原因是 omp 终端上最后几行文字或退出码。
- 成功后 `reloadServiceModels()`（`service/default-model.ts`）：凭据是别的进程写进去的，服务进程里 omp 缓存的认证状态是旧的（同保存 API key），关掉它并作废缓存的模型目录和默认模型，下次用时重启读到新的；界面随后重读 provider、账号和模型。已经在跑的任务进程要等下次启动才用上新凭据（和终端版一样）。

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

## API key 不进进程环境

设置页存的 key 在 omp 的凭据库里，studio 不再把 key 放进 omp 子进程的环境变量（2026-10-24 之前是这样做的，omp 起的 bash 等子进程会继承到）。用户自己在系统里设的 `*_API_KEY` 环境变量照旧会被继承，那不归 studio 管。

## Tavily 备用 key（2026-10-27）

仓库所有者要的：Tavily 有好几个 key，当前 key 额度用完时自动换下一个，而且要无损：正在跑的任务里搜索不能报错、不能退到别的搜索源。2026-10-27 至 10-28 先后做过"扩展里换"、"studio 主进程每 30 分钟换"、"两层一起"，最后定为：只用扩展，换上的 key 由扩展自己写进 `.env`（仓库所有者 2026-10-28 批准扩展改 `.env` 这一行，不再要主进程那层）；设置页能看每个 key 的用量。

- **为什么 omp 自己不换**（omp 18.13.1 实测）：Tavily 搜索每次请求按 omp 的顺序取一个 key（`models.yml` 覆盖 → OAuth → `/login` 存的 → `TAVILY_API_KEY`（`Bun.env`，含 agent 目录 `.env`）→ 其余凭据库条目），额度用完 Tavily 回 `432`（`{"detail":{"error":"This request exceeds your plan's set usage limit..."}}`），omp 报 `Tavily API error (432)`。432 不在 omp 会轮换凭据的错误里，同一 provider 的凭据库也只留一个 API key（再 `omp auth import` 就替换）。会话里的 `web_search` 这时退到 Parallel，结果里写 `answered by Parallel after Tavily failed` 和 432 原文。
- **备用 key 存在哪**：内置扩展目录 `<agent 目录>/extensions/studio-accounts/tavily-keys.json`（JSON 字符串数组；不在部署清单里，重新部署不删；卸载 studio 时随整个目录删掉），设置页"设置 API key"对话框（只有 Tavily 有 `备用 key` 字段）经 `setTavilyBackupKeys` 原子写，清空就删文件。omp 不读也不管这个文件，只有扩展读。
- **当场换 key 重发**（`client-accounts/extension/tavily-keys.mjs`）：扩展在 omp 进程里包一层全局 `fetch`（omp 的 Tavily 请求每次都调全局 `fetch(url 字符串, init)`，body 是 JSON 字符串，能重发）。发往 `https://api.tavily.com/` 的请求回 401（无效）/ 432（套餐用完）/ 433（按量付费上限，Tavily 文档）时，这个 key 在本进程里记为不能用，同一个请求换下一个能用的备用 key 重发；回 429（这个 key 被限流）时只这次换别的 key。之后 omp 还拿用完的 key 来时直接换成最近成功的那个。全都不行就把最后一个回复交还 omp。URL 对象、`Request` 形式的请求也处理；请求体是流（只能读一次）时不碰。每次要换 key 时重读文件，改了不用重启 omp；同一进程多次加载扩展时只装一次；保留 `fetch.preconnect`。
- **换上的 key 写进 `.env`**（同一文件的 `rotateStoredKey`）：omp 带来的 key 用完、换上的 key 请求成功时（每个用完的 key 一个进程里只做一次），`<agent 目录>/.env` 里 `TAVILY_API_KEY` 只有一行、值正是那个用完的 key 时，把这一行的值换成新 key（前缀、`export`、引号、CRLF、BOM、别的行原样；写前留 `.env.bak`；先写临时文件再换名），再从备用列表去掉新 key、末尾补上旧 key（额度每月重置，以后还能轮回来）。值已经不是那个 key（别的 omp 进程刚换过）、没有这一行、有好几行时都不动，`.env` 和列表一起不动，免得对不上。写失败记进 omp 的日志（`pi.logger.warn`），这个进程照样用换上的 key。作用：之后新起的 omp 进程一开始就用好 key，不用先撞一次 432。key 不在 `.env` 里（存在 omp 凭据库）或 `TAVILY_API_KEY` 设在系统环境变量里时不写，每个新进程第一次搜索先撞一次 432 再换（多一次请求，结果照样无损）。
- **每个 key 的用量**（`src/main/tavily/`，IPC `tavilyKeyUsage`）：打开 Tavily 的填 key 对话框时查一次。`omp token tavily` 拿 omp 现在用的 key（按 omp 自己取 key 的顺序），连同备用 key 各发一次 Tavily 的 `GET /usage`（`key-usage.ts`：key 自己设了 `limit` 就按 key 算，否则按账号套餐 `plan_usage` / `plan_limit` 算；套餐用满且没有剩余按量付费额度是用尽；401 / 403 是无效；断网、限流、Tavily 出错是未知）。只回角色（当前 / 备用第几个）、状态、已用和上限，不回 key。Tavily 的用量统计有延迟（几次成功搜索后 `key.usage` 仍是 0），刚用过的 key 显示的用量会偏少。
- **还剩的损失**：omp 哪天不再经全局 `fetch` 发 Tavily 请求，扩展就不起作用，退回"用完就退到 Parallel"，而且没有提示；`omp search` 命令不加载扩展，不换 key。
- **实测**（omp 18.13.1，真实 Tavily key，临时 `PI_CODING_AGENT_DIR` + 仓库的扩展目录原样拷过去，`modelRoles = {"web":"tavily"}`，`omp -p` 让模型调一次 `web_search`）：
  - 2026-10-27：`.env` 的 `TAVILY_API_KEY` 和第一个备用 key 都已用完（`GET /usage` 1000 / 1000、1003 / 1000）、第二个有额度：结果没有错误、没有退到 Parallel。对照（只给用完的备用 key）：`answered by Parallel after Tavily failed` + 432 原文。
  - 2026-10-28（写 `.env`）：同样的三个 key，`.env` 写成 CRLF、带注释和别的变量：第一轮搜索没有错误，结束后 `.env` 的 `TAVILY_API_KEY` 换成有额度的那个、换行和别的行不变，备用列表变成 [第一个备用 key, 原来的 key]；第二轮搜索同样没有错误。
- **omp 的相关行为**（同上实测）：`web` 角色没设（`modelRoles` 为空）时 `web_search` 自动选的第一个搜索源是 Parallel（不要 key），不是 Tavily，所以备用 key 只在搜索源设成 Tavily、或者排在前面的源失败时才用得上；`omp search --model tavily` 不退到别的源。

## 服务进程的关闭

`serviceOmp.close()`（`IdleOmp.close()`）会递增代号：启动到一半（准备参数、等 ready）时被关掉的进程在 ready 后自己关闭并报错；放进 Job Object 失败的进程立刻关闭，不留下没有兜底的进程。

**没有任何可用模型时**（新装、没登录、环境和 `.env` 里也没有 key）：omp 18.12.6 的 `--mode rpc-ui` 握手前就以 1 退出，stderr `No default model selected. Use /login, set an API key environment variable, ...`（源码 `main.ts`：非交互模式 `!session.model` 就 `process.exit(1)`，没有开关）。服务进程起不来，设置页连 `get_login_providers` 都拿不到，界面只显示"没能读取账号信息：操作没有完成"，也就没法登录（2026-10-26 用户反馈；自定义一个提供商后 omp 有了模型，就好了）。处理：`IdleOmpOptions.relaunch` 在握手前退出时拿到退出信息，`service-omp.ts` 认出这两句（`No default model selected` / `No models available`）就带 `--model anthropic/claude-sonnet-4-5` 再起一次（只一次）。实测（omp 18.12.6，空 agent 目录，key 变量全部去掉）：带内置目录里有的模型能起来，`get_login_providers` 85 个、`get_state.model` 是这个占位、`get_available_models` 0 个，agent 目录里不多写任何配置；目录里没有的模型（`anthropic/does-not-exist`）照样退出。占位起的进程 `serviceHasNoModel()` 为真，`readDefaultModel` 返回 null（界面按"没有默认模型"）。登录、存 key、改自定义提供商后都会关掉服务进程，下次按正常参数起。项目目录的 rpc-ui 池（`project-omp.ts`）没加：没有模型时任务本来也跑不了。e2e：`settings-functional.e2e.ts`「没有任何凭据」把所有 `*_API_KEY` / `*_TOKEN` / `*_KEY` 变量置空。

## 自定义模型（第三方 API 提供商）：omp 没有写 `models.yml` 的接口

实测/查证（omp 18.12.1，2026-10-18）：

- 自定义 provider 只能写在 `<agent 目录>/models.yml`（`omp://models.md`）：`providers.<id>` 下有 `baseUrl`、`apiKey`（环境变量名或字面量，`!命令` 取密钥）、`api`、`auth`、`models[]`（`id`、`name`、`contextWindow`、`maxTokens`、`reasoning`、`input`、`cost`…）和 `discovery`。非法文件时 omp 退回内置模型，错误经 `ModelRegistry.getError()` 暴露。
- **写入接口：没有。** 查过：`omp config`（只有 `list/get/set/reset/path/init-xdg`，键必须是设置 schema 里的，`models.yml` 不是设置）；RPC wire schema 的全部命令（`rpc-wire.generated.ts`，没有任何 provider/models 的增删改；只有 `get_available_models`、`get_login_providers`、`login`、`logout`）；`omp models`（只有 `ls/find/refresh`）；`--config <overlay>`（是 `config.yml` 风格的设置叠加层，不含 `providers`）。文档里唯一的"程序化"入口是扩展 API `pi.registerProvider(...)`（进程内注册，不落盘）。
- 读：`omp models --json` / RPC `get_available_models` 能读到最终合并后的模型列表（含自定义的），但不暴露 `models.yml` 的原文，也不暴露 transport `api`。
- 按 `AGENTS.md`「omp 的边界」（omp 的设置就是 omp-studio 的设置，只经 omp 写），没有写入接口原本不该写 `models.yml`；仓库所有者 2026-10-18 在四个方案（直接改 `models.yml` / 只生成 YAML 片段 / 给 omp 提 PR / 自带扩展）里选了**方案 1：omp-studio 直接改 `models.yml`**，作为和"项目 `.omp/config.yml` 的 `modelRoles`"同一类的第二个例外。实现、校验、key 存法、一键拉取、保存后 omp 如何重新加载（实测：只在启动时读，同进程里改了不生效）见 `custom-models.md`。

## 界面（3.2）

设置 → Provider 与订阅只列"已连接"（`ProviderRow` 卡片：provider 的单色 logo（`ProviderLogo.tsx`，图形拷自 LobeHub Icons，没有的写首字母）+ 徽标 + sm 按钮；清除 key 就是"退出登录"）和自定义提供商；没连接的不铺开，页头"连接提供商…"打开 `ProviderPickDialog`（可搜索），选中后进 `ProviderFlowDialog`——OAuth 进度、授权码 / API key 输入、选账号退出、失败重试都在这一个对话框里走。
