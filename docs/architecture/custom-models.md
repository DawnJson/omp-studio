# 自定义模型（第三方 API 提供商）

设置 → Provider 与订阅 → 自定义提供商：添加、编辑、删除 `providers.<id>`，一键拉取第三方地址的模型列表、在浮层里挑选加入，表里每行 × 移除。

实现：`src/main/omp-config/models-file.ts`（读写 `models.yml`）、`fetch-models.ts`（拉取）、`src/main/ipc/custom-model-handlers.ts`（IPC）、`src/shared/custom-models.ts`（类型和校验，界面和主进程共用）；界面 `features/settings/CustomProviders.tsx`、`CustomProviderForm.tsx`、`CustomModelList.tsx`、`ModelPicker.tsx`（拉取后的挑选浮层）。

## 为什么直接写 `models.yml`

omp 没有写它的命令或 RPC（查证见 `login.md`「自定义模型」一节）。omp-studio 自己改 `models.yml`，作为"自己写 omp 配置"的例外（仓库所有者定，2026-10-18，`login.md` 方案 1），规则在 [omp-boundaries.md](omp-boundaries.md)「自己写 omp 配置的例外」第 1 项。不扩大：别的配置文件、别的键仍然只经 omp 写。

## 文件在哪、认哪个

`omp://models.md`：agent 目录下的 `models.yml`，其次 `models.yaml`。agent 目录是 `PI_CODING_AGENT_DIR`，否则 `<家目录>/<PI_CONFIG_DIR 或 .omp>/agent`（`resolveAgentDir`，会话索引共用）。命名 profile（`OMP_PROFILE`）不认，和会话索引一样只认默认 profile。

- 两个都没有：新建 `models.yml`。
- 只有 `models.json`（旧格式，omp 启动时才迁移）：**不写**，返回 `legacy-json`，界面提示先在终端运行一次 omp；否则新建的 yml 会盖住 omp 的迁移。
- 读不懂的 YAML（语法错误、根或 `providers` 不是映射）：界面显示错误并禁用"添加提供商"，写入返回 `unreadable-file`，**不改文件**。

## 怎么改

用 `yaml` 的 Document API，只动 `providers.<id>` 里的 `baseUrl`、`apiKey`/`auth`、`api`、`models`、`discovery`（整体增删，见「自动发现模型」），以及每个模型的 `reasoning`、`input`、`contextWindow`、`maxTokens`（`models[]` 里的写在模型条目上，自动发现的写在 `modelOverrides.<id>`）：

- 注释、别的 provider、别的根键、条目里不认识的字段（`headers`、`compat`、模型的 `cost`……）原样保留。
- 模型按 `id` 复用原来的节点（其它字段和行内注释不丢），按界面顺序重排，× 掉的去掉。新增的模型写 `id`（拉取到 `display_name` 时再写 `name`），再加上不是"自动"的能力参数。
- CRLF 保持 CRLF；UTF-8 BOM 读入时去掉。
- 原子写（`writeFileAtomic`）；写前把旧内容复制成 `models.yml.bak`（只留最近一份）；同一进程里的写入串行。终端里的 omp 同时写同一文件仍可能互相覆盖：没有跨进程锁（omp 文档没给 `models.yml` 的并发保护）。
- 新增时 ID 不能已存在（`exists`），编辑时必须已存在（`not-found`：终端里被改过）；新增要至少一个模型或带 `discovery`；编辑已有 `discovery` 的条目可以清空模型。

## 校验（主进程，渲染进程传来的都不可信）

规则和上限在 `src/shared/custom-models.ts`（`limits`、各 `parse*`）。要点：

| 项       | 要点                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 错误码                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| ID       | 字母数字开头（`__proto__` 这类天然被拒）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `invalid-id`                 |
| Base URL | 只收 `http:`/`https:`、无用户名密码；保存时去掉末尾 `/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `invalid-url`                |
| 接口类型 | `omp://models.md` 的聊天 `api` 之一；下拉给 OpenAI Chat / Responses、Anthropic Messages、Google Gemini、Azure OpenAI、Amazon Bedrock。不放 `openai-codex-responses`、`google-gemini-cli`（订阅登录专用，用 omp 自己的 OAuth 凭据）和 `google-vertex`（要 GCP 项目和区域）。现有条目是别的 api 时原样保留。实测 omp 18.12.6：Gemini / Azure / Bedrock 的自定义条目 `omp models --json` 都列出，Azure 地址是 `https://<资源名>.openai.azure.com/openai/v1`、模型 id 是部署名 | `invalid-api`                |
| key      | 字面量非空、无控制字符、**不以 `!` 开头**；环境变量名合法；新增不能 `keep`；`.env` 里这个变量是改一行会带坏别的变量的写法（跨行引号值）时不写                                                                                                                                                                                                                                                                                                                                                                            | `invalid-key` / `unsafe-env` |
| 模型     | id / name 非空、无首尾空白和控制字符、不重复；数量和数值有上限                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `invalid-models`             |

`!` 开头的 `apiKey` 会被 omp 当命令执行（`omp://models.md`「Command-resolved secrets」）。界面不允许写入这种值，免得渲染进程被注入后借 `models.yml` 在用户电脑上执行任意命令；文件里已有的 `!命令` 原样保留（显示"命令取 key"，编辑时可选"保持不变"）。

## key 怎么存

`omp://models.md`：`apiKey` 先当环境变量名，变量没设或为空才把字面量当 token。所以表单给三种：

- **密钥**：`apiKey: <key>`，明文在 `models.yml` 里。omp 自己的做法，终端版也能用同一个 key；缺点是明文落盘。
- **环境变量**：`apiKey: <变量名>`，不落明文。第二个框填 key 本身（选填），保存时写进 agent 目录 `.env`（见下一节）；变量已在系统环境变量或 `.env` 里时留空。
- **无需 key**：删掉 `apiKey`，写 `auth: none`（本地服务）。

三种都用真实 omp 18.12.1 实测过（`test/custom-models-real-omp.test.ts`）。

**key 只进不出**：`listCustomProviders` 只返回状态（`none` / `literal` / `env`+变量名 / `command`）；编辑时 key 留空 = "保持不变"（`keep`），主进程内部读文件里的值。日志只记 provider id 和结果码，不记 key，也不记 URL。这和 `login.md` 里设置页填的 API key 是两回事：那个经 `omp auth import` 存进 omp 凭据库，不出现在 `models.yml` 里。

## Anthropic 格式要写 `auth: apiKey`（omp 18.13.3）

`omp://models.md`「Allowed auth/discovery values」：自定义 `anthropic-messages` 条目**没写 `auth` 时按订阅（OAuth）组装请求**，`auth: apiKey` 才是普通 API key 请求。订阅方式像 Claude Code 一样在 system 最前面加 `x-anthropic-billing-header: …; cch=…;` 和 "You are Claude Code…"；`cch` 每次请求都变，中转站的前缀缓存一直不命中，每次都按缓存写入计费。别的接口类型没有这条规则。

- 实测（omp 18.13.3，2026-10-29，临时 `PI_CODING_AGENT_DIR` 和 `USERPROFILE`，本机假 Anthropic 服务记 `system`，`omp -p` 各跑两次）：不写 `auth` 时两次的 `cch` 不同；写上 `auth: apiKey` 后 system 里没有这两段。`api` 只写在模型上、provider 这一级没写（手写的文件）时一样带 `cch`。
- 按模型算（`sendsAnthropic`）：模型自己的 `api` 优先，没写的用 provider 这一级；运行时发现模型（`discovery`）或没有模型时看 provider 这一级。有一个模型走 `anthropic-messages` 就算。
- 保存（`applyProvider`）：走 Anthropic 时写 `auth: apiKey`；已有 `auth: none`、`auth: oauth`（用户手写）不动；旧条目编辑后保存一次就补上。不再走 Anthropic 时去掉 `auth: apiKey`（它就是 omp 的默认值）。新写的 `auth`（`setAuth`）紧跟在 `apiKey` 后面、已有的原地改：`yaml` 的 `YAMLMap.set` 遇到没有的键只会追加到最后，会落在 `models` 下面。
- 读（`parseProviders`）：走 Anthropic 且没写 `auth` 的条目 `oauthShaping: true`，卡片标「缓存不命中」徽标（`custom-oauth-shaping-<id>`）。覆盖内置 provider 的条目走 `applyOverride`、不写 `auth`，不标。
- 编辑时 key 是环境变量、而这个变量哪里都没设，`保存` 停用，这种条目要先填上值才能修。

## 环境变量形式的 key 和 agent 目录的 `.env`（omp 18.12.6）

omp 启动时按顺序读 `.env`：进程环境变量优先，然后 `<项目>/.env`、agent 目录 `.env`、`~/.omp/.env`、`~/.env`，同一变量第一个非空的赢（`omp://providers.md`「.env discovery」）。studio 写 agent 目录的 `.env`（仓库所有者批准，2026-10-24；[omp-boundaries.md](omp-boundaries.md)「自己写 omp 配置的例外」第 2 项）：

- 读：`env-file.ts` 用 `util.parseEnv`（和 omp 同一种 dotenv 语法）解析，只给主进程用；渲染进程只拿到每个变量名设在哪（`CustomKeyState.env.source`：`env-file` / `system` / `missing`）。
- 变量名识别：全大写的 `apiKey` 一律当变量名；大小写混合的（`Pro_KIMI_KEY`）只有在 `.env` 或系统环境变量里确实设了才当变量名，否则当字面量 key，免得把真 key 显示到界面上。
- 写：带值保存时只改这个变量的那一行（有就就地改、保留 `export`；没有就追加），别的原样；改完再 `parseEnv` 一遍核对别的变量一个没变、这个变量就是要写的值，对不上（原来是跨行的引号值）就整次保存都不写，返回 `unsafe-env`。先写 `.env` 再写 `models.yml`，写前各留 `.bak`，同一个写队列。
- 删：provider 删掉、换了变量名或换成别的 key 写法后，原来的变量没有别的 provider 引用、也不是内置 provider 认的变量名（`provider-keys.ts`）时，删掉 `.env` 里那一行（`unusedEnvName`）。
- 写进 `.env` 的变量在系统环境变量里也有时 omp 用系统的值：保存成功后提示（`envShadowed`）。
- 拉取模型时 key 按 omp 的顺序解析：刚填、还没保存的值优先，其次进程环境变量，再次 agent 目录 `.env`。

实测（omp 18.12.6，`test/custom-models-real-omp.test.ts`"环境变量形式的 key"）：`apiKey: Pro_FAKE_KEY`、agent 目录 `.env` 里 `Pro_FAKE_KEY=<key>`，假服务要求这个 key，`get_available_models` 经自动发现拉到了模型（omp 没读到 `.env` 的话会把变量名本身当 key 发出去，拿到 401）。

## 一键拉取

主进程 `net.fetch` GET：

- OpenAI 兼容（`openai-completions`、`openai-responses`）：`<baseUrl>/models`，`Authorization: Bearer <key>`。`baseUrl` 要带 `/v1`（omp 发聊天请求也是 `<baseUrl>/chat/completions`），不带时多半 404，界面提示检查。
- Anthropic（`anthropic-messages`）：`<baseUrl 去掉末尾 /v1>/v1/models`，`x-api-key` + `anthropic-version`（`omp://models.md`：Anthropic SDK 会去掉 `baseUrl` 末尾的 `/v1` 再拼 `/v1/messages`）。
- Gemini（`google-generative-ai`）：`<baseUrl>/models`（一页取满，不翻页），`x-goog-api-key`；条目是 `name: "models/<id>"` + `displayName`，去掉前缀，`supportedGenerationMethods` 里没有 `generateContent` 的（嵌入模型）不要。Gemini 对无效 key 回 400（2026-10-25 实测官方地址），按 key 被拒处理。
- 其它 api（Azure、Bedrock……）：不支持，按钮禁用，手动添加。

响应取 `data[].id`（或顶层 `models[]`），`display_name` 当名字；去重，数量、超时、响应体大小有上限（`fetch-models.ts`）；`redirect: "error"`（key 不会被带到别的主机）。key 的解析按 omp 的规则；`!命令` 不执行，返回 `command-key`。编辑已有提供商、key 选"保持不变"时用文件里的 key。

错误都有一句人话：连不上（`network`）、超时、key 被拒（401/403）、没有这个接口（404）、别的 HTTP 状态、返回的不是模型列表。

**挑选和移除**（issue #9：拉到的模型不能默认全进表、靠取消勾选来删，用户看不出模型能删）：

- 拉取成功弹出挑选浮层（`ModelPicker.tsx`）：已在表里的勾着且停用，勾选其余的点 `添加 N 个` 才追加；`全部` 只勾 / 取消筛选出来、还不在表里的那些。
- 表里就是保存时写进 `models[]` 的，每行一个 × 移除。
- 上游下架的模型：拉取成功后，表里有、拉到的列表里没有的（`vanishedModelIds`）标 `已失效`，工具栏 `移除失效的 N 个` 一键去掉。拉取失败、还没拉取、拉取之后又改了 Base URL / 接口类型 / key（拉到的是旧服务的列表）时不标；这次手动添加的行不参与（多半是服务不列出的隐藏模型）。
- 以上是关着自动发现时；开着时见下一节。

## 自动发现模型（omp 18.12.6）

"自动发现模型"开关写 `providers.<id>.discovery: {type: …}`：omp 运行时从这个地址的模型列表接口读模型，新上架的不用手动添加、下架的自动消失。关着时是上一节的"拉取并手动挑选"。

**开着时表里就是 omp 发现的模型**（仓库所有者定，2026-11-10）：

- 行 = omp 发现的列表并上文件里 `models[]` 已有的。发现的行（`ModelRow.discovered`）和别的行一样能设四项能力参数，保存写进 `providers.<id>.modelOverrides.<模型 id>`（`CustomProviderInput.overrides`），**不写进 `models[]`**：写进去模型就钉住了，上游下架后 omp 照样列它（见下面实测）。发现的行没有类型列（生图要写进 `models[]`），公开模型目录的预填照常。
- 不能逐个移除（omp 没有排除单个发现模型的配置），`拉取模型` 和 `已失效` / `移除失效的 N 个` 不显示；手动添加照常（写进 `models[]`，给隐藏模型），这次手动加、还没保存的行可以 × 掉。文件里 `models[]` 已有的条目原样保留。开关的悬停说明写明这些，要自己挑选就关掉它。
- **列表从哪来**：文件里已有 `discovery` 时取 omp 现在给这个 provider 列出的（`listModels`）。刚打开开关、还没保存时 omp 还没读过这个条目，也没有命令或 RPC 能让它发现一个没写进文件的 provider；为了预览先写 `models.yml` 又会让"取消"也改了文件。所以按新写的 discovery 类型读同一个列表接口预览（`fetchProviderModels`，和一键拉取同一套），改了地址、接口类型或 key 防抖重读；读失败时表里清空、原因写在工具栏下。文件里原有的非默认类型（`ollama`、`lm-studio`……）一定保存过，走 omp 的列表。
- **写**（`applyProvider` → `applyModelOverrides`，和 `applyOverride` 共用）：只动 `overrides` 列出的模型的四项，值没变不碰，换回自动去掉这一项；覆盖项里别的键原样，覆盖项空了删掉，`modelOverrides` 空了删掉；没列出的模型的覆盖项不动。主进程校验：id 合法、不重复、不和 `models` 里的重复，数量有上限（`limits.discoveredOverrides`）；`modelOverrides` 不是映射时 `unreadable-file`。
- **关掉开关**：发现的行去掉，回到拉取挑选；`modelOverrides` 里原来写的留着（没有这个模型时 omp 不会凭覆盖项造出模型，见实测；再打开时值还在）。之后某个模型被加进 `models[]` 时，`applyProvider` 去掉 `modelOverrides` 里它的四项：omp 的覆盖项压在 `models[]` 上面（实测），留着表里填的值不生效。原来就在 `models[]` 里、又手写了覆盖项的组合不动。
- **类型按接口类型选**（`defaultDiscoveryType`；取值范围见 `omp://models.md`「Allowed auth/discovery values」）：`openai-completions`、`openai-responses` → `openai-models-list`（读 `{baseUrl}/v1/models`，不会再多加一个 `/v1`）；`anthropic-messages` → `proxy`（Anthropic + OpenAI 兼容的转发站：`GET /v1/models`，每个模型的 api 由它的 `supported_endpoint_types` 决定，没有时退回 provider 的 `api`）。别的接口类型没有通用的发现方式：新开启时返回 `invalid-api`，开关停用。
- **只整体增删**：`discovery` 已存在时（用户在终端里写过 `ollama`、`timeoutMs`、`injectV1` 等）开着就原样保留，不覆盖类型；关掉就整个去掉。这个键仍受 [omp-boundaries.md](omp-boundaries.md) 里 models.yml 例外的全部规则约束。
- 有 `discovery` 时可以一个模型都不留（`needs-model` 看写完之后条目里有没有 `discovery`）。
- **输入**：`CustomProviderInput.discovery?: boolean`：`true` 确保有，`false` 去掉，缺省不动。
- **刷新模型按钮**（自定义提供商标题行）：IPC `refreshModels`（`custom-model-handlers.ts`）在中性目录里跑 `omp models refresh`（`runOmpCommand` + `requireSuccess`，参数数组，env 带 omp-studio 存的 API key），完成后 `reloadServiceModels()`（关掉服务进程：它的模型注册表是启动时建的；并作废缓存的模型目录，见 login.md「模型目录和默认模型缓存优先」），渲染进程 `reloadAfterChange()` 重读；失败时 toast 显示 omp 的 stderr 末尾。
- **实测**（omp 18.12.6，临时 `PI_CODING_AGENT_DIR`，假服务 `test/fake-openai/server.ts`）：只有 `baseUrl` / `auth: none` / `api` / `discovery: {type: openai-models-list}`、没有 `models` 时，`get_available_models` 列出假服务 `/v1/models` 的模型，`omp models refresh` 退出码 0；换成 `api: anthropic-messages` + `discovery: {type: proxy}` 也读到。`omp models refresh` 对 `models.db` 里的目录强制重新拉取。
- **实测**（omp 18.18.6，2026-11-10，假服务的 `/v1/models` 运行中可改；`omp models <provider> --json` 和新进程的 `get_available_models` 一致）：
  1. 上游去掉一个发现的模型：**不刷新时 omp 仍列出它**（用 `models.db` 缓存，新进程也一样）；`omp models refresh` 之后不再列出。
  2. `modelOverrides.<id>` 对发现的模型生效，四项原样出现在列表里；目录里认识的模型只覆盖写了的项，其余仍按目录。写给不存在的 id 的覆盖项不会多出模型。
  3. `models[]` 里只写 `id`、和发现的模型同名：只列一个，上游还列着时值和发现的一样；上游去掉并刷新后**它还在**（钉住了），值回到自定义模型的兜底。
  4. 没有 `discovery` 时，`models[]` 里的模型也吃 `modelOverrides`，覆盖项赢。

## 模型的能力参数（omp 18.12.6）

模型表每行：思考（`reasoning`）、图片输入（`input: [text, image]` / `[text]`）、上下文窗口（`contextWindow`）、最大输出（`maxTokens`）。

- **"自动" = 不写这一项**，由 omp 补：按模型 `id` 查内置目录，查不到用兜底（不思考、只收文字、上下文 128K、输出 16K；`CustomProviderForm.tsx` 的 `ompFallback`；实测 + 源码 `config/model-registry.ts` 一致）。所以中转站原样转发官方模型名时可以全留自动；改了名或本地模型才需要手填。
- **id 带 `kimi` 的模型思考留"自动"会让 omp 崩**（实测 omp 18.13.1、18.13.2，2026-10-28；假 OpenAI 服务，`--mode rpc --thinking off`）：内置目录里没有的 kimi 新模型被补成不思考；思考档位 off 时，带强制工具调用的那一轮（`/force:todo` 复现）omp 抛 `ConfigurationError: Model <provider>/<id> has no supported reasoning efforts`，未捕获，进程以 1 退出。写 `reasoning: true` 不崩。源码：catalog 的 compat 对 id 含 kimi、非 Moonshot 官方地址的模型开 `disableReasoningOnForcedToolChoice`，取最低档时档位列表为空就抛错。所以中转站的 kimi 新模型要把思考设成支持；表单按公开模型目录自动预填（见下）。
- **上下文窗口只改 omp 自己的预算**（什么时候自动压缩、上下文圆环的分母），不改服务端上限；典型用法是中转站只收 272K 的 `gpt-5.5`。输入框接受 `272000`、`272k`、`1m`（`parseTokenCount`）；写不成正整数的标红，不能保存。
- **只改和文件里不同的项**（`applyMeta`，`models-file.ts`）：值没变不碰节点，原来的写法和行内注释不被重排；换回"自动"就删掉这一项。文件里的值是 omp 不认的形状时读成"自动"，保存时也不动它。
- **"自动"后面显示 omp 现在用的值**（`hintOf`，`CustomProviderForm.tsx`）：来自 `listModels`，只对"文件里没写这一项、omp 已经加载过"的模型显示（自动发现的模型看 `modelOverrides` 里写没写）；新拉取、还没保存的只显示"自动"，因为 omp 还没算过它。
- **omp 认不出的模型按公开模型目录预填**（仓库所有者定，2026-10-28：数据来源 models.dev，思考、图片输入、上下文都填，新模型和已保存留"自动"的都填）：表单里每个模型 id 查 `https://models.dev/api.json`（omp 的联网模型表也来自它；整份约 6 MB，主进程一次运行只下一次，失败记日志、下次再下；`model-catalog.ts`，IPC `lookupModelCapabilities`；测试用 `STUDIO_MODELS_DEV_URL` 指到假服务）。按 id 最后一段、不分大小写匹配；同一模型有多家条目时用厂商自己的那条，没有就按多数。只把"支持"的思考 / 图片输入和上下文窗口填进还是"自动"的格子（目录说不支持的留自动，omp 默认就是不支持）；最大输出各家差别太大不填；保存才写进文件。已保存的模型，omp 给"自动"项补出了不是兜底的值就算 omp 认识它，不覆盖；最大输出不参与判断（开了自动发现时 omp 会用中转站 `/models` 给的值）。编辑时等 omp 的模型列表读完再查。
- **输入**：`CustomProviderInput.models[]` 每项 `{ id, name?, reasoning, images, contextWindow, maxTokens }`，四项都可以是 null（自动）。

## 生图模型（omp 18.14.0）

omp 的 `generate_image` 工具用 `modelRoles.image` 的模型，工具本身要 `generate_image.enabled: true` 才注册（`omp://tools/generate_image.md`，默认关）。自定义 provider 里的模型要被当成生图模型，靠模型条目上的 runner 接口或 `kind`（`omp://models.md`「runner API」）：

- **写法按 provider 的接口类型**（`imageModelField`）：`openai-completions` / `openai-responses` → 模型上写 `api: openai-images`（`POST <baseUrl>/images/generations`）；`google-generative-ai` → 写 `kind: image`（同一个 `:generateContent`）；其余接口（Anthropic、Azure、Bedrock）没有 omp 认的生图写法，类型列只能选"对话"，原来就是生图的原样保留，新标的存不了（主进程同样拒，`invalid-api`）。
- **读**（`isImageModel`）：模型上 `api: openai-images` 或 `kind: image` 就是生图。**写**（`applyKind`）：只动这两个键，改回对话时去掉它们，模型上别的 `api` 不碰；`image` 缺省 = 不动。标成生图时对话的四项清成"自动"，生图行不显示这四格。
- **输入**：`CustomProviderInput.models[].image?: boolean`；IPC 校验为布尔。
- **自动标生图**：一键拉取或手动添加的模型，表单按下面的顺序认它是不是生图，认出来的类型列自动填 `生图`；已保存的、用户在类型列里改过的行（`image` 已有值）不再动，所以改回 `对话` 不会被改回去。接口类型不能生图时一律不标。
  - 中转站列表（`listedAsImage`，`fetch-models.ts`，结果在 `FetchedModel.imageModel`：`true` / `false` / 没说 `null`）：new-api 系每个模型带 `supported_endpoint_types`，有 `image-generation` 就是生图；**没有不算不是**：new-api 按模型名猜端点（`common/endpoint_type.go` 的 `IsImageGenerationModel`，只认少数前缀），名字不在表里的生图模型只列 `openai`（2026-10-30 看一家 new-api 中转站的公开 `/api/pricing`：seedream、nano-banana、recraft 等只列 `openai`）。列了输出模态的（`output` / `output_modalities` / `architecture.output_modalities`），只有图片才是、又出文字的不是，读法和 omp 的 `collectModalities` 一样。
  - 列表没说时看公开模型目录（`catalogSaysImage`，`model-catalog.ts`）：OpenAI 兼容接口只认生图专用的（输出只有图片，或目录里 `type: image` 且没有上下文窗口），`gpt-5-image`、`gemini-*-image` 这类又出文字又出图的当对话模型（omp 会把 `api: openai-images` 的模型请求到 `/images/generations`）；Gemini 接口下输出里有图片就算（同一个端点）。目录查不到的留 `对话`。
- 生图模型不在对话模型里（实测 18.14.0：默认的 `omp models --json` 不列 `kind: image`，`--kind all` 才列），所以出现在 设置 → 模型角色 → 特定能力的模型 → Image 的下拉里（`listRunnerModels`），不出现在输入框的模型选择里。工具与权限页的常用项里有"图片生成"开关（`generate_image.enabled`）。
- **实测**（omp 18.14.0，2026-10-30，临时 `PI_CODING_AGENT_DIR`，本机假中转站；`models.yml` 由 `applyProvider` 生成，`config.yml` 写 `modelRoles.image` 和 `generate_image.enabled: true`）：`api: openai-images` 的模型收到 `POST /v1/images/generations`，Gemini 接口下 `kind: image` 的收到 `POST /v1beta/models/<id>:generateContent`，工具结果都是 `Generated 1 image(s)`。两样都没写（如 `gpt-image-2`、`dall-e-3`）时 omp 把它列成对话模型。

## 拉取失败标在卡片上

`CustomProviderForm` 记下最近一次拉取用的连接指纹（Base URL、接口类型、key 分段和输入）和结果。保存成功时：指纹和保存的一致，就写进 `custom-models-store.ts` 的 `setFetchFailure`（失败记 code 和状态码，成功清掉）；不一致但连接改过，清掉（原结果不再适用）。不保存就关时，只有拉取用的是打开时原样的连接才记。`unsupported`、`command-key` 说明不了 key 和地址能不能用，不记。只在渲染进程内存里，不落盘、不进日志，key 不经过这里。

## 只覆盖内置 provider 的条目：只改 key（omp 18.12.6）

`providers.<id>` 下没有 `models` 也没有 `discovery` 的条目，omp 叫"Override-only provider"（`omp://models.md` Validation rules）：不新建 provider，只覆盖内置同名 provider 的某些设置（`modelOverrides`、`baseUrl`、`apiKey`、`headers`……），至少要有一项。典型是 `anthropic` 下只有 `modelOverrides`。

- 编辑表单存不了这种条目（要 Base URL、接口类型和模型，保存会把它们写进去、改掉内置 provider 的连接），所以"编辑"打开另一个对话框（`ProviderOverrideDialog.tsx`）：只改 key 和 `modelOverrides` 里各模型的能力参数，模型行是 omp 现在列出的这个 provider 的模型（`listModels`），没写的格子显示 omp 的值。
- `applyOverride`（`models-file.ts`，IPC `saveProviderOverride`）：key 只 `set` / `delete` 这个条目的 `apiKey`（环境变量形式先写 `.env`），设置时顺手去掉 `auth: none`（否则 omp 不用 key）；`modelOverrides` 里只动勾选模型的四项，没勾选的去掉这四项，覆盖项里别的键和注释原样；覆盖项空了删覆盖项，`modelOverrides` 空了删它，条目空了整个删掉（空条目 omp 判为非法，整份文件退回内置）。key 只进不出、日志只记 provider id、模型数和结果。
- 实测（omp 18.12.6，`omp token anthropic` 看 omp 实际用的凭据）：凭据库里有订阅（OAuth）时，`models.yml` 的 `apiKey` 仍然胜出；只有凭据库里的 API key 和订阅时，订阅胜出。所以这里写的 key 比"设置 API key"存进凭据库的那个和订阅都优先。
- 和保存提供商一样，成功后关掉服务进程；在跑的任务要重开才用上。

## 保存之后：omp 怎么重新加载

实测（omp 18.12.1，2026-10-18，临时 `PI_CODING_AGENT_DIR`，`test/custom-models-real-omp.test.ts`）：

- **omp 只在启动时读 `models.yml`。** 同一个 `omp --mode rpc-ui` 进程里改了文件，再发 `get_available_models` 看不到新 provider；重启进程后看得到。
- 所以保存/删除成功后主进程 `reloadServiceModels()`（关掉服务进程并作废缓存的模型目录），界面随即重读模型列表，服务进程按需重启读到新文件。
- **已经在跑的任务进程不会重新加载**，要等下次启动（新建、重启任务）；保存后的 toast 说明这一点。不强行重启任务进程：那会打断正在进行的对话。
- 新启动的任务用 `provider/modelId`，发 prompt 能到达自定义地址并拿到回复（本地假服务实测）。

## 测试

- `test/custom-models-file.test.ts`：`models.yml` 读写（保留注释 / 未知字段、增改删、key 三种写法、自动发现开关和覆盖项、能力参数、生图模型、CRLF、非法输入、读出来不含 key、文件优先级、`models.json`、读不懂不动、并发写不丢）；`.env` 只改一行、保存 / 换名 / 删除时同步 `.env`、`unsafe-env` 时两个文件都不动；`applyKey` 一组覆盖内置 provider 的 key。
- `test/custom-models-fetch.test.ts`：对本地假服务拉取的成功和各种失败、Anthropic 路径和头、重定向不跟随；列表说没说生图。
- `test/model-catalog.test.ts`：公开模型目录的汇总和查找、`catalogSaysImage` 按接口类型。
- `test/custom-models-real-omp.test.ts`（`STUDIO_REAL_OMP=1`，需要 PATH 上有 omp，不调真实模型）：真实 omp 列模型、同进程不重载、任务向假服务发 prompt；自动发现及其覆盖项、上游下架与刷新；环境变量形式的 key；能力参数被 omp 采用。
- `test/e2e/custom-models.e2e.ts`：设置页完整流程，分"自动发现模型""能力参数""生图""自动标生图""只覆盖内置 provider""环境变量形式的 key""公开模型目录"等用例；"公开模型目录"之外的用例把 `STUDIO_MODELS_DEV_URL` 指到连不上的本机端口，不连真实服务。
- 假服务：`test/fake-openai/server.ts`（`GET /v1/models`，可给指定模型带 `supported_endpoint_types`；`POST /v1/chat/completions` 流式和非流式；`GET /api.json` 假的公开模型目录）。

## 没做的

- 命名 profile（`OMP_PROFILE`）下的 agent 目录；
- `models.yml` 里模型的其它字段（`cost`、`thinking` 档位表、`headers`、`compat` 等）的界面编辑：有就保留，界面不改；
- 跨进程的写锁。

## 界面（3.2）

自定义提供商是卡片（铅笔编辑、垃圾桶删除，删除先 `ConfirmDialog`；覆盖内置 provider 的条目编辑打开 `ProviderOverrideDialog`）；添加 / 编辑是大对话框（高度跟内容走，有上限）（`CustomProviderForm`）：连接信息（ID、接口类型、Base URL、key），模型一栏顶上是工具栏（拉取模型、自动发现开关、移除失效的、筛选），下面是模型表网格（`.cp-model-table`，表头吸顶、在表里滚动）：id（可带 `已失效`）、类型、思考、图片输入、上下文窗口、最大输出、×。尺寸和布局细节见 spec §4.20。
