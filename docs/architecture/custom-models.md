# 自定义模型（第三方 API 提供商）

设置 → Provider 与订阅 → 自定义提供商：添加、编辑、删除 `providers.<id>`，一键拉取第三方地址的模型列表并勾选加入。

实现：`src/main/omp-config/models-file.ts`（读写 `models.yml`）、`fetch-models.ts`（拉取）、`src/main/ipc/custom-model-handlers.ts`（IPC）、`src/shared/custom-models.ts`（类型和校验，界面和主进程共用）；界面 `features/settings/CustomProviders.tsx`、`CustomProviderForm.tsx`、`CustomModelList.tsx`。

## 为什么直接写 `models.yml`

omp 没有写它的命令或 RPC（查证见 `login.md`「自定义模型」一节）。仓库所有者 2026-10-18 选了 `login.md` 里的方案 1：omp-studio 自己改 `models.yml`，作为"自己写 omp 配置"的两个例外之一（另一个是项目 `.omp/config.yml` 的 `modelRoles`），规则写在 `AGENTS.md`「omp 的边界」。不扩大：别的配置文件、别的键仍然只经 omp 写。

## 文件在哪、认哪个

`omp://models.md`：agent 目录下的 `models.yml`，其次 `models.yaml`（`models.yml` 优先）。agent 目录是 `PI_CODING_AGENT_DIR`（覆盖默认 profile），否则 `<家目录>/<PI_CONFIG_DIR 或 .omp>/agent`（`resolveAgentDir`，会话索引共用）。没有命名 profile（`OMP_PROFILE`）的处理——和会话索引一样，omp-studio 目前只认默认 profile。

- 两个都没有：新建 `models.yml`。
- 只有 `models.json`（旧格式，omp 启动时才迁移成 `models.yml`）：**不写**，返回 `legacy-json`，界面提示先在终端运行一次 omp。否则新建的 yml 会盖住 omp 的迁移。
- 读不懂的 YAML（语法错误、根不是映射、`providers` 不是映射）：读取失败时界面显示错误并禁用"添加提供商"，写入返回 `unreadable-file`，**不改文件**。

## 怎么改

用 `yaml` 的 Document API，只动 `providers.<id>` 里的 `baseUrl`、`apiKey`/`auth`、`api`、`models`：

- 注释、别的 provider、别的根键、条目里不认识的字段（`headers`、`compat`、`discovery`、模型的 `contextWindow`/`cost`……）原样保留。
- 模型按 `id` 复用原来的节点（所以模型上的 `contextWindow` 和行内注释不丢），按界面顺序重排，取消勾选的从列表里去掉。新增的模型只写 `id`（拉取到 `display_name` 时再写 `name`）；`contextWindow`/`maxTokens` 不写，由 omp 按默认值或内置参考行补（`omp://models.md`）。
- CRLF 文件保持 CRLF；UTF-8 BOM 读入时去掉。
- 原子写（`writeFileAtomic`）；每次写之前把旧内容复制成 `models.yml.bak`（只留最近一份）；同一进程里的写入串行（读-改-写不被另一次插入）。终端里的 omp 同时写同一个文件时仍可能互相覆盖，没有跨进程锁（omp 文档没有给 `models.yml` 的并发保护）。
- 新增时 ID 不能已存在（`exists`），编辑时必须已存在（`not-found`：终端里被改过）；新增要至少一个模型，编辑已有 `discovery` 的条目可以清空模型。

## 校验（主进程，渲染进程传来的都不可信）

| 项 | 规则 | 错误码 |
|---|---|---|
| ID | `^[A-Za-z0-9][A-Za-z0-9._-]*$`，最长 64（`__proto__` 这类以下划线开头的天然被拒） | `invalid-id` |
| Base URL | 能解析、`http:`/`https:`、无用户名密码、无空白和控制字符、最长 2048；保存时去掉末尾 `/` | `invalid-url` |
| 接口类型 | `omp://models.md` 的聊天 `api` 之一（界面下拉给 OpenAI Chat Completions / Responses / Anthropic Messages，现有条目是别的 api 时原样保留） | `invalid-api` |
| key | 字面量：非空、无控制字符、**不以 `!` 开头**；环境变量名：`^[A-Za-z_][A-Za-z0-9_]*$`；新增不能 `keep` | `invalid-key` |
| 模型 | id 非空、无首尾空白和控制字符、最长 200、不重复、最多 500；name 同样规则 | `invalid-models` |

`!` 开头的 `apiKey` 会被 omp 当命令执行（`omp://models.md`「Command-resolved secrets」）。界面不允许写入这种值，免得渲染进程被注入后借 `models.yml` 在用户电脑上执行任意命令；文件里已有的 `!命令` 照原样保留（显示"命令取 key"，编辑时可选"保持不变"）。

## key 怎么存

`omp://models.md`：`apiKey` 先当环境变量名，变量没设或为空才把字面量当 token。所以表单给三种：

- **密钥**：写成 `apiKey: <key>`，明文在 `models.yml` 里。这是 omp 自己的做法，终端版 omp 也能用同一个 key；缺点是明文落盘。界面里密钥输入框默认遮住，有"显示/隐藏"。
- **环境变量**：写 `apiKey: <变量名>`，不落明文；omp 启动时读这个变量。变量要在启动 omp 的环境里（用户环境变量，或终端里设的）。
- **无需 key**：删掉 `apiKey`，写 `auth: none`（本地服务）。

三种都用真实 omp 18.12.1 实测过（`test/custom-models-real-omp.test.ts`：字面量、环境变量、`auth: none` 各一个 provider，列模型、发 prompt 都通）。

**key 只进不出**：`listCustomProviders` 返回的只有状态（`none` / `literal` / `env`+变量名 / `command`），没有 key 的内容；编辑时 key 留空 = "保持不变"（`keep`），主进程在内部读文件里的值。日志只记 provider id 和结果码（`custom provider add: saved`），不记 key，也不记 URL。这和 `login.md` 里 omp-studio 自己用 `safeStorage` 存的 API key 是两回事：那个不写 omp 的配置，也不会出现在 `models.yml` 里。

## 一键拉取

主进程 `net.fetch` GET：

- OpenAI 兼容（`openai-completions`、`openai-responses`）：`<baseUrl>/models`，`Authorization: Bearer <key>`。`baseUrl` 要带 `/v1`（omp 发聊天请求也是 `<baseUrl>/chat/completions`），不带时多半 404，界面提示"检查 Base URL 是否带 /v1"。
- Anthropic（`anthropic-messages`）：`<baseUrl 去掉末尾 /v1>/v1/models`，`x-api-key` + `anthropic-version: 2023-06-01`（`omp://models.md`：Anthropic SDK 会去掉 `baseUrl` 末尾的 `/v1` 再拼 `/v1/messages`）。
- 其它 api（Google、Bedrock……）：不支持，按钮禁用，手动添加。

响应取 `data[].id`（或顶层 `models[]`），`display_name` 当名字；去重、最多 2000 个。超时 15 秒；`redirect: "error"`（key 不会被带到别的主机）；响应体上限 8 MB。key 的解析按 omp 的规则：环境变量名先查 `process.env` 和 omp-studio 自存的 key（`getApiKeyEnv`），没设就把字面量当 token；`!命令` 不执行，返回 `command-key`。编辑已有提供商、key 选"保持不变"时用文件里的 key。

错误都有一句人话：连不上（`network`）、超时、key 被拒（401/403）、没有这个接口（404）、别的 HTTP 状态、返回的不是模型列表。拉到的模型默认**不勾选**，用户勾选后保存才写进 `models[]`。

## 保存之后：omp 怎么重新加载

实测（omp 18.12.1，2026-10-18，临时 `PI_CODING_AGENT_DIR`，`test/custom-models-real-omp.test.ts`）：

- **omp 只在启动时读 `models.yml`。** 同一个 `omp --mode rpc-ui` 进程里改了文件，再发 `get_available_models` 看不到新 provider；重新启动进程后看得到。
- 所以保存/删除成功后主进程 `serviceOmp.close()`（和保存 API key 一样），界面随即重读模型列表，服务进程按需重启、读到新文件；设置里的默认模型下拉和输入框的模型选择器用的就是这份列表。
- **已经在跑的任务进程不会重新加载**，要等它们下次启动（新建任务、重启任务）才看得到。保存后的 toast 说明了这一点。没有强行重启任务进程：那会打断正在进行的对话。
- 新启动的任务用 `fake-proxy/fake-chat` 这样的 `provider/modelId`，发 prompt 能到达自定义地址并拿到回复（冒烟用本地假服务实测）。

## 测试

- `test/custom-models-file.test.ts`：保留注释/别的 provider/未知字段、增改删、key 三种写法、`discovery` 条目清空模型、CRLF、`providers:` 为空值、非法输入逐项被拒、读出来的信息不含 key、路径含空格和中文、yml/yaml 优先级、只有 `models.json` 时不写、读不懂的文件不动、并发写不丢。
- `test/custom-models-fetch.test.ts`：对本地假服务拉取成功、key 错、404、不通、超时、非 JSON、形状不对、Anthropic 路径和头、重定向不跟随。
- `test/custom-models-real-omp.test.ts`（`STUDIO_REAL_OMP=1`，需要 PATH 上有 omp，不调真实模型）：真实 omp 列模型、同进程不重载、任务向假服务发 prompt 并拿到回复。
- `test/e2e/custom-models.e2e.ts`：设置页完整流程，截图中英 × 浅深。
- 假服务：`test/fake-openai/server.ts`（`GET /v1/models`、`POST /v1/chat/completions` 流式和非流式）。

## 没做的

- 命名 profile（`OMP_PROFILE`）下的 agent 目录；
- `models.yml` 里的其它字段（`headers`、`compat`、`cost`、`contextWindow` 等）的界面编辑：条目里有就保留，界面不改；
- 跨进程的写锁。

## 界面（3.2）

自定义提供商是列表行（编辑按钮 + ⋯ 里的删除，删除先 `ConfirmDialog`）；添加 / 编辑是对话框（`CustomProviderForm`，竖排字段），页面上的"添加"在对话框打开时不再被禁用。写 `models.yml` 的规则不变。
