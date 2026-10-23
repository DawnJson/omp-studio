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
   - `notify`：推 `{type:"progress"}`。
   - `input`：推 `{type:"input", inputId}`（`inputId` 就是请求 id）；界面回答走 `answerLoginInput(inputId, value|null)`，主进程只接受仍在等的 `inputId`，回 `extension_ui_response`（`null` = `cancelled:true`）。
   - 登录用不到的 `select/confirm/editor/ask`：立刻回 `cancelled:true`，免得 omp 一直等。
2. `login` 应答 → `startLogin` resolve `{ok:true}`；`RpcCommandError`（含 secret 提示被拒）或服务进程退出 → `{ok:false, message}`，界面显示 `login.failed` 加原因；原因里带 `secret`/`terminal` 时再提示"去终端登录"并给"复制命令"。
3. **取消**：没有公开的取消命令。有未答的 `input` 就回 `cancelled:true`；否则（omp 停在等浏览器回调）关掉服务进程，`login` 随之失败，主进程按"已取消"返回，界面回到空闲。
4. 登录或登出之后界面重新读 provider、账号和模型。

## 登出和状态显示

- 状态：`authenticated` 且有账号 → `login.signedIn · <label>`（多个账号显示 `+N`）；`authenticated` 但没有账号 → 通过环境变量或配置使用（`login.viaEnv`；这是 `get_logout_accounts` 为空推出来的，**契约里 `logout` 不返回 `remainingSource`**）；有自存 key 显示"已设置 API key"。
- `logout`：1 个账号直接退出，多个先让用户选（`login.chooseAccount`）。
- 退出只影响 omp 自己存的凭据；自存的 API key 用"清除 API key"（`clearApiKey`）。

## 提供商列表：搜索、排序、登录方式

- 列表（`features/settings/ModelsSection.tsx`，纯函数在 `src/shared/ui/provider-list.ts`）：顶部搜索框按名称和 id 过滤（多个词都要命中）；已配置的（omp 报 `authenticated`，或 studio 存了 key）排前面，组内保持 omp 的顺序。
- 登录方式（`src/shared/provider-login.ts`）：`get_login_providers` 只有 `{id, name, available, authenticated}`，**没有登录方式的字段**（实测 omp 18.12.2，84 个 provider 的 `available` 全是 true），所以按实测分类。方法：隔离 agent 目录、`omp --mode rpc-ui --no-session`、对每个 provider 发 `login`，看 open_url 之后 omp 要什么：授权码/等浏览器或设备授权 = `oauth`（17 个）；"Paste your … API key" 输入框 = `api-key`（Tavily、Exa、Kagi、Parallel、DeepSeek 等 60 个）；直接以"requires interactive prompts which are not supported in RPC mode"失败 = `terminal`（github-copilot、alibaba-coding-plan、alibaba-token-plan、perplexity、snowflake、lm-studio）。没在表里的新 provider 按 `oauth` 处理（保留登录按钮，失败有原因）；omp 升级后要重测更新表。
- 界面：`oauth` 显示"登录"；`api-key` 不显示"登录"——有环境变量名（`provider-keys.ts`）的走"设置 API key"（studio 自存），没有的显示"添加 API key"，走 omp 的 `login`（key 存进 omp 的凭据库，输入框不明文显示）；`terminal` 不显示按钮，状态写"需在终端登录"。

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
- 写模型角色（`setModelRole(role, model)`；入口是设置 → 模型的默认模型和各角色下拉、模型选择对话框里点角色后的“应用”）：**一律**经 `omp config set modelRoles` 写全局（先读出全局角色表再改一项，去掉最后一个角色时 `omp config reset modelRoles`）。仓库所有者 2026-10-22 定：给角色指定模型就是全局的事；项目 `.omp/config.yml` 自带 `modelRoles.<role>` 的项目照旧用项目的值（omp 的覆盖规则），omp-studio 不写项目文件。2026-10-18 到 10-22 曾在生效的 `modelRoleStorage` 是 `project` 时改项目文件，已去掉；`modelRoleStorage` 只影响 omp 终端的模型选择器，设置页里它在“高级”。
- 草稿胶囊里改模型 / 思考强度（“用于此任务”、`Alt T`）**不写配置**：选择按草稿键记在渲染进程内存里（`composer/draft-model-choice.ts`），发第一条时随 `createTask({ model, thinkingLevel })` 进任务记录，任务以 `--model` / `--thinking` 起 omp，只对这个会话生效；没改的项不传，跟 omp 的默认值。实测（2026-10-22，omp 18.12.6，`test/e2e/model-picker.e2e.ts`）：配置里 `default: table-local/table-one`，草稿里选 table-two + high 发第一条，任务胶囊是 table-two·high，`config.yml` 没变，新草稿回到 table-one。
- 写思考强度：`omp config set defaultThinkingLevel`，永远是全局（omp 也只有角色走 `modelRoleStorage`）；入口只有设置 → 模型。

## 没有实测的

实现时没有真实账号可登录，下面都没跑过真实 OAuth：`open_url` 之后 `input` 的实际时机、取消时关闭服务进程后 `login` 应答的形状、secret 提示被拒的错误文案（所以"去终端登录"的判断是按关键词，可能漏）。截图里的 provider 列表来自 omp 18.12.1（`get_login_providers`，隔离的临时 agent 目录，全部未登录）。

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
