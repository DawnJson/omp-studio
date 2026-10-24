# 自定义模型（第三方 API 提供商）

设置 → Provider 与订阅 → 自定义提供商：添加、编辑、删除 `providers.<id>`，一键拉取第三方地址的模型列表并勾选加入。

实现：`src/main/omp-config/models-file.ts`（读写 `models.yml`）、`fetch-models.ts`（拉取）、`src/main/ipc/custom-model-handlers.ts`（IPC）、`src/shared/custom-models.ts`（类型和校验，界面和主进程共用）；界面 `features/settings/CustomProviders.tsx`、`CustomProviderForm.tsx`、`CustomModelList.tsx`。

## 为什么直接写 `models.yml`

omp 没有写它的命令或 RPC（查证见 `login.md`「自定义模型」一节）。仓库所有者 2026-10-18 选了 `login.md` 里的方案 1：omp-studio 自己改 `models.yml`，作为"自己写 omp 配置"的例外（原来还有一个是项目 `.omp/config.yml` 的 `modelRoles`，2026-10-22 去掉，现在只剩这一个），规则写在 `AGENTS.md`「omp 的边界」。不扩大：别的配置文件、别的键仍然只经 omp 写。

## 文件在哪、认哪个

`omp://models.md`：agent 目录下的 `models.yml`，其次 `models.yaml`（`models.yml` 优先）。agent 目录是 `PI_CODING_AGENT_DIR`（覆盖默认 profile），否则 `<家目录>/<PI_CONFIG_DIR 或 .omp>/agent`（`resolveAgentDir`，会话索引共用）。没有命名 profile（`OMP_PROFILE`）的处理——和会话索引一样，omp-studio 目前只认默认 profile。

- 两个都没有：新建 `models.yml`。
- 只有 `models.json`（旧格式，omp 启动时才迁移成 `models.yml`）：**不写**，返回 `legacy-json`，界面提示先在终端运行一次 omp。否则新建的 yml 会盖住 omp 的迁移。
- 读不懂的 YAML（语法错误、根不是映射、`providers` 不是映射）：读取失败时界面显示错误并禁用"添加提供商"，写入返回 `unreadable-file`，**不改文件**。

## 怎么改

用 `yaml` 的 Document API，只动 `providers.<id>` 里的 `baseUrl`、`apiKey`/`auth`、`api`、`models`、`discovery`（整体增删，见「自动发现模型」），以及每个模型的 `reasoning`、`input`、`contextWindow`、`maxTokens`（见「模型的能力参数」）：

- 注释、别的 provider、别的根键、条目里不认识的字段（`headers`、`compat`、模型的 `cost`、`thinking`……）原样保留。
- 模型按 `id` 复用原来的节点（所以模型上的其它字段和行内注释不丢），按界面顺序重排，取消勾选的从列表里去掉。新增的模型写 `id`（拉取到 `display_name` 时再写 `name`），再加上界面里不是“自动”的能力参数。
- CRLF 文件保持 CRLF；UTF-8 BOM 读入时去掉。
- 原子写（`writeFileAtomic`）；每次写之前把旧内容复制成 `models.yml.bak`（只留最近一份）；同一进程里的写入串行（读-改-写不被另一次插入）。终端里的 omp 同时写同一个文件时仍可能互相覆盖，没有跨进程锁（omp 文档没有给 `models.yml` 的并发保护）。
- 新增时 ID 不能已存在（`exists`），编辑时必须已存在（`not-found`：终端里被改过）；新增要至少一个模型，或者带 `discovery`（自动发现，见下）；编辑已有 `discovery` 的条目可以清空模型。

## 校验（主进程，渲染进程传来的都不可信）

| 项 | 规则 | 错误码 |
|---|---|---|
| ID | `^[A-Za-z0-9][A-Za-z0-9._-]*$`，最长 64（`__proto__` 这类以下划线开头的天然被拒） | `invalid-id` |
| Base URL | 能解析、`http:`/`https:`、无用户名密码、无空白和控制字符、最长 2048；保存时去掉末尾 `/` | `invalid-url` |
| 接口类型 | `omp://models.md` 的聊天 `api` 之一（界面下拉给 OpenAI Chat Completions / Responses / Anthropic Messages，现有条目是别的 api 时原样保留） | `invalid-api` |
| key | 字面量：非空、无控制字符、**不以 `!` 开头**；环境变量名：`^[A-Za-z_][A-Za-z0-9_]*$`，带的值和字面量同样规则；新增不能 `keep`；`.env` 里这个变量是改一行就会带坏别的变量的写法（跨行的引号值）时不写 | `invalid-key` / `unsafe-env` |
| 模型 | id 非空、无首尾空白和控制字符、最长 200、不重复、最多 500；name 同样规则；`contextWindow`/`maxTokens` 是 1 到 1 亿的整数或 null；`reasoning`/`images` 是布尔或 null | `invalid-models` |

`!` 开头的 `apiKey` 会被 omp 当命令执行（`omp://models.md`「Command-resolved secrets」）。界面不允许写入这种值，免得渲染进程被注入后借 `models.yml` 在用户电脑上执行任意命令；文件里已有的 `!命令` 照原样保留（显示"命令取 key"，编辑时可选"保持不变"）。

## key 怎么存

`omp://models.md`：`apiKey` 先当环境变量名，变量没设或为空才把字面量当 token。所以表单给三种：

- **密钥**：写成 `apiKey: <key>`，明文在 `models.yml` 里。这是 omp 自己的做法，终端版 omp 也能用同一个 key；缺点是明文落盘。界面里密钥输入框默认遮住，有"显示/隐藏"。
- **环境变量**：`models.yml` 里写 `apiKey: <变量名>`，不落明文。表单里第二个框填 key 本身（选填），保存时写进 agent 目录的 `.env`（`变量名=key`，见下一节）；变量已在系统环境变量或 `.env` 里时留空。
- **无需 key**：删掉 `apiKey`，写 `auth: none`（本地服务）。

三种都用真实 omp 18.12.1 实测过（`test/custom-models-real-omp.test.ts`：字面量、环境变量、`auth: none` 各一个 provider，列模型、发 prompt 都通）。

**key 只进不出**：`listCustomProviders` 返回的只有状态（`none` / `literal` / `env`+变量名 / `command`），没有 key 的内容；编辑时 key 留空 = "保持不变"（`keep`），主进程在内部读文件里的值。日志只记 provider id 和结果码（`custom provider add: saved`），不记 key，也不记 URL。这和 `login.md` 里设置页填的 API key 是两回事：那个经 `omp auth import` 存进 omp 的凭据库，不会出现在 `models.yml` 里。

## 环境变量形式的 key 和 agent 目录的 `.env`（2026-10-24，omp 18.12.6）

omp 启动时按顺序读 4 个 `.env`，进程环境变量优先，然后 `<项目>/.env`、agent 目录的 `.env`、`~/.omp/.env`、`~/.env`，同一个变量第一个非空的赢（`omp://providers.md`「.env discovery」）。仓库所有者 2026-10-24 批准 studio 写 agent 目录的 `.env`（`AGENTS.md`「omp 的边界」第二处例外）：

- 读：`env-file.ts` 用 `util.parseEnv`（和 omp 同一种 dotenv 语法）解析，只给主进程内部用；渲染进程只拿到每个变量名设在哪（`CustomKeyState.env.source`：`env-file` / `system` / `missing`），卡片显示"环境变量 X（.env / 系统 / 未设置）"。
- 变量名识别：全大写的 `apiKey` 一律当变量名；大小写混合的（`Pro_KIMI_KEY`）只有在 `.env` 或系统环境变量里确实设了才当变量名，否则当字面量 key，免得把真 key 显示到界面上。
- 写：带值保存（添加、编辑、覆盖内置 provider 的编辑）时只改这个变量的那一行（有就就地改、保留 `export`；没有就追加），注释、空行、别的变量、CRLF、BOM 原样；改完再 `parseEnv` 一遍核对别的变量一个没变、这个变量就是要写的值，对不上（原来是跨行的引号值）就整次保存都不写，返回 `unsafe-env`。先写 `.env` 再写 `models.yml`，写前各留 `.bak`，和 `models.yml` 同一个写队列。
- 删：provider 删掉、换了变量名或换成别的 key 写法后，原来的变量没有别的 provider 引用、也不是内置 provider 认的变量名（`provider-keys.ts`，比如 `ANTHROPIC_API_KEY`）时，删掉 `.env` 里那一行（`unusedEnvName`）。
- 写进 `.env` 的变量在系统环境变量里也有时，omp 用系统的值：保存成功后提示一句（`envShadowed`）。
- 拉取模型时 key 按 omp 的顺序解析：刚填、还没保存的值优先，其次进程环境变量，再次 agent 目录 `.env`。

实测（omp 18.12.6，`test/custom-models-real-omp.test.ts`"环境变量形式的 key"）：`apiKey: Pro_FAKE_KEY`、agent 目录 `.env` 里 `Pro_FAKE_KEY=<key>`，假服务要求这个 key，`get_available_models` 经自动发现拉到了它的模型（omp 没读到 `.env` 的话会把变量名本身当 key 发出去，拿到 401）。

## 一键拉取

主进程 `net.fetch` GET：

- OpenAI 兼容（`openai-completions`、`openai-responses`）：`<baseUrl>/models`，`Authorization: Bearer <key>`。`baseUrl` 要带 `/v1`（omp 发聊天请求也是 `<baseUrl>/chat/completions`），不带时多半 404，界面提示"检查 Base URL 是否带 /v1"。
- Anthropic（`anthropic-messages`）：`<baseUrl 去掉末尾 /v1>/v1/models`，`x-api-key` + `anthropic-version: 2023-06-01`（`omp://models.md`：Anthropic SDK 会去掉 `baseUrl` 末尾的 `/v1` 再拼 `/v1/messages`）。
- 其它 api（Google、Bedrock……）：不支持，按钮禁用，手动添加。

响应取 `data[].id`（或顶层 `models[]`），`display_name` 当名字；去重、最多 2000 个。超时 15 秒；`redirect: "error"`（key 不会被带到别的主机）；响应体上限 8 MB。key 的解析按 omp 的规则：环境变量名先查 `process.env`，没设就把字面量当 token；`!命令` 不执行，返回 `command-key`。编辑已有提供商、key 选"保持不变"时用文件里的 key。

错误都有一句人话：连不上（`network`）、超时、key 被拒（401/403）、没有这个接口（404）、别的 HTTP 状态、返回的不是模型列表。拉到的模型默认**不勾选**，用户勾选后保存才写进 `models[]`。


## 自动发现模型（2026-10-23，omp 18.12.6）

表单里的“自动发现模型”开关写 `providers.<id>.discovery: {type: …}`：omp 运行时从这个地址的模型列表接口读模型，新上架的模型不用再手动添加。**保留原来“拉取并手动挑选”的路径**，两者可以同时用（勾选的模型仍写进 `models[]`，发现的模型不写进文件）。

- **类型按接口类型选**（`defaultDiscoveryType`，`src/shared/custom-models.ts`；取值范围见 `omp://models.md`「Allowed auth/discovery values」和 `config/model-registry.ts`：`ollama`、`llama.cpp`、`lm-studio`、`openai-models-list`、`proxy`、`litellm`、`apple-foundation-models`）：`openai-completions`、`openai-responses` → `openai-models-list`（读 `{baseUrl}/v1/models`，不会再多加一个 `/v1`）；`anthropic-messages` → `proxy`（Anthropic + OpenAI 兼容的转发站：`GET /v1/models`，每个模型的 api 由它的 `supported_endpoint_types` 决定，没有时退回 provider 的 `api`）。别的接口类型（Google、Bedrock…）没有通用的发现方式：新开启时返回 `invalid-api`，表单里开关停用。
- **只改这一层、只整体增删**：`discovery` 已存在时（用户在终端里写过 `ollama`、`timeoutMs`、`injectV1` 等）开着就原样保留，不覆盖类型；关掉就整个去掉。这个键仍受 AGENTS.md 里 models.yml 例外的全部规则约束：`yaml` Document API、注释和别的内容原样、原子写、写前 `.bak`。
- 有 `discovery` 时可以一个模型都不选（`needs-model` 的判断看写完之后条目里有没有 `discovery`）；表单里“没有勾选模型、也没开自动发现”不能保存。
- **输入**：`CustomProviderInput.discovery?: boolean`：`true` 确保有，`false` 去掉，缺省不动。
- **刷新模型按钮**（设置 → Provider 与订阅 → 自定义提供商，标题行）：IPC `refreshModels`（`custom-model-handlers.ts`）在中性目录里跑 `omp models refresh`（`runOmpCommand` + `requireSuccess`，参数数组，超时 120 秒，env 带 omp-studio 存的 API key），完成后 `serviceOmp.close()`（服务进程的模型注册表是启动时建的），渲染进程 `reloadAfterChange()` 重读 models.yml 和模型列表；失败时 toast 显示 omp 的 stderr 末尾。
- **实测**（真实 omp 18.12.6，临时 `PI_CODING_AGENT_DIR`，本地假 OpenAI 服务 `test/fake-openai/server.ts`）：models.yml 只有 `baseUrl` / `auth: none` / `api` / `discovery: {type: openai-models-list}`、没有 `models` 时，`get_available_models` 列出假服务 `/v1/models` 里的模型，`omp models refresh` 退出码 0，`omp models fake-disco` 输出含该模型；同一个假服务换成 `api: anthropic-messages` + `discovery: {type: proxy}` 也读到同一个模型。`omp models refresh` 对 `models.db` 里的目录做强制重新拉取（omp 的帮助：“Force a fresh catalog fetch”）。

## 模型的能力参数（2026-10-24，omp 18.12.6）

对话框的模型表每个勾选的模型一行：思考（`reasoning`）、图片输入（`input: [text, image]` / `[text]`）、上下文窗口（`contextWindow`）、最大输出（`maxTokens`）。

- **“自动” = 不写这一项**，由 omp 补：按模型 `id` 查它的内置目录（例如 `gpt-5.5` → 1,050,000 上下文、支持思考和图片），查不到用默认值 **不思考、只收文字、上下文 128,000、输出 16,384**（实测：临时 agent 目录里写只有 `id` 的模型，`omp models <provider> --json` 列出的值；源码 `config/model-registry.ts` 的自定义模型合并逻辑一致）。所以中转站把官方模型名原样转发时可以全留自动；改了名或本地模型才需要手填。
- **上下文窗口只改 omp 自己的预算**（什么时候自动压缩、上下文圆环的分母），不改服务端的上限；典型用法是中转站只收 272K 的 `gpt-5.5`。输入框接受 `272000`、`272k`、`1m`（`parseTokenCount`，`src/shared/custom-models.ts`，k/m 按十进制、四舍五入到整数）；写不成正整数的标红，不能保存。
- **只改和文件里不同的项**（`applyMeta`，`models-file.ts`）：值没变就不碰节点，`input: [ text, image ]` 这类原来的写法和行内注释不被重排；换回“自动”就删掉这一项。文件里的值是 omp 不认的形状时读成“自动”，保存时也不动它。
- **“自动”后面显示 omp 现在用的值**（`hintOf`，`CustomProviderForm.tsx`）：来自模型列表（`listModels`，即服务进程的 `get_available_models`），只对“已保存、文件里没写这一项、omp 已经加载过”的模型显示（如“自动 · 128K”“自动 · 支持”）；新拉取、还没保存的模型只显示“自动”，因为 omp 还没算过它。
- **输入**：`CustomProviderInput.models[]` 每项 `{ id, name?, reasoning, images, contextWindow, maxTokens }`，四项都可以是 null（自动）。

## 只覆盖内置 provider 的条目：只改 key（2026-10-24，omp 18.12.6）

`providers.<id>` 下没有 `models` 也没有 `discovery` 的条目，omp 叫"Override-only provider"（`omp://models.md` Validation rules）：它不新建 provider，只覆盖内置同名 provider 的某些设置（`modelOverrides`、`baseUrl`、`apiKey`、`headers`……），至少要有一项。典型是 `anthropic` 下只有 `modelOverrides`（改上下文窗口）。

- 编辑表单存不了这种条目（要 Base URL、接口类型和模型，保存还会把它们写进去、改掉内置 provider 的连接），所以"编辑"打开另一个对话框（`ProviderOverrideDialog.tsx`）：只改 key 和 `modelOverrides` 里各模型的能力参数，模型行是 omp 现在列出的这个 provider 的模型（`listModels`），没写的格子显示 omp 的值。
- `applyOverride`（`models-file.ts`，IPC `saveProviderOverride`）：key 只 `set` / `delete` 这个条目的 `apiKey`（环境变量形式和别的写入一样先写 `.env`），设置时顺手去掉 `auth: none`（否则 omp 不用 key）；`modelOverrides` 里只动勾选模型的 `reasoning` / `input` / `contextWindow` / `maxTokens`，没勾选的模型去掉这四项，覆盖项里别的键（`name`、`compat`……）和注释原样；覆盖项空了删覆盖项，`modelOverrides` 空了删它，条目空了整个删掉（空条目 omp 判为非法，整份文件退回内置）。key 只进不出、日志只记 provider id、模型数和结果。
- 实测（omp 18.12.6，临时 `PI_CODING_AGENT_DIR`，`omp token anthropic` 看 omp 实际用的凭据）：凭据库里有订阅（OAuth）时，`models.yml` 的 `apiKey` 仍然胜出；只有凭据库里的 API key 和订阅时，订阅胜出。所以这里写的 key 比"设置 API key"存进凭据库的那个和订阅都优先。
- 和保存提供商一样，成功后关掉服务进程；在跑的任务要重开才用上。

## 保存之后：omp 怎么重新加载

实测（omp 18.12.1，2026-10-18，临时 `PI_CODING_AGENT_DIR`，`test/custom-models-real-omp.test.ts`）：

- **omp 只在启动时读 `models.yml`。** 同一个 `omp --mode rpc-ui` 进程里改了文件，再发 `get_available_models` 看不到新 provider；重新启动进程后看得到。
- 所以保存/删除成功后主进程 `serviceOmp.close()`（和保存 API key 一样），界面随即重读模型列表，服务进程按需重启、读到新文件；设置里的默认模型下拉和输入框的模型选择器用的就是这份列表。
- **已经在跑的任务进程不会重新加载**，要等它们下次启动（新建任务、重启任务）才看得到。保存后的 toast 说明了这一点。没有强行重启任务进程：那会打断正在进行的对话。
- 新启动的任务用 `fake-proxy/fake-chat` 这样的 `provider/modelId`，发 prompt 能到达自定义地址并拿到回复（冒烟用本地假服务实测）。

## 测试

- `test/custom-models-file.test.ts`：保留注释/别的 provider/未知字段、增改删、key 三种写法、`discovery` 条目清空模型、自动发现开关（默认类型按 api、已有 `discovery` 原样保留、关掉只去 `discovery`、没有默认类型的 api 被拒）、能力参数（写入、改一项不动别的写法、换回自动删掉、非法值被拒、`parseTokenCount`）、CRLF、`providers:` 为空值、非法输入逐项被拒、读出来的信息不含 key、大小写混合的变量名按 `.env` / 系统环境变量识别、路径含空格和中文、yml/yaml 优先级、只有 `models.json` 时不写、读不懂的文件不动、并发写不丢；`.env` 只改一行（保留 `export`、CRLF、BOM、注释、别的变量，跨行引号值拒绝）、保存 / 换名 / 删除时同步 `.env`（没人用才删、内置变量名不删、系统同名变量提示、`unsafe-env` 时两个文件都不动）。
- `test/custom-models-fetch.test.ts`：对本地假服务拉取成功、key 错、404、不通、超时、非 JSON、形状不对、Anthropic 路径和头、重定向不跟随。
- `test/custom-models-real-omp.test.ts`（`STUDIO_REAL_OMP=1`，需要 PATH 上有 omp，不调真实模型）：真实 omp 列模型、同进程不重载、任务向假服务发 prompt 并拿到回复；自动发现：只写 `discovery`、不列模型，`omp models refresh` 跑通，`omp models <provider>` 和 `get_available_models` 都列出假服务的模型（openai 兼容和 anthropic 两种 `discovery.type`）；环境变量形式的 key：大小写混合的变量名、值写进 agent 目录 `.env`，omp 读到并带着它拉到模型；能力参数：写进去的四项被 omp 采用，留空的由 omp 按 id 补。
- `test/e2e/custom-models.e2e.ts`：设置页完整流程；"自动发现模型"一条（开关、写进文件的 discovery、omp 读到 /models 的模型、刷新模型按钮、关掉后去掉 discovery）；"能力参数"一条（模型行里设四项、非法上下文不能保存、写进文件、omp 采用、自动的格子显示 omp 补的值、换回自动后从文件里去掉、对话框不越界）；"只覆盖内置 provider"一条（卡片元信息、编辑里覆盖项勾着带原值、设 key 和上下文并手动加模型后文件里别的覆盖项和注释原样、`omp token anthropic` 返回这个 key、omp 采用写进去的上下文窗口、再编辑改回不设置并取消一个模型后 apiKey 和它的覆盖项去掉）；"环境变量形式的 key"一条（变量名 + 值，拉取用刚填的值，`models.yml` 只有变量名、`.env` 追加一行且原有行和 CRLF 不变，卡片写 `（.env）`，编辑时值框提示已在 `.env` 里，删除后那一行去掉）。`test/custom-models-file.test.ts` 的 `applyKey` 一组覆盖设置、环境变量去掉 `auth: none`、清除后空条目删掉、拒绝的输入。
- 假服务：`test/fake-openai/server.ts`（`GET /v1/models`、`POST /v1/chat/completions` 流式和非流式）。

## 没做的

- 命名 profile（`OMP_PROFILE`）下的 agent 目录；
- `models.yml` 里模型的其它字段（`cost`、`thinking` 档位表、`headers`、`compat` 等）的界面编辑：条目里有就保留，界面不改；
- 跨进程的写锁。

## 界面（3.2）

自定义提供商是列表行（`编辑` + ⋯（删除，先 `ConfirmDialog`）；覆盖内置 provider 的条目编辑打开 `ProviderOverrideDialog`（key + 模型能力参数））；添加 / 编辑是 `xl` 对话框（`CustomProviderForm`），高度固定、不随模型多少变：连接信息两列（ID、接口类型、Base URL、key），窄到放不下两个 320 时变一列；自动发现、模型表、错误各占满一行。模型表是一个网格（`.cp-model-table`，表头吸顶，占满对话框剩下的高度、在表里滚动）：勾选 + id、思考、图片输入、上下文窗口、最大输出；没勾选的行只有勾选和 id。写 `models.yml` 的规则不变。
