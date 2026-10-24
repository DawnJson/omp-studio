// 自定义模型（设置 → 提供商与账号 → 自定义 provider）：界面和主进程共用的类型和校验。
// 对应 omp 的 `models.yml` 里的 `providers.<id>`（omp://models.md）。纯逻辑，不引 React、DOM 或 Node。

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

export type CustomKeyState =
  | { kind: "none" }
  | { kind: "literal" }
  | { kind: "env"; name: string }
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
}

export interface CustomModelsFileInfo {
  /** `models.yml` 的路径（可能还不存在）。设置页只用来在文件夹里显示。 */
  path: string;
  exists: boolean;
  providers: CustomProviderInfo[];
}

/** 保存时对 key 的指示：keep = 不动现有的；none = 无需 key（`auth: none`）；literal = 写入密钥；env = 写入环境变量名。 */
export type CustomKeyInput =
  { kind: "keep" } | { kind: "none" } | { kind: "literal"; value: string } | { kind: "env"; name: string };

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
  | "legacy-json";

export type CustomModelsOutcome = { ok: true } | { ok: false; code: CustomModelsErrorCode };

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
