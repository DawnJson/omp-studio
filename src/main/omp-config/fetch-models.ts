// 一键拉取：GET 第三方地址的模型列表。OpenAI 兼容：`<baseUrl>/models`，`Authorization: Bearer`；
// Anthropic：`<baseUrl 去掉末尾 /v1>/v1/models`，`x-api-key` + `anthropic-version`；
// Gemini（`google-generative-ai`）：`<baseUrl>/models?pageSize=1000`，`x-goog-api-key`，只留能 `generateContent` 的（嵌入模型不要）。
// 列表自己说是生图模型的记下来（FetchedModel.imageModel）：new-api 系的 `supported_endpoint_types` 里有 `image-generation`，
// 或输出只有图片（omp 的 openai-models-list 发现读的那几个字段）。
// 只在主进程里发（渲染进程的 CSP 不允许连外网，key 也不应该出现在渲染进程的网络层）。key 不进日志、不进错误。
import {
  isFetchableApi,
  isValidEnvName,
  normalizeBaseUrl,
  type FetchedModel,
  type FetchModelsOutcome,
} from "../../shared/custom-models.ts";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_MODELS = 2000;

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export function modelsUrl(baseUrl: string, api: string): string {
  if (api === "anthropic-messages") return `${baseUrl.replace(/\/v1$/, "")}/v1/models`;
  // Gemini 一页最多 1000 个，一次拿完，不跟 nextPageToken。
  if (api === "google-generative-ai") return `${baseUrl}/models?pageSize=1000`;
  return `${baseUrl}/models`;
}

/** omp 的 apiKey 规则（omp://models.md）：先当环境变量名，变量没设或为空时才把字面量当 key。 */
export function resolveKeyToken(raw: string, env: Record<string, string | undefined>): string | null {
  if (raw.startsWith("!")) return null; // 命令取密钥：拉取时不执行任何命令
  if (isValidEnvName(raw)) {
    const fromEnv = env[raw];
    if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  }
  return raw;
}

/** Gemini 的条目：`name` 是 `models/<id>`，`displayName` 是显示名；`supportedGenerationMethods` 里没有 `generateContent` 的不是对话模型。 */
function geminiEntry(entry: Record<string, unknown>): { id: unknown; display: unknown } | null {
  const methods = entry["supportedGenerationMethods"];
  if (Array.isArray(methods) && !methods.includes("generateContent")) return null;
  const name = entry["name"];
  return { id: typeof name === "string" ? name.replace(/^models\//, "") : name, display: entry["displayName"] };
}

/**
 * 列表这一行说它是不是生图模型,没说为 null(规则见 FetchedModel.imageModel;输出模态的读法和 omp 的 `collectModalities` 一样,转小写去重)。
 * new-api 的 `supported_endpoint_types` 是按模型名猜的(`IsImageGenerationModel` 认 `gpt-image-`、`flux-`、`qwen-image` 等),
 * 名字不在它的表里的生图模型(seedream、nano-banana、recraft......)只列 `openai`,所以没有 `image-generation` 不算"不是生图"。
 */
function listedAsImage(entry: Record<string, unknown>): boolean | null {
  const endpoints = entry["supported_endpoint_types"];
  if (Array.isArray(endpoints) && endpoints.includes("image-generation")) return true;
  const architecture = entry["architecture"];
  const outputs = new Set<string>();
  for (const value of [
    entry["output"],
    entry["output_modalities"],
    typeof architecture === "object" && architecture !== null
      ? (architecture as Record<string, unknown>)["output_modalities"]
      : undefined,
  ]) {
    if (!Array.isArray(value)) continue;
    for (const modality of value as unknown[]) if (typeof modality === "string") outputs.add(modality.toLowerCase());
  }
  return outputs.size === 0 ? null : outputs.size === 1 && outputs.has("image");
}

function parseModels(body: unknown, api: string): FetchedModel[] | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const list: unknown = Array.isArray(record["data"]) ? record["data"] : record["models"];
  if (!Array.isArray(list)) return null;
  const seen = new Set<string>();
  const out: FetchedModel[] = [];
  for (const item of list as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Record<string, unknown>;
    const fields =
      api === "google-generative-ai" ? geminiEntry(entry) : { id: entry["id"], display: entry["display_name"] };
    if (fields === null) continue;
    const { id, display } = fields;
    if (typeof id !== "string" || id === "" || id.length > 200 || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: typeof display === "string" && display !== "" ? display : null,
      imageModel: listedAsImage(entry),
    });
    if (out.length >= MAX_MODELS) break;
  }
  return out;
}

/** token 为 null = 不带 key。 */
export async function fetchModelList(
  fetchFn: FetchFn,
  request: { baseUrl: string; api: string; token: string | null },
): Promise<FetchModelsOutcome> {
  const baseUrl = normalizeBaseUrl(request.baseUrl);
  if (baseUrl === null) return { ok: false, code: "invalid-url" };
  if (!isFetchableApi(request.api)) return { ok: false, code: "unsupported" };
  const headers: Record<string, string> = { accept: "application/json" };
  if (request.token !== null) {
    if (request.api === "anthropic-messages") {
      headers["x-api-key"] = request.token;
      headers["anthropic-version"] = "2023-06-01";
    } else if (request.api === "google-generative-ai") {
      headers["x-goog-api-key"] = request.token;
    } else {
      headers["authorization"] = `Bearer ${request.token}`;
    }
  }
  let response: Response;
  try {
    // redirect: error — 不把 key 带到别的主机去。
    response = await fetchFn(modelsUrl(baseUrl, request.api), {
      method: "GET",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return { ok: false, code: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
  // Gemini 对无效 key 回 400（INVALID_ARGUMENT "API key not valid"），不是 401。
  if (
    response.status === 401 ||
    response.status === 403 ||
    (response.status === 400 && request.api === "google-generative-ai")
  )
    return { ok: false, code: "unauthorized", status: response.status };
  if (response.status === 404) return { ok: false, code: "not-found", status: 404 };
  if (!response.ok) return { ok: false, code: "http", status: response.status };
  let body: unknown;
  try {
    const text = await response.text();
    if (text.length > MAX_BODY_BYTES) return { ok: false, code: "format" };
    body = JSON.parse(text);
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return { ok: false, code: name === "TimeoutError" || name === "AbortError" ? "timeout" : "format" };
  }
  const models = parseModels(body, request.api);
  return models === null ? { ok: false, code: "format" } : { ok: true, models };
}
