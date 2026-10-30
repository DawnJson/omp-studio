// 公开模型目录 models.dev（https://models.dev/api.json，omp 的联网模型表也来自它）：按模型 id 查能不能思考、收不收图片、上下文多大、
// 输出文字还是图片，给自定义提供商表单预填 omp 认不出的模型、认出生图模型。整份目录一次运行只下一次（约 6 MB，压缩后约 600 KB），
// 失败了下次再试。
// 测试用 STUDIO_MODELS_DEV_URL 指到本地假服务。
import type { ModelCapabilities } from "../../shared/custom-models.ts";
import { log } from "../log/log.ts";
import type { FetchFn } from "./fetch-models.ts";

const CATALOG_URL = "https://models.dev/api.json";
const FETCH_TIMEOUT_MS = 20_000;
const MAX_BODY_CHARS = 64 * 1024 * 1024;

/** 中转站的模型名可能带厂商前缀（`moonshotai/kimi-k3.1-pro`），大小写也不一定：取最后一段、转小写。 */
export function catalogKey(id: string): string {
  return id.slice(id.lastIndexOf("/") + 1).toLowerCase();
}

interface Entry {
  provider: string;
  /** 目录里的原 id 带的厂商前缀（`moonshotai/…` 的 `moonshotai`），没有为 null。 */
  vendor: string | null;
  caps: ModelCapabilities;
}

function entryCaps(model: Record<string, unknown>): ModelCapabilities {
  const modalities = model["modalities"] as { input?: unknown; output?: unknown } | undefined;
  const limit = model["limit"] as { context?: unknown } | undefined;
  const context = limit?.context;
  const contextWindow = typeof context === "number" && Number.isInteger(context) && context > 0 ? context : null;
  const output = Array.isArray(modalities?.output) ? modalities.output : ["text"];
  const outputsImage = output.includes("image");
  return {
    reasoning: model["reasoning"] === true,
    images: Array.isArray(modalities?.input) && modalities.input.includes("image"),
    contextWindow,
    outputsImage,
    imageOnly: outputsImage && (!output.includes("text") || (model["type"] === "image" && contextWindow === null)),
  };
}

/** 出现最多的值，一样多取大的（上下文：转卖的服务商常常比官方给得小）。 */
function mostCommon(values: number[]): number | null {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && value > best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * 同一个模型在目录里常有几十家服务商的条目。厂商自己的那一条最准：别家的 id 带厂商前缀（`moonshotai/kimi-k3.1-pro`），
 * 目录里又有这个厂商（`moonshotai`）的同名模型，就用它；没有就按多数：一半以上说支持就算支持，上下文取出现最多的。
 */
function merge(entries: Entry[]): ModelCapabilities {
  const vendors = entries.flatMap((entry) => (entry.vendor === null ? [] : [entry.vendor]));
  const counts = new Map<string, number>();
  for (const vendor of vendors) counts.set(vendor, (counts.get(vendor) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]).map(([vendor]) => vendor);
  for (const vendor of ranked) {
    const own = entries.find((entry) => entry.provider === vendor);
    if (own !== undefined) return own.caps;
  }
  const half = entries.length / 2;
  const contexts = entries.flatMap((entry) => (entry.caps.contextWindow === null ? [] : [entry.caps.contextWindow]));
  const supported = (flag: (caps: ModelCapabilities) => boolean) =>
    entries.filter((entry) => flag(entry.caps)).length >= half;
  return {
    reasoning: supported((caps) => caps.reasoning),
    images: supported((caps) => caps.images),
    contextWindow: mostCommon(contexts),
    outputsImage: supported((caps) => caps.outputsImage),
    imageOnly: supported((caps) => caps.imageOnly),
  };
}

/** models.dev 的 `{ <provider>: { models: { <id>: {...} } } }` → 模型 id（catalogKey）→ 能力。形状不对的条目跳过。 */
export function summarizeCatalog(body: unknown): Map<string, ModelCapabilities> {
  const grouped = new Map<string, Entry[]>();
  if (typeof body !== "object" || body === null) return new Map();
  for (const [provider, value] of Object.entries(body as Record<string, unknown>)) {
    const models = (value as { models?: unknown } | null)?.models;
    if (typeof models !== "object" || models === null) continue;
    for (const [id, model] of Object.entries(models as Record<string, unknown>)) {
      if (typeof model !== "object" || model === null) continue;
      const slash = id.lastIndexOf("/");
      const entry: Entry = {
        provider: provider.toLowerCase(),
        vendor: slash > 0 ? id.slice(0, slash).toLowerCase() : null,
        caps: entryCaps(model as Record<string, unknown>),
      };
      const key = catalogKey(id);
      const list = grouped.get(key);
      if (list === undefined) grouped.set(key, [entry]);
      else list.push(entry);
    }
  }
  return new Map([...grouped].map(([key, entries]) => [key, merge(entries)]));
}

export async function downloadCatalog(fetchFn: FetchFn, url: string): Promise<Map<string, ModelCapabilities>> {
  const response = await fetchFn(url, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_BODY_CHARS) throw new Error("catalog too large");
  return summarizeCatalog(JSON.parse(text));
}

let catalog: Promise<Map<string, ModelCapabilities>> | null = null;

/** 查一批模型 id；目录里没有的不出现在结果里。下载失败记日志、返回空（表单就不预填），下次再查时重试。 */
export async function lookupCapabilities(
  fetchFn: FetchFn,
  ids: readonly string[],
): Promise<Record<string, ModelCapabilities>> {
  catalog ??= downloadCatalog(fetchFn, process.env["STUDIO_MODELS_DEV_URL"] ?? CATALOG_URL);
  let table: Map<string, ModelCapabilities>;
  try {
    table = await catalog;
  } catch (error) {
    catalog = null;
    log.warn("models.dev catalog download failed", { message: error instanceof Error ? error.message : String(error) });
    return {};
  }
  const out: Record<string, ModelCapabilities> = {};
  for (const id of ids) {
    const caps = table.get(catalogKey(id));
    if (caps !== undefined) out[id] = caps;
  }
  return out;
}
