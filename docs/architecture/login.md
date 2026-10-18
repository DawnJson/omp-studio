# 登录、API key 和模型列表

实现：`src/main/service/`（服务进程、OAuth 登录）、`src/main/omp-manager/api-key-store.ts`、`src/main/ipc/account-handlers.ts`；界面是设置 → 模型与账号（`features/settings/ProviderRow.tsx`）。协议出处：omp 文档 `rpc.md`（`get_login_providers`、`login`、`get_logout_accounts`、`logout`，以及 `extension_ui_request` 的 `open_url`/`input`/`notify`）；`environment-variables.md` §1（API key 的变量名）。

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

## 模型列表

`listModels` 在服务进程上发 `get_available_models`（会等 omp 后台发现完成），映射成 `ModelOption`（`acceptsImages` = `input` 含 `image`）。设置页和草稿输入框的默认模型/思考强度就是 omp 的 `modelRoles.default` / `defaultThinkingLevel`：读 `omp config list` 的快照，写 `omp config set`。`modelRoles` 只能整体写（实测 18.12.1：`omp config set modelRoles.default` 报 Unknown setting），所以读出角色表只换 `default`；`defaultThinkingLevel` 不接受 `off`，胶囊里不提供。新任务启动时不传 `--model`/`--thinking`。omp-studio 不另存默认值（PLAN 设计原则 7）。`modelRoleStorage: project` 时写的仍是全局配置，项目里的 `modelRoles` 会盖过它 [推测，未实测]。

## 没有实测的

实现时没有真实账号可登录，下面都没跑过真实 OAuth：`open_url` 之后 `input` 的实际时机、取消时关闭服务进程后 `login` 应答的形状、secret 提示被拒的错误文案（所以"去终端登录"的判断是按关键词，可能漏）。截图里的 provider 列表来自 omp 18.12.1（`get_login_providers`，隔离的临时 agent 目录，全部未登录）。

## 已知风险：API key 会被 agent 执行的命令继承

自存的 key 以环境变量传给 omp 进程，omp 起的 bash 等子进程默认继承环境，所以 agent 执行的命令能读到它们。已查 `omp://providers.md`、`omp://secrets.md`、`omp://environment-variables.md`：没有"只给 provider 用、不下传给工具"的注入方式（`secrets.md` 的脱敏只处理发给模型的文本，不限制进程环境；`omp config set` 写进 `agent.db` 是另一条路，要碰 `~/.omp`，违反决策 D3）。所以保持现状，不改实现。用户要避免时：用 OAuth 登录，或不要在 omp-studio 里存 key，改在 omp 自己的配置里设置。保存时已拒绝含控制字符的 key。

## 服务进程的关闭

`ServiceOmp.close()` 会递增代号：启动到一半（准备参数、等 ready）时被关掉的进程在 ready 后自己关闭并报错；放进 Job Object 失败的进程立刻关闭，不留下没有兜底的进程。
