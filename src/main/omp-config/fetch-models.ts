// 一键拉取：GET 第三方地址的模型列表。OpenAI 兼容：`<baseUrl>/models`，`Authorization: Bearer`；
// Anthropic：`<baseUrl 去掉末尾 /v1>/v1/models`，`x-api-key` + `anthropic-version`。
// 只在主进程里发（渲染进程的 CSP 不允许连外网，key 也不应该出现在渲染进程的网络层）。key 不进日志、不进错误。
import {
  isFetchableApi,
  isValidEnvName,
  normalizeBaseUrl,
  type CustomModelEntry,
  type FetchModelsOutcome,
} from "../../shared/custom-models.ts";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_MODELS = 2000;

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export function modelsUrl(baseUrl: string, api: string): string {
  if (api === "anthropic-messages") return `${baseUrl.replace(/\/v1$/, "")}/v1/models`;
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

function parseModels(body: unknown): CustomModelEntry[] | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const list: unknown = Array.isArray(record["data"]) ? record["data"] : record["models"];
  if (!Array.isArray(list)) return null;
  const seen = new Set<string>();
  const out: CustomModelEntry[] = [];
  for (const item of list as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Record<string, unknown>;
    const id = entry["id"];
    if (typeof id !== "string" || id === "" || id.length > 200 || seen.has(id)) continue;
    seen.add(id);
    const display = entry["display_name"];
    out.push({ id, name: typeof display === "string" && display !== "" ? display : null });
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
  if (response.status === 401 || response.status === 403)
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
  const models = parseModels(body);
  return models === null ? { ok: false, code: "format" } : { ok: true, models };
}
