# 登录、API key 和模型列表

实现：`src/main/service/`（服务进程、OAuth 登录）、`src/main/login/api-key.ts`（API key）、`src/main/ipc/account-handlers.ts`；界面是设置 → Provider 与订阅（`features/settings/ProviderRow.tsx`）。协议出处：omp 文档 `rpc.md`（`get_login_providers`、`login`、`get_logout_accounts`、`logout`，`extension_ui_request` 的 `open_url`/`input`/`notify`）；`environment-variables.md` §1（API key 变量名）；`omp auth --help`（`omp auth import`，omp 18.10.0 起有）。

## 路线（决策 D3）

- **OAuth**：RPC `login {providerId}`，发在服务进程上（`omp --mode rpc-ui --no-session`，cwd `userData/service/`，按需启动、空闲关掉，见 `idle-omp.ts`；放进应用 Job Object）。`login` 在登录结束时才应答。
- **API key**：omp 对 `secret:true` 的提示一律以失败的 `login` 拒绝（`rpc.md` 登录一节），所以 key 不走 RPC，走 `omp auth import -`：主进程把 `{"version":1,"credentials":[{"provider":<id>,"credential":{"type":"api_key","key":<key>}}]}` 写进 stdin（不进命令行），key 存进 omp 凭据库（`agent.db`），和终端版共用（仓库所有者批准，2026-10-24）。旧的 `userData/api-keys.json` 不迁移、不读。
- **key 已在 `.env` 里时改 `.env`**（仓库所有者批准，2026-10-24）：实测 omp 18.12.6（临时 agent 目录，`omp token tavily` / `omp token anthropic`）：agent 目录 `.env` 里有 `TAVILY_API_KEY`（或 `ANTHROPIC_API_KEY`）时，再 `omp auth import` 一个 key，omp 用的仍是 `.env` 的；去掉 `.env` 才用凭据库的。所以 omp 实际用的变量（`providerKeyEnv`）写在 agent 目录 `.env` 里时，"设置 API key"改写 `.env` 那一行（`env-file.ts` 的 `setEnvKey`，写法同自定义 provider 的 `.env`），不存凭据库（说明 `login.apiKey.noteEnvFile`）。变量设在系统环境变量里时 studio 改不了，照旧存凭据库，说明写"这里存的不生效"（`login.apiKey.noteSystem`）。
  - 实测 omp 18.12.6（临时 `PI_CODING_AGENT_DIR`）：同一 provider 再导入一次，旧 API key 被替换，OAuth 凭据保留；导入后 `get_logout_accounts` 多一条 `type: "api_key"`、标签 `API key #<n>`，`logout` 它只删这条；同一个 rpc-ui 进程的 `get_login_providers` 不会马上把它算成 `authenticated`，所以保存后关掉服务进程；不认识的 provider id 它也照收，所以主进程先按 `acceptsApiKey` 拒绝。
  - 能填 key 的 provider（`acceptsApiKey`，`src/shared/provider-keys.ts`）：omp 认它的 key 环境变量（表出自 `environment-variables.md`；没写 id 的行按命名推断 [推测]），或它在 omp 里的登录就是粘贴 key（`provider-login.ts` 的 `api-key`）。一个 provider 可认几个变量（主名在前，fallback / 别名在后），omp 取第一个设了的：实测 omp 18.12.6（`omp token huggingface`）：`.env` 只有 `HF_TOKEN` 时用它（凭据库另存了 key 也一样）；两个都写时用 `HUGGINGFACE_HUB_TOKEN`；`.env` 去掉才用凭据库的。studio 按同样先后算 `providerKeyEnv`：`apiKeyEnvSources` 和提供商列表一起读（`accounts-store.ts`），卡片元信息和"设置 API key"的说明一打开就对，保存改写这个变量那一行。
  - 空 key、带控制字符的 key 在起 omp 之前拒绝；`omp auth import` 失败时报错里的 key 原文换成 `***`。
  - key 只进不出：`saveApiKey` 之外没有任何接口、事件、日志带 key。
  - 已经在跑的任务进程什么时候用上新 key 没有实测 [推测：omp 每次请求从凭据库取，可能马上生效]。

## OAuth 登录流程

1. 界面 `startLogin(providerId)`；主进程保证同一时间一个登录，在服务进程上发 `login`，同时监听 `extension_ui_request`：
   - `open_url {url, launchUrl?, instructions?}`：只放行 http/https，系统浏览器打开 `url`，推 `{type:"open_url"}`；界面显示 `launchUrl ?? url`（`rpc.md` 推荐复制 `launchUrl`，避免 OAuth 参数被截断）、`instructions` 和"重新打开浏览器"。
   - `notify`：推 `{type:"progress", level, message}`（`level` 是 omp 的 `notifyType`，默认 `info`）。界面按到达顺序全部保留（`login-progress`），按 `data-level` 着色。
   - `input`：推 `{type:"input", inputId}`（就是请求 id）；界面回 `answerLoginInput(inputId, value|null)`，主进程只接受仍在等的 `inputId`，回 `extension_ui_response`（`null` = `cancelled:true`）。omp 给的 `timeout`（`login` 固定 10 分钟）不显示倒计时：用户要先去浏览器授权，这个上限不是能据以决策的数字，倒计时只制造压力；到点 omp 发 `cancel`，按下一条处理。
   - `cancel {targetId}`（omp 撤销输入：超时或被取消）：`targetId` 是还在等的 `input` 时推 `{type:"input_closed", inputId}`，界面收起输入框（进度保留，没提交的字清掉），不会再出现提交时抛 `no login input is waiting`。
   - 用不到的 `select/confirm/editor/ask`：立刻回 `cancelled:true`，免得 omp 一直等；和连接层的默认应答共用 `src/main/omp/extension-ui.ts` 的 `cancelledReply`。
   - 登录期间 `login.ts` 用 `connection.claimExtensionUi()` 认领应答权，连接层的默认应答（`omp-rpc.md`"后台进程对 extension_ui_request 的处理"）不会同时回答；登录结束（含失败）释放。
2. `login` 应答 → `{ok:true}`；`RpcCommandError`（含 secret 提示被拒）或服务进程退出 → `{ok:false, message}`。原因里带 `secret`/`terminal` 时（omp 升级后新增、`provider-login.ts` 表里还没有的多步登录 provider），主按钮改成"在应用内登录"，走下面"应用内登录"。
3. **取消**：没有公开的取消命令。有未答的 `input` 就回 `cancelled:true`；否则（omp 在等浏览器回调）关掉服务进程，`login` 随之失败，主进程按"已取消"返回。
4. 登录或登出之后界面重读 provider、账号和模型。

## 登出和状态显示

- 徽标按凭据来源分：有 `type: "oauth"` 账号 → `已登录`，元信息是账号名（多个显示 `+N`）；只有 `type: "api_key"` 账号（设置页或终端 `/login` 粘贴的 key）→ `已设置 key`；`authenticated` 但凭据库里没有账号 → `已配置`（元信息 `login.badge.env` + 变量名）：key 来自环境变量、agent 目录 `.env` 或 `models.yml` 的 `apiKey`。这是从 `get_logout_accounts` 为空推出来的，**契约里 `logout` 不返回 `remainingSource`**。例：`~/.omp/agent/.env` 里写了 `HF_TOKEN` 的卡片是"已配置"，不是登录过。
- 元信息里的变量名来自 `shared/provider-keys.ts`；搜索服务 `tavily` / `exa` / `kagi` / `parallel` 也在表里（`environment-variables.md` §3）。实测（omp 18.12.6，真实配置只读，`omp -p --no-session --tools web_search` + 一次性 `--config` 把 `modelRoles.web` 定成 `web/tavily`、`retry.fallbackChains.web: []`）：key 只在 agent 目录 `.env` 的 `TAVILY_API_KEY` 时，内置 `web_search` 走 Tavily（`authMode: api_key`），和装没装 Tavily 的 MCP 服务器无关。
- `logout`：1 个账号直接退出，多个先让用户选（`login.chooseAccount`）；`LogoutAccount.active` 为 true（omp 说它正被使用）的带"正在使用"徽标（`account-active-<credentialId>`），只有 1 个账号时不弹选择、看不到徽标。
- 清除 API key 就是退出那条 `api_key` 账号：只有 key 账号时按钮写 `清除 key`，有 OAuth 账号时写 `退出登录`。只有环境变量 / 配置文件的没有退出按钮。

## 多个账号

- **添加**：已有 OAuth 账号的卡片 ⋯ 里 `添加账号`（`ProviderRow.tsx`），走和第一次一样的 `login`（OAuth 类）或应用内登录（多步登录类），在浏览器里换一个账号（或同一邮箱的另一个组织 / 工作区）授权。
- **omp 怎么存**（读 omp 18.16.0 二进制里的源码 `AuthStorage.upsertOAuth`，没用真实账号跑过）：已有凭据和新的一起按账号身份去重后写回，不同账号追加，同一账号只刷新那一条；API key 是 `replaceAuthCredentials`，一个 provider 只留一条。终端 `omp login <provider>` / `/login` 同一条路。
- **怎么轮换**（omp 自己做，studio 不参与；读 omp GitHub main 源码 `packages/ai/src/auth/select.ts`、`rank.ts`、`usage/claude.ts`、`usage.ts`，2026-11-10，没有真实多账号实测，装的是 18.18.6）：
  - 什么都不配时 Claude 也按额度挑号：provider 有排序策略（`claudeRankingStrategy`）且两个以上账号就排。顺序：没被拒的在前 → 5h 用满 85% 的往后 → `priority`（默认 0）→ 读到用量的在前 → 7d"必须消耗速度"（剩余比例 ÷ 距 7d 重置的小时数）大的在前 → 7d 用得少的 → 5h 同理。即先用"不用就作废得最多、最快"的号。
  - 只在挑号时排：新会话、绑定的号被拒、绑定的号超过 1 小时没请求（`stickyWarmMs`，只有 Anthropic 有）、绑定的号额度剩 0。在跑的会话不会因为别的号更合适而换，恢复的号也不会被搬回去（除非 `auth.accountPolicies` 配了 `reclaimAbovePct` 且优先级更高）。
  - 配了 `auth.accountPolicies` 才有保留线（`reservePct` / `retry.usageReservePct`）参与排序；`retry.usageAwareFallback` 打开后每次调模型前用缓存的用量（报告缓存 5 分钟，`USAGE_REPORT_TTL_MS`；回复头里的用量最多每 60 秒读一次）检查当前号。
  - 号被拒（429）时屏蔽到它的重置时间，换同一 provider 的另一个号重发。
- 已经在跑的任务进程什么时候认得新账号没有实测 [推测：同"应用内登录"，下次启动才用上]。

## 内置 magpie 插件：第三方客户端账号

`src/main/client-accounts/`（设计、注册的 provider 和实测见 `client-accounts.md`）：magpie 社区的账号插件包在一个 omp 扩展里，启动时写进 `<agent 目录>/extensions/studio-accounts/`，omp 每个进程（studio 起的和终端的）自动加载。扩展在 omp 里注册带 `oauth` 的 provider（`qoder-cn`、`kiro`……），所以它们出现在上面的列表里，登录走同一条 RPC `login`（`onAuth` → `open_url`、`onProgress` → `notify`），凭据进 omp 的 agent.db；登录后 omp 自己 `refreshProvider`。

和本文其余部分不同的两点：请求不走 HTTP provider，而是扩展注册的自定义 `api`（内部转成 omp 自带的 OpenAI Chat、Anthropic Messages 或 OpenAI Responses 流）；只暴露不用打字的登录（浏览器、设备码、免账号；PAT、手机号、企业域名在 RPC 登录里收不到，"读桌面版登录"会读别的应用的文件，都没接）。

## 提供商列表：搜索、排序、登录方式

- 列表（`features/settings/ProvidersSection.tsx`，纯函数在 `src/shared/ui/provider-list.ts`）：搜索按名称和 id 过滤（多个词都要命中）；已配置的（`authenticated`）排前面，组内保持 omp 的顺序。
- 登录方式（`src/shared/provider-login.ts`）：`get_login_providers` 只有 `{id, name, available, authenticated}`，**没有登录方式字段**（实测 omp 18.12.2，84 个 provider 的 `available` 全是 true），所以按实测分类。方法：隔离 agent 目录、`omp --mode rpc-ui --no-session`、对每个 provider 发 `login`，看 open_url 之后要什么：授权码 / 等浏览器或设备授权 = `oauth`；"Paste your … API key" 输入框 = `api-key`；直接以 "requires interactive prompts which are not supported in RPC mode" 失败 = `terminal`。表里没有的新 provider 按 `oauth` 处理（保留登录按钮，失败有原因）；omp 升级后要重测更新表。
- 界面：能填 key 的（`acceptsApiKey`）都有"设置 API key"（已有 `api_key` 账号时"更换 key"），走 `omp auth import`；`oauth` 另有"登录"；`terminal` 的"登录"走"应用内登录"，元信息写"多步登录"。`api-key` 类不走 omp 的 `login`，和"设置 API key"合并。

## 模型列表

`listModels` 在服务进程上发 `get_available_models`（会等 omp 后台发现完成），映射成 `ModelOption`（`acceptsImages` = `input` 含 `image`）。新任务的默认模型 / 思考强度就是 omp 的 `modelRoles.default` / `defaultThinkingLevel`，omp-studio 不另存，新任务启动时不传 `--model`/`--thinking`。`modelRoles` 只能整体写（实测 18.12.1：`omp config set modelRoles.default` 报 Unknown setting），所以读出角色表只换 `default`；`defaultThinkingLevel` 不接受 `off`，胶囊里不提供。

**智能分和目录速度**（实测 omp 18.12.6，2026-10-22，临时 agent 目录 + 真实 key）：`get_available_models` 的每个模型除了 wire 类型 `ModelInfo` 的字段，还带 omp 从模型目录补的 `int`（智能分）和 `tps`（输出速度），没有就不带。omp 查目录前按 provider 的各种写法归一（`packages/catalog/src/identity/metrics.ts`），中转站（如 `relay-x/claude-fable-5-1`）也能查到，studio 自己按 `provider/id` 读 `models.db` 大多查不到，所以 `toModelOption`（`src/main/tasks/convert.ts`）直接取这两个值（`ModelOption.intelligence` / `catalogTps`，非有限数或 `tps ≤ 0` 当没有）；`model-insights.ts` 只读 `agent.db` 的实测速度和压缩设置。

启动缓存（`src/main/service/startup-cache.ts`，单例在 `startup-cache-instance.ts`）：服务进程每次现读成功（默认模型、`listModels`、各项目的 `getModelDefaults`、`listAccounts` 得出的"有没有 OAuth 凭据"、`tools.approvalMode`）就记进 `userData/startup-cache.json`（原子写，串行）。同一文件还记 `omp --version` 的结果（见 omp-install.md）和按目录的斜杠命令列表（见 composer-input.md），它们不在 `StartupSnapshot` 里。渲染进程第一次渲染前取一次 `getStartupSnapshot()`，工具行先用它画，现读到再替换；文件坏了或版本不对当成没有。主窗口第一次淡入完成后（`main-window.ts` 的 `afterFirstReveal`）`prewarmToolbarData()` 才读默认模型和模型目录，不和首帧抢 CPU。任务进程起来之前，`TaskRunner` 用缓存的模型目录（`knownModels`）给胶囊名字和上下文窗口，查不到才用模型 id；进程起来后服务进程的目录还没读到时，输入框上的模型名也先按它认，目录读到后换成现读的（见 tsp-migration.md 的 `model` 一行）。是不是唯一的模型、要不要记进任务记录仍只按读到的目录判断。

**模型目录和默认模型缓存优先**（`service/default-model.ts`）：服务进程约 600 MB、起一次几秒 CPU（omp 18.13.3），所以不是每次启动 / 任务启动 / 草稿挂载都问它。读到时连同 omp 输入的指纹一起记（`catalogStamps`，`service/input-stamp.ts`：studio 版本（自带 studio-accounts 扩展注册 provider）+ omp 版本 + 系统环境里各内置 provider key 变量的摘要（不存原值）+ agent 目录 `config.yml` / `config.yaml`、`models.yml`、`.env` 的修改时间）。

- 缓存优先（指纹对得上、目录非空就直接用，不碰服务进程）：启动预读、任务启动（`TspRunner.#refreshCatalog(false)`）、新任务默认值、草稿和起进程前的输入框（`getDefaultModel`、`listModels(false)`）。缓存齐全、输入没变时启动不起服务进程。
- 一定现读：打开模型选择器（任务的 `listTaskModels`、草稿的 `listModels(true)`、`/model`）、设置页（`accounts-store.ts`）、omp 设置里改了模型相关项（`onOmpConfigChanged`）。`listModels(true)` 同时现读默认模型并推 `defaultModel` 事件；现读的目录和记着的不一样时默认模型也作废。
- 作废（`StartupCache.forgetCatalog`，值留着给胶囊显示，下次现读）：OAuth 登录成功、退出账号；凭据和模型注册表在服务进程之外变了的（应用内登录、保存 API key、自定义 provider 的保存 / 删除 / 覆盖、`omp models refresh`）走 `reloadServiceModels()`，作废并关掉服务进程。作废前已开始的读（`catalogGeneration`）晚到也不记，不会把登录前的目录当成现成的。
- 盲区：终端里登录、OAuth 过期（`agent.db` 一直在写，实测 omp 18.13.3 有任务在跑时 `agent.db-wal` 几秒就改一次，不进指纹）、provider 在线目录变了，要等打开模型选择器或上面的作废。
- 测试：`test/model-catalog-cache.test.ts`（数服务进程被用的次数）、`test/startup-cache.test.ts`。

项目配置（实测 omp 18.12.1，2026-10-18，临时 agent 目录 + 带 `.omp/config.yml` 的临时项目）：

- 项目 `.omp/config.yml` 有 `modelRoles.default` 时，在这个项目里启动的 omp 用项目的值（`get_state` 返回项目的模型）。`omp config list` 在项目目录里显示项目的值，在别处显示全局的。
- `omp config set modelRoles` 不管 `modelRoleStorage` 设成什么都**写全局配置**；在项目目录里运行时返回 `overriddenBy: "project"`。`modelRoleStorage` 只影响 omp 终端模型选择器的保存位置（文档；没在 TUI 里实测）。
- RPC `set_model` 只换当前会话的模型，不写任何配置文件（global、project 都试过）。

omp-studio 的做法（`src/main/omp-config/model-defaults.ts`）：

- 读：草稿输入框在**项目目录里**跑 `omp config list --json`（`getModelDefaults(projectId)`），显示这个项目实际会用的默认模型和思考强度；设置页（没有项目）只看全局。
- 写模型角色（`setModelRole(role, model)`；入口是设置 → 模型的角色表、模型选择对话框里点角色后的"应用"）：**一律**经 `omp config set modelRoles` 写全局（读出全局角色表改一项，去掉最后一个角色时 `omp config reset modelRoles`）；omp-studio 不写项目文件，项目自带 `modelRoles.<role>` 的照旧按 omp 的覆盖规则用项目值（给角色指定模型是全局的事，仓库所有者定，2026-10-22）。`modelRoleStorage` 只影响 omp 终端，设置页里它在"高级"。
- 草稿胶囊里改模型 / 思考强度（"用于此任务"、`Alt T`）**不写配置**：选择按草稿键记在渲染进程内存（`composer/draft-model-choice.ts`），发第一条时随 `createTask({ model, thinkingLevel })` 进任务记录，任务以 `--model` / `--thinking` 起 omp，只对这个会话生效；没改的项不传。实测（2026-10-22，omp 18.12.6，`test/e2e/model-picker.e2e.ts`）：草稿里选别的模型 + high 发第一条，任务胶囊是选的，`config.yml` 没变，新草稿回到默认。
- 写思考强度：`omp config set defaultThinkingLevel`，永远全局；入口只有设置 → 模型。
- `defaultThinkingLevel` 是角色没写强度时的兜底。实测（2026-10-24，omp 18.12.6，rpc-ui `get_state`）：`defaultThinkingLevel: high`、`modelRoles.default: fake/m1` → `high`；角色写成 `fake/m1:low` → `low`（角色自己的优先）。所以角色强度选"跟随默认"时用的就是这一项。

## 角色和备用模型的候选

omp 的角色（读源码 omp 18.12.6 `packages/coding-agent/src/config/model-roles.ts` 的 `MODEL_ROLES`，没逐个实测）分两类：对话角色 default、smol、slow、vision、plan、commit、tiny、memory、task、advisor、widget（tiny、memory 也收 tiny 类小模型）；特定能力的角色 image、web、speech、dictation、judge（judge 也收 tiny 和对话模型）。`modelRoles` 里别的名字是自定义角色，当对话角色。设置 → 模型按这两组列全部角色，模型选择对话框的角色范围只列对话角色。

- 对话模型来自服务进程的 `get_available_models`（受 `enabledModels` 限制）。别的类别 RPC 里没有，要跑 `omp models --kind all --json`（`listRunnerModels`，`src/main/ipc/account-handlers.ts`，解析在 `src/shared/omp-output/models.ts`，只留 `kind` 不是 `chat` 的）。实测（omp 18.12.6，2026-10-22，临时 agent 目录、没有凭据）：stdout 一行 `{"models":[{provider,kind,id,selector,name,...}]}`，按 provider、id 排好；`kind` 有 chat、tiny、search、image、tts、stt、judge 等；没登录也列出 `web/*` 搜索服务和 `local/*` 的 tiny、语音模型；`models.yml` 校验警告写 stderr，不混进 JSON。这条命令会联网刷新没缓存的 provider 目录，所以渲染进程打开模型页或角色 / 备用链编辑器时读一次、留缓存，读不到只影响特定能力那组的候选。
- 候选按角色筛（`src/renderer/src/features/settings/role-options.ts`）：角色 → 能用的类别（`composer/model-groups.ts` 的 `roleKinds`）→ 那些类别的模型。`retry.fallbackChains` 的 key 可以是角色（按角色筛）、`provider/model`（按它的类别）、`provider/*`（按那个 provider 的全部类别）；认不出的当对话模型。设置页角色表和 `modelRoles` / `retry.fallbackChains` 的"编辑…"对话框用同一份候选。
- 备用模型（`retry.fallbackChains.<角色>`）是请求出错时依次换用的列表，和 `modelRoles` 值里逗号分开的多个选择器（"第一个能用的"，omp 文档 `docs/models.md`）不是一回事。omp 默认是空对象；移除一个角色的最后一个备用模型时整条 key 去掉，不留空列表。
- **备用模型的思考强度**（读 omp 18.12.6 文档 `settings.md`、`advisor-watchdog.md`，2026-10-23；没实测）：条目可带 `:<档位>` 后缀（文档例 `anthropic/claude-sonnet-4-5:medium`），没后缀的沿用出错那一轮的思考强度；非对话模型不用对话的思考预算。所以模型页给每个备用模型一个思考强度下拉（`ChainLevel.tsx`，档位来源 `thinkingLevelOptions`），写回 `provider/model:档位`，"沿用当前"去掉后缀；解析用 `role-value.ts` 的 `splitRoleValue` / `joinRoleValue`；去重按去掉后缀的选择器比。`provider/*` 条目、不支持思考的模型没有下拉。e2e：`test/e2e/model-picker.e2e.ts`。
- **在用备用模型的标记**（实测 omp 18.17.0，2026-11-06，所有者真实会话只读）：omp 的 retry fallback 换模型时往会话文件追加 `{"type":"model_change","model":"<provider/id>","role":"fallback","resolvedModelIsFallback":true}`，用户自己换模型也追加 `model_change`，但**冷却后换回原模型不写**（所有者一个会话最后一条是换到 Gemini，之后几天的回复全是 Opus）；TSP 里只多一行 `row role=omp.notice.warning`（`Fallback: <原模型> -> <备用模型>`）。所以按会话文件判断：最后一条 `model_change` 是 fallback，且之后没有别的模型的正常回复（写在它之后的原模型出错回复不算），才是在用备用模型（扫所有者 376 个会话验证过）：`ModelFallbackTracker`（`src/main/tsp/session-files.ts`）读出 `TaskState.fallbackModel`，子代理按自己的记录文件读出 `TspSubagentRecord.fallbackModel`，界面在模型名后挂 `备用` 徽标。按 `provider/*` 设的链（omp 里优先于角色）不在角色表里，模型页另有 `retry.fallbackChains` 一行，摘要列出每条链的 key。

## 没有实测的

没有真实账号可登录，下面都没跑过真实 OAuth：`open_url` 之后 `input` 的实际时机、取消时关闭服务进程后 `login` 应答的形状、secret 提示被拒的错误文案（所以"改走应用内登录"按关键词判断，可能漏）。provider 列表来自 omp 18.12.1（`get_login_providers`，隔离的临时 agent 目录，全部未登录）。应用内登录的实测和没实测的部分见下一节。

## 应用内登录（终端类 provider）

实现：`src/main/login/terminal-login.ts`（逻辑，不 import electron）、`terminal-login-instance.ts`（单例、Electron 接线）、`src/shared/tsp/login-flow.ts`（从文档判断结果）；界面 `features/settings/TerminalLoginBody.tsx` + `ProviderFlowDialog.tsx`。实测 omp 18.12.6，2026-10-23。

### 为什么要一个临时 omp

`github-copilot`、`alibaba-coding-plan`、`alibaba-token-plan`、`perplexity`、`snowflake`、`lm-studio` 的登录要多步交互（企业域名、区域、设备码、选登录方式……），rpc-ui 的 `login` 直接以 "requires interactive prompts which are not supported in RPC mode" 拒绝，只有交互式 omp 的 `/login <provider>` 走得完。所以应用起一个临时交互式 omp（和任务同一套 TSP：握手、文档、关进程树），发 `/login <provider>`，用过程区的渲染器画 omp 自己的登录窗，结果出来就关进程。

### 主进程

- 入口 `startTerminalLogin(providerId)` / `cancelTerminalLogin()`（`StudioInvokeApi`，`account-handlers.ts`）。`providerId` 不可信：`TerminalLogin.start` 先在服务进程的 `get_login_providers` 里查，不在就 reject `unknown login provider`、**不起进程**（如 `github-copilot --model x`、`../../x`；见 `test/terminal-login.test.ts`、`settings-functional.e2e.ts`）。
- 临时 omp：`buildTspLaunch({ cwd, noSession: true })`，同一个 omp 可执行文件和 PATH，多一个 `--no-session`（不在用户会话目录留文件；探针跑完 `~/.omp/agent/sessions` 没有新目录）。cwd 是 `userData/login-cwd`（studio 自己的空目录，omp 读不到项目配置）。**`PI_CODING_AGENT_DIR` 不动**：凭据要由 omp 自己写进用户真实的 agent 目录（[omp-boundaries.md](omp-boundaries.md)「`~/.omp`」）。首次运行引导（`startup.setupWizard`）照任务的做法等启动默认写完再起。
- 进程管理全部复用 `TspSession`：node-pty 自带 ConPTY（`useConptyDll`）、`assignToOwnJob`（主进程被强杀时系统回收）、关闭时 `taskkill /T /F` 等退出事件再 `pty.kill()`、spawn / kill 都在 `withPtyLock` 里。退出入口：对话框取消、被新登录顶掉、应用退出（`registerShutdownHook`，经 `window/shutdown.ts`）。`start` 的 Promise 在进程关掉**之后**才 resolve。
- 同一时间一个登录：`start` 遇到没结束的旧登录先结束它（渲染进程重载后旧对话框没了，不能被挡住）。
- 启动：等握手（超时 `TspHandshakeError`）→ 等输入框就绪（`findMessageTarget` 是 `ready`；首次运行引导没关时永远不会就绪，所以有超时）→ 发 `send` 事件 `/login <providerId>`（和任务发话同一路径）→ 每次文档变化用 `deriveLoginFlow` 判断。omp 在握手前退出：失败，原因是终端最后几行或退出码。
- 成功后 `reloadServiceModels()`：凭据是别的进程写的，服务进程里 omp 缓存的认证状态是旧的，关掉它并作废缓存的模型目录和默认模型；界面随后重读 provider、账号和模型。已经在跑的任务进程要下次启动才用上新凭据（和终端版一样）。

### 渲染进程怎么画、怎么交互

- 登录窗的节点树和用户操作走**现有 TSP 通道**，不加第二套：登录会话用固定的"任务 id" `TERMINAL_LOGIN_ID`（`shared/ipc.ts`），主进程在 `getTspSnapshot` / `sendTspEvent` / `sendTspKeys` 里按它路由到 `TerminalLogin`（任务池不认识它），批次经 `tspBatch` 推（序号规则同任务：每个进程结束后序号往后让一格，旧镜像发现丢帧就重拉快照）。preload 只多暴露 `startTerminalLogin`、`cancelTerminalLogin`。
- `TerminalLoginBody` 只画那个会话的 `layer`（`TspChildren`），main、dock、toast 不画；每次打开 / 重试先 `dropTspDocument` 再 `ensureTspDocument`，卸载时丢掉。omp 的弹窗是盖在过程区上的绝对定位浮层，`providers.css` 的 `.pv-terminal` 把它摊平成对话框正文（去掉遮罩、阴影、omp 自带的标题），并隐藏 omp 自己的 Cancel（页脚的"取消"是同一件事）。
- 点击和输入：按钮发 `action`、输入框发 `edit` / 按键字节，都经 `sendTspEvent` / `sendTspKeys`；主进程拒绝 `send` 事件（放行就是让渲染进程把临时 omp 当成能提问的会话）。链接：`omp.btn` 的 `open` 动作走 `openHref` → `openExternal`（主进程只放行 http / https）。
- 取消 / 关闭对话框（取消、Esc、×）= `cancelTerminalLogin` = 结束进程，`start` 以 `cancelled` 结束。渲染进程自己重载时旧进程不会被自动结束（没人调 cancel），跑到 omp 自己结束（设备码过期以失败结束）、被下一次 `start` 顶掉或应用退出为止。

### 实测：`/login github-copilot`（omp 18.12.6，临时 agent 目录，没有账号）

方法：`TspSession` 驱动真实 omp（`--no-session`，`PI_CODING_AGENT_DIR` 指向临时目录，`PI_TUI_TSP_RECORD` 录制），`send` `/login github-copilot`，再用 `action` 事件点按钮。录制裁进 `fixtures/tsp/login-github-copilot.jsonl`（设备码换成 GitHub 文档示例 `WDJB-MJHT`；相邻帧间隔压到不超过 400 ms）和 `login-failed.jsonl`。

1. `/login github-copilot` 之后：main 里一个 status toast `Logging in to github-copilot…`；layer 里一个 modal `overlay`（`role: omp.overlay.login`，`head: Sign in to GitHub Copilot`），里面 `omp.login.body` → `omp.login.prompt`（`omp.login.label` "GitHub Enterprise URL/domain (blank for github.com)"）→ 一个 `input` 节点（有 focus），底下 `omp.actions` 行：`cancel` 和 `submit`（`Continue`），都是 `omp.btn`。
2. 空着点 `Continue`（`action act=submit id=r.^sheet/0/actions/submit`）：输入步骤被删，body 里出现 `omp.login.lead`、`omp.login.code`（`actions.click: copy`，`href` = 设备码）、`omp.login.link`（`omp.login.url` 是 `https://github.com/login/device`，旁边 `copyLink` 按钮）、`omp.login.status` → `omp.login.waiting`（spinner）；actions 行多一个 `openLink`（`actions.click: open`，`href`），`submit` 被删。设备码是 GitHub 真实发的（联网，不需要账号）。
3. 点 `cancel`（或 Esc）：同一帧里 `set` 已有的 status toast 文字为 `Login cancelled`（**不是新增**，所以 `statusNotes` 里没有它），登录窗被删，omp 输入框（`omp.editor`）恢复。进程不退出。
4. 失败（`HTTPS_PROXY` 指向关闭的端口，Continue 之后）：同一帧里 main 末尾多一个 text `Error: Login failed: ECONNREFUSED: …`（`s: error`），登录窗被删，输入框恢复。进程不退出。
5. 其他五个 provider 的第一步（只看第一屏）都是 `input` 节点 + Continue / Cancel，和 github-copilot 同一结构，`omp.login.label` 问的分别是：可选的 LM Studio API key、登录方式（sso / email；perplexity 同时有 `omp.login.waiting`）、Snowflake 账号标识、Alibaba 区域选择（两个 alibaba 一样）。

### 结果判断（`deriveLoginFlow`）

- `running`：有 role 以 `omp.overlay.login` 开头的 `overlay`；`success`：text 节点含 `Successfully logged in to`；`failed`：text 节点含 `Login failed:`，原因取后面的文字；`cancelled`：status toast 文字是 `Login cancelled`；否则 `idle`。结果优先于 `running`（结果文字和关窗同帧）。
- 登录窗开过、之后没了、又没有结果文字（omp 措辞变了）：短暂宽限后以失败结束（`RESULT_GRACE_MS`），不让对话框空着。
- **成功的帧没有实测**（没有真实账号）：文字出自 omp 18.12.6 源码 `selector-controller.ts` 的 `#b`（`ctx.present` 一行 "<图标> Successfully logged in to <provider>[ as <账号>]" 和 "Credentials saved to <路径>"，再关登录窗；凭据在 `oauth.login` 返回时已写进 agent.db，`refreshProvider` 也在这行文字之前）。单测的成功帧是把失败录制里的错误文字换成这行（`test/tsp-login-flow.test.ts`、`test/terminal-login.test.ts`），不是录制。omp 改了这行文字，成功会被当成"登录窗关了没结果"报失败；界面重读 provider 状态后列表仍然是对的。

### 没实测的

- 成功帧（见上）、`perplexity` / `snowflake` / `lm-studio` / `alibaba-*` 第一屏之后的步骤；omp 在设备码页是否自己也开系统浏览器（源码里登录窗第四个构造参数 `hm` 在 `showAuth` 时被调用 [推测：就是开浏览器]）——开了的话用户点 `Open sign-in page` 会多开一次，无害。
- 渲染进程重载时旧登录进程的清理（见上，没有自动结束）。

## API key 不进进程环境

设置页存的 key 在 omp 凭据库里，studio 不把 key 放进 omp 子进程的环境变量（否则 omp 起的 bash 等子进程会继承到）。用户自己在系统里设的 `*_API_KEY` 照旧会被继承，那不归 studio 管。

## Tavily 备用 key

仓库所有者要的（2026-10-27）：Tavily 有好几个 key，当前 key 额度用完时自动换下一个，而且无损：正在跑的任务里搜索不能报错、不能退到别的搜索源。做法：只在 omp 扩展里换，换上的 key 由扩展自己写进 `.env`（扩展改 `.env` 这一行，仓库所有者批准，2026-10-28）；设置页能看每个 key 的用量。

- **为什么 omp 自己不换**（omp 18.13.1 实测）：Tavily 搜索每次按 omp 的顺序取一个 key（`models.yml` 覆盖 → OAuth → `/login` 存的 → `TAVILY_API_KEY`（`Bun.env`，含 agent 目录 `.env`）→ 其余凭据库条目），额度用完 Tavily 回 `432`，omp 报 `Tavily API error (432)`。432 不在 omp 会轮换凭据的错误里，同一 provider 的凭据库也只留一个 API key。会话里的 `web_search` 这时退到 Parallel（结果写 `answered by Parallel after Tavily failed`）。
- **备用 key 存在哪**：`<agent 目录>/extensions/studio-accounts/tavily-keys.json`（JSON 字符串数组；不在部署清单里，重新部署不删，卸载 studio 时随目录删掉）。设置页"设置 API key"对话框（只有 Tavily 有 `备用 key` 字段）经 `setTavilyBackupKeys` 原子写，清空就删文件。omp 不读这个文件，只有扩展读。
- **当场换 key 重发**（`client-accounts/extension/tavily-keys.mjs`）：扩展在 omp 进程里包一层全局 `fetch`（omp 的 Tavily 请求每次都调全局 `fetch(url 字符串, init)`，body 是 JSON 字符串，能重发）。发往 `https://api.tavily.com/` 的请求回 401（无效）/ 432（套餐用完）/ 433（按量付费上限）时，这个 key 在本进程里记为不能用，同一请求换下一个能用的备用 key 重发；429（这个 key 被限流）只这次换。之后 omp 还拿用完的 key 来时直接换成最近成功的那个；全都不行就把最后一个回复交还 omp。请求体是流（只能读一次）时不碰。每次要换 key 时重读文件，改了不用重启 omp；同一进程多次加载扩展只装一次；保留 `fetch.preconnect`。
- **换上的 key 写进 `.env`**（同一文件的 `rotateStoredKey`）：omp 带来的 key 用完、换上的 key 请求成功时（每个用完的 key 一个进程只做一次），`<agent 目录>/.env` 里 `TAVILY_API_KEY` 只有一行、值正是那个用完的 key 时，把值换成新 key（别的写法和行原样，写前留 `.env.bak`，先写临时文件再换名），再从备用列表去掉新 key、末尾补上旧 key（额度每月重置，以后还能轮回来）。值已经不是那个 key（别的 omp 进程刚换过）、没有这一行、有好几行时 `.env` 和列表都不动，免得对不上。写失败记进 omp 日志（`pi.logger.warn`），这个进程照样用换上的 key。作用：之后新起的 omp 一开始就用好 key，不用先撞一次 432。key 在凭据库或系统环境变量里时不写，每个新进程第一次搜索先撞一次 432 再换（多一次请求，结果照样无损）。
- **每个 key 的用量**（`src/main/tavily/`，IPC `tavilyKeyUsage`）：打开 Tavily 的填 key 对话框时查一次。`omp token tavily` 拿 omp 现在用的 key，连同备用 key 各发一次 Tavily 的 `GET /usage`（判定规则见 `key-usage.ts`）。只回角色（当前 / 备用第几个）、状态、已用和上限，不回 key。Tavily 的用量统计有延迟（几次成功搜索后 `key.usage` 仍是 0），刚用过的 key 显示偏少。
- **还剩的损失**：omp 哪天不再经全局 `fetch` 发 Tavily 请求，扩展就失效，退回"用完就退到 Parallel"且没有提示；`omp search` 命令不加载扩展，不换 key。
- **实测**（omp 18.13.1，真实 Tavily key，临时 `PI_CODING_AGENT_DIR` + 扩展目录原样拷过去，`modelRoles = {"web":"tavily"}`，`omp -p` 让模型调一次 `web_search`）：
  - 2026-10-27：`.env` 的 key 和第一个备用 key 都已用完、第二个有额度：结果没有错误、没有退到 Parallel。对照（只给用完的备用 key）：退到 Parallel + 432 原文。
  - 2026-10-28（写 `.env`）：同样三个 key，`.env` 写成 CRLF、带注释和别的变量：第一轮搜索没有错误，结束后 `.env` 的 `TAVILY_API_KEY` 换成有额度的那个、别的不变，备用列表变成 [第一个备用 key, 原来的 key]；第二轮搜索同样没有错误。
- **omp 的相关行为**（同上实测）：`web` 角色没设时 `web_search` 自动选的第一个搜索源是 Parallel（不要 key），不是 Tavily，所以备用 key 只在搜索源设成 Tavily、或排在前面的源失败时才用得上；`omp search --model tavily` 不退到别的源。

## 服务进程的关闭

`serviceOmp.close()`（`IdleOmp.close()`）会递增代号：启动到一半（准备参数、等 ready）时被关掉的进程在 ready 后自己关闭并报错；放进 Job Object 失败的进程立刻关闭，不留下没有兜底的进程。

**没有任何可用模型时**（新装、没登录、环境和 `.env` 里也没有 key）：omp 18.12.6 的 `--mode rpc-ui` 握手前就以 1 退出，stderr `No default model selected. …`（源码 `main.ts`：非交互模式 `!session.model` 就 `process.exit(1)`，没有开关）。服务进程起不来，设置页连 `get_login_providers` 都拿不到，也就没法登录（2026-10-26 用户反馈）。处理：`IdleOmpOptions.relaunch` 在握手前退出时拿到退出信息，`service-omp.ts` 认出这两句（`NO_MODEL_EXIT`）就带 `--model <PLACEHOLDER_MODEL>` 再起一次（只一次）。实测（omp 18.12.6，空 agent 目录，key 变量全部去掉）：带内置目录里有的模型能起来，`get_login_providers` 正常、`get_state.model` 是这个占位、`get_available_models` 0 个，agent 目录里不多写配置；目录里没有的模型照样退出。占位起的进程 `serviceHasNoModel()` 为真，`readDefaultModel` 返回 null（界面按"没有默认模型"）。登录、存 key、改自定义提供商后都会关掉服务进程，下次按正常参数起。项目目录的 rpc-ui 池（`project-omp.ts`）不做：没有模型时任务本来也跑不了。e2e：`settings-functional.e2e.ts`「没有任何凭据」。

## 自定义模型（第三方 API 提供商）：omp 没有写 `models.yml` 的接口

实测/查证（omp 18.12.1，2026-10-18）：

- 自定义 provider 只能写在 `<agent 目录>/models.yml`（`omp://models.md`）：`providers.<id>` 下有 `baseUrl`、`apiKey`（环境变量名或字面量，`!命令` 取密钥）、`api`、`auth`、`models[]` 和 `discovery`。非法文件时 omp 退回内置模型，错误经 `ModelRegistry.getError()` 暴露。
- **写入接口：没有。** 查过：`omp config`（只有 `list/get/set/reset/path/init-xdg`，键必须在设置 schema 里）；RPC wire schema 全部命令（`rpc-wire.generated.ts`，没有 provider/models 的增删改）；`omp models`（只有 `ls/find/refresh`）；`--config <overlay>`（设置叠加层，不含 `providers`）。唯一的"程序化"入口是扩展 API `pi.registerProvider(...)`（进程内注册，不落盘）。
- 读：`omp models --json` / `get_available_models` 能读到合并后的模型列表（含自定义的），但不暴露 `models.yml` 原文，也不暴露 transport `api`。
- 按 [omp-boundaries.md](omp-boundaries.md) 原本不该写 `models.yml`；仓库所有者在四个方案（直接改 `models.yml` / 只生成 YAML 片段 / 给 omp 提 PR / 自带扩展）里选了**方案 1：omp-studio 直接改 `models.yml`**，作为"自己写 omp 配置"的例外（所有者定，2026-10-18）。实现、校验、key 存法、一键拉取、保存后 omp 如何重新加载见 `custom-models.md`。

## 界面（3.2）

设置 → Provider 与订阅只列"已连接"（`ProviderRow` 卡片：单色 logo（`ProviderLogo.tsx`，图形拷自 LobeHub Icons，没有的写首字母）+ 名称 + 一个 sm 按钮（登录 / 退出；"设置 / 更换 key"收进 ⋯），下面一行徽标 + 元信息）和自定义提供商；没连接的不铺开，页头"连接提供商…"打开 `ProviderPickDialog`（可搜索），选中后进 `ProviderFlowDialog`：OAuth 进度、授权码 / API key 输入、选账号退出、失败重试都在这一个对话框里走。详细规格见 spec §4.20。
