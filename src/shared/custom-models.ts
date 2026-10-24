// 自定义模型（设置 → 提供商与账号 → 自定义 provider）：界面和主进程共用的类型和校验。
// 对应 omp 的 `models.yml` 里的 `providers.<id>`（omp://models.md）。纯逻辑，不引 React、DOM 或 Node。
import { apiKeyEnvName, isProviderKeyEnv } from "./provider-keys.ts";

/** omp 的聊天传输 `api`（omp://models.md "Allowed provider/model api values" 去掉判定类和 runner 类）。 */
const knownApis = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
  "openai-codex-responses",
  "azure-openai-responses",
  "bedrock-converse-stream",
  "google-gemini-cli",
  "google-vertex",
] as const;
/** 表单下拉里直接提供的几种；现有条目是别的 api 时界面会把它原样加进选项里。 */
export const formApis = ["openai-completions", "openai-responses", "anthropic-messages"] as const;
/** 一键拉取能处理的 api：OpenAI 兼容的 `/models` 和 Anthropic 的 `/v1/models`。 */
const fetchableApis = ["openai-completions", "openai-responses", "anthropic-messages"] as const;

/**
 * 自动发现模型时 `discovery.type` 的默认值，按接口类型选（omp://models.md「Allowed auth/discovery values」、`config/model-registry.ts`）：
 * OpenAI 兼容的两种读 `{baseUrl}/models` → `openai-models-list`；Anthropic 的转发站读 `GET /v1/models`，每个模型的 api 由 omp 自己判断 → `proxy`。
 * 其它 api（Google、Bedrock……）没有通用的发现方式，返回 null。
 */
export function defaultDiscoveryType(api: string): string | null {
  switch (api) {
    case "openai-completions":
    case "openai-responses":
      return "openai-models-list";
    case "anthropic-messages":
      return "proxy";
    default:
      return null;
  }
}

export const limits = {
  providerId: 64,
  url: 2048,
  modelId: 200,
  modelName: 200,
  models: 500,
  key: 4096,
  envName: 128,
  /** contextWindow / maxTokens 的上限（token）。omp 没有上限，这里只挡明显输错的数。 */
  tokens: 100_000_000,
} as const;

/**
 * 环境变量的值从哪来（omp 启动时进程里已有的变量优先，其次才是 `.env` 文件，omp://providers.md「.env discovery」）：
 * system = studio 的进程环境里有（系统 / 用户环境变量，omp 继承它，`.env` 里同名的不生效）；
 * env-file = agent 目录的 `.env` 里有；missing = 两处都没有（可能在项目或别的 `.env` 里，studio 不管那些）。
 */
export type EnvSource = "system" | "env-file" | "missing";

export type CustomKeyState =
  | { kind: "none" }
  | { kind: "literal" }
  | { kind: "env"; name: string; source: EnvSource }
  /** `!命令` 取密钥（omp://models.md "Command-resolved secrets"）：界面只显示状态，保存时原样保留。 */
  | { kind: "command" };

export interface CustomModelEntry {
  id: string;
  name: string | null;
}

/**
 * 模型条目上的能力参数（models.yml 的 `reasoning`、`input`、`contextWindow`、`maxTokens`，omp://models.md）。
 * null = 文件里没写：omp 按模型 id 从它的内置目录补，目录里没有就用默认（不思考、只收文字、上下文 128000、输出 16384；
 * omp 18.12.6 实测）。
 */
export interface CustomModelMeta {
  reasoning: boolean | null;
  /** `input` 里有没有 `image`。 */
  images: boolean | null;
  contextWindow: number | null;
  maxTokens: number | null;
}

/** 从 `models.yml` 读出来的一个 provider。**不含 key 的内容**。 */
export interface CustomProviderInfo {
  id: string;
  baseUrl: string | null;
  api: string | null;
  key: CustomKeyState;
  models: (CustomModelEntry & CustomModelMeta)[];
  /** 配了 `discovery`：模型由 omp 运行时发现，列表可以为空。 */
  discovery: boolean;
  /** `modelOverrides` 里写了能力参数的模型（只有 `name`、`compat` 这类别的键的不算）。 */
  overrides: ({ id: string } & CustomModelMeta)[];
}

export interface CustomModelsFileInfo {
  /** `models.yml` 的路径（可能还不存在）。设置页只用来在文件夹里显示。 */
  path: string;
  exists: boolean;
  providers: CustomProviderInfo[];
}

/**
 * 保存时对 key 的指示：keep = 不动现有的；none = 无需 key（`auth: none`）；literal = 写入密钥；
 * env = `apiKey` 写环境变量名，`value` 非空时把 key 写进 agent 目录的 `.env`（`NAME=value`，只改这一行），空 = 不动 `.env`。
 */
export type CustomKeyInput =
  | { kind: "keep" }
  | { kind: "none" }
  | { kind: "literal"; value: string }
  | { kind: "env"; name: string; value?: string };

/** 写进 `apiKey` 的值。 */
export type CustomKeyValue = { kind: "literal"; value: string } | { kind: "env"; name: string; value?: string };

/** 只覆盖 omp 内置 provider 的条目（如 `anthropic` 下只有 `modelOverrides`）保存时的内容（`saveProviderOverride`）。 */
export interface ProviderOverrideInput {
  /** keep = 不动 `apiKey`；null = 去掉（omp 用登录的凭据）。 */
  key: CustomKeyValue | { kind: "keep" } | null;
  /** `modelOverrides` 里各模型的能力参数；不在列表里的模型去掉这几项，条目里别的键（`name`、`compat`……）原样。 */
  models: ({ id: string } & CustomModelMeta)[];
}

export interface CustomProviderInput {
  id: string;
  baseUrl: string;
  api: string;
  key: CustomKeyInput;
  /** name 缺省 = 不动现有的名字；能力参数和文件里现有的值一样时不动（保留原来的写法），null = 去掉这一项。 */
  models: ({ id: string; name?: string } & CustomModelMeta)[];
  /**
   * 自动发现模型（`providers.<id>.discovery`）：true = 没有就按 api 写默认的 `{type}`，已有的（含类型、timeoutMs 等）原样保留；
   * false = 去掉 `discovery`；缺省 = 不动。
   */
  discovery?: boolean;
}

export type CustomModelsErrorCode =
  | "invalid-id"
  | "invalid-url"
  | "invalid-api"
  | "invalid-key"
  | "invalid-models"
  | "needs-model"
  | "exists"
  | "not-found"
  | "unreadable-file"
  | "legacy-json"
  /** `.env` 里这个变量的写法（如跨行的引号值）没法只改一行而不碰别的变量：不写，让用户自己改。 */
  | "unsafe-env";

/** 保存成功时 `envShadowed` = 写进 `.env` 的变量在系统环境变量里也有：omp 用系统的那个，`.env` 里的值不生效。 */
export type CustomModelsOutcome = { ok: true; envShadowed?: string } | { ok: false; code: CustomModelsErrorCode };

export interface FetchModelsRequest {
  baseUrl: string;
  api: string;
  key: CustomKeyInput;
  /** key 为 keep 时，用这个 provider 在文件里已有的 key。 */
  providerId?: string;
}

type FetchModelsErrorCode =
  | "invalid-url"
  | "invalid-key"
  | "unsupported"
  | "command-key"
  | "network"
  | "timeout"
  | "unauthorized"
  | "not-found"
  | "http"
  | "format";

export type FetchModelsOutcome =
  { ok: true; models: CustomModelEntry[] } | { ok: false; code: FetchModelsErrorCode; status?: number };

const providerIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const envNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const controlPattern = /\p{Cc}/u;

export function isValidProviderId(id: string): boolean {
  return id.length > 0 && id.length <= limits.providerId && providerIdPattern.test(id);
}

/** http/https、无用户名密码；返回规范化后的地址（去掉末尾的 `/`），不合格返回 null。 */
export function normalizeBaseUrl(raw: string): string | null {
  const text = raw.trim();
  if (text === "" || text.length > limits.url || controlPattern.test(text) || /\s/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "" || url.hostname === "") return null;
  return text.replace(/\/+$/, "");
}

export function isKnownApi(api: string): boolean {
  return (knownApis as readonly string[]).includes(api);
}

export function isFetchableApi(api: string): boolean {
  return (fetchableApis as readonly string[]).includes(api);
}

export function isValidEnvName(name: string): boolean {
  return name.length > 0 && name.length <= limits.envName && envNamePattern.test(name);
}

/**
 * 选"环境变量"时预填的变量名：omp 认识的内置 provider 用它自己的变量名（`anthropic` → `ANTHROPIC_API_KEY`），
 * 其余由 ID 推出来：大写、非字母数字换成 `_`、加 `_API_KEY`（`my-proxy` → `MY_PROXY_API_KEY`）。ID 还空着时是空串。
 */
export function defaultEnvName(providerId: string): string {
  const known = apiKeyEnvName(providerId);
  if (known !== null) return known;
  const stem = providerId
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (stem === "") return "";
  const name = `${/^[0-9]/.test(stem) ? "_" : ""}${stem}_API_KEY`;
  return name.slice(0, limits.envName);
}

/**
 * 字面量 key：非空、无控制字符、不以 `!` 开头。
 * `!` 开头的值会被 omp 当命令执行（omp://models.md），这里只允许保留文件里已有的，不允许从界面新写入。
 */
export function isValidLiteralKey(value: string): boolean {
  return value.trim() !== "" && value.length <= limits.key && !controlPattern.test(value) && !value.startsWith("!");
}

export function isValidModelId(id: string): boolean {
  return id.trim() === id && id.length > 0 && id.length <= limits.modelId && !controlPattern.test(id);
}

export function isValidModelName(name: string): boolean {
  return name.trim() === name && name.length > 0 && name.length <= limits.modelName && !controlPattern.test(name);
}

export function isValidTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= limits.tokens;
}

/**
 * 界面里输入的 token 数：`272000`、`272,000`、`272k`、`1.05m`（不分大小写）。
 * 空 = null（交给 omp）；写不成合法 token 数的返回 undefined。
 */
export function parseTokenCount(text: string): number | null | undefined {
  const compact = text.replace(/[\s,_]/g, "");
  if (compact === "") return null;
  const match = /^(\d+(?:\.\d+)?)([km])?$/i.exec(compact);
  if (match === null) return undefined;
  const unit = match[2]?.toLowerCase();
  const number = Number(match[1]);
  // 带 k/m 时取整（1.1k 浮点乘出来是 1100.0000000000002）；不带单位的小数不是合法 token 数。
  const value = unit === undefined ? number : Math.round(number * (unit === "m" ? 1_000_000 : 1_000));
  return isValidTokenCount(value) ? value : undefined;
}

/**
 * 改完或删掉一个 provider 后，它原来引用的 `.env` 变量还留不留（主进程按它删行，删除确认框按它写明）：
 * 原来是环境变量 key、值在 agent 目录的 `.env` 里、改完后没有 provider 再引用这个名字、也不是 omp 内置 provider 认的变量名
 * → 返回这个名字（删掉 `.env` 里那一行）；否则 null（留着）。
 */
export function unusedEnvName(
  before: CustomProviderInfo | undefined,
  after: readonly CustomProviderInfo[],
): string | null {
  if (before?.key.kind !== "env" || before.key.source !== "env-file") return null;
  const name = before.key.name;
  if (isProviderKeyEnv(name)) return null;
  return after.some((provider) => provider.key.kind === "env" && provider.key.name === name) ? null : name;
}
