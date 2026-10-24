// 自定义模型：直接读写 omp 的 `models.yml`（仓库所有者 2026-10-18 同意的例外，见 AGENTS.md「omp 的边界」和
// docs/architecture/custom-models.md）：omp 没有写 models.yml 的命令或 RPC。
// 规则（唯一的例外，不扩大）：
// - 只改 `providers.<id>` 这一层的条目，用 yaml 的 Document API，注释、其它 provider、其它根键、条目里不认识的字段原样保留；
// - 文件在 agent 目录里：models.yml 优先于 models.yaml（omp://models.md），都没有就新建 models.yml；
// - 只有 models.json（omp 启动时才迁移成 yml）时不写，免得新建的 yml 盖住 omp 的迁移；
// - 原子写（src/main/tasks/atomic-write.ts），写前把旧内容留一份 `models.yml.bak`；同进程内的写入串行；
// - key 只进不出：读出的信息里没有 key 的内容，日志里也不出现 key。
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { isMap, isScalar, isSeq, parseDocument, YAMLMap, YAMLSeq, type Document } from "yaml";
import {
  defaultDiscoveryType,
  isKnownApi,
  isValidEnvName,
  isValidLiteralKey,
  isValidModelId,
  isValidModelName,
  isValidTokenCount,
  isValidProviderId,
  limits,
  normalizeBaseUrl,
  type CustomKeyState,
  type CustomModelEntry,
  type CustomModelMeta,
  type CustomModelsErrorCode,
  type CustomModelsFileInfo,
  type CustomModelsOutcome,
  type CustomProviderInfo,
  type CustomProviderInput,
} from "../../shared/custom-models.ts";
import { writeFileAtomic } from "../tasks/atomic-write.ts";

const envLikeKey = /^[A-Z][A-Z0-9_]*$/;

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

interface Located {
  file: string;
  text: string | null;
  /** 只有旧的 models.json（omp 下次启动才会迁移成 models.yml）。 */
  legacyJson: boolean;
}

/** models.yml 优先于 models.yaml；都没有时落在 models.yml。 */
async function locate(agentDir: string): Promise<Located> {
  const yml = path.join(agentDir, "models.yml");
  const ymlText = await readIfExists(yml);
  if (ymlText !== null) return { file: yml, text: ymlText, legacyJson: false };
  const yaml = path.join(agentDir, "models.yaml");
  const yamlText = await readIfExists(yaml);
  if (yamlText !== null) return { file: yaml, text: yamlText, legacyJson: false };
  const legacyJson = (await readIfExists(path.join(agentDir, "models.json"))) !== null;
  return { file: yml, text: null, legacyJson };
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// ——— 读 ———

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function keyStateOf(entry: Record<string, unknown>): CustomKeyState {
  const key = entry["apiKey"];
  if (typeof key !== "string" || key === "") return { kind: "none" };
  if (key.startsWith("!")) return { kind: "command" };
  return envLikeKey.test(key) ? { kind: "env", name: key } : { kind: "literal" };
}

/** 模型条目上的能力参数；没写或写的不是 omp 认的形状时为 null（界面显示"自动"，保存时这种值原样不动）。 */
function metaOf(entry: Record<string, unknown>): CustomModelMeta {
  const reasoning = entry["reasoning"];
  const input = entry["input"];
  const contextWindow = entry["contextWindow"];
  const maxTokens = entry["maxTokens"];
  return {
    reasoning: typeof reasoning === "boolean" ? reasoning : null,
    images: Array.isArray(input) ? input.includes("image") : null,
    contextWindow: isValidTokenCount(contextWindow) ? contextWindow : null,
    maxTokens: isValidTokenCount(maxTokens) ? maxTokens : null,
  };
}

function modelEntries(value: unknown): (CustomModelEntry & CustomModelMeta)[] {
  if (!Array.isArray(value)) return [];
  const out: (CustomModelEntry & CustomModelMeta)[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Record<string, unknown>;
    const id = str(entry["id"]);
    if (id !== null) out.push({ id, name: str(entry["name"]), ...metaOf(entry) });
  }
  return out;
}

export type ParseResult = { ok: true; providers: CustomProviderInfo[] } | { ok: false; code: CustomModelsErrorCode };

/** 从 models.yml 文本里读出 providers。文本为 null/空 = 没有任何 provider。 */
export function parseProviders(text: string | null): ParseResult {
  if (text === null || text.trim() === "") return { ok: true, providers: [] };
  const doc = parseDocument(stripBom(text));
  if (doc.errors.length > 0) return { ok: false, code: "unreadable-file" };
  const root: unknown = doc.toJS();
  if (root === null || root === undefined) return { ok: true, providers: [] };
  if (typeof root !== "object" || Array.isArray(root)) return { ok: false, code: "unreadable-file" };
  const providers: unknown = (root as Record<string, unknown>)["providers"];
  if (providers === null || providers === undefined) return { ok: true, providers: [] };
  if (typeof providers !== "object" || Array.isArray(providers)) return { ok: false, code: "unreadable-file" };
  const out: CustomProviderInfo[] = [];
  for (const [id, raw] of Object.entries(providers)) {
    const entry: Record<string, unknown> =
      typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    out.push({
      id,
      baseUrl: str(entry["baseUrl"]),
      api: str(entry["api"]),
      key: keyStateOf(entry),
      models: modelEntries(entry["models"]),
      discovery: typeof entry["discovery"] === "object" && entry["discovery"] !== null,
    });
  }
  return { ok: true, providers: out };
}

/** 文件里某个 provider 现有的 key 值（只给主进程内部拉取模型用，不经 IPC 返回）。 */
export function providerKeyValue(text: string | null, providerId: string): string | null {
  if (text === null) return null;
  const doc = parseDocument(stripBom(text));
  if (doc.errors.length > 0) return null;
  const value: unknown = doc.getIn(["providers", providerId, "apiKey"]);
  return typeof value === "string" && value !== "" ? value : null;
}

// ——— 改（纯文本进、文本出）———

type Edit = { ok: true; text: string } | { ok: false; code: CustomModelsErrorCode };
const fail = (code: CustomModelsErrorCode): { ok: false; code: CustomModelsErrorCode } => ({ ok: false, code });

function validateInput(input: CustomProviderInput, mode: "add" | "edit"): CustomModelsErrorCode | null {
  if (!isValidProviderId(input.id)) return "invalid-id";
  if (normalizeBaseUrl(input.baseUrl) === null) return "invalid-url";
  if (!isKnownApi(input.api)) return "invalid-api";
  const key = input.key;
  if (key.kind === "literal" && !isValidLiteralKey(key.value)) return "invalid-key";
  if (key.kind === "env" && !isValidEnvName(key.name)) return "invalid-key";
  if (key.kind === "keep" && mode === "add") return "invalid-key";
  if (input.models.length > limits.models) return "invalid-models";
  const seen = new Set<string>();
  for (const model of input.models) {
    if (!isValidModelId(model.id) || seen.has(model.id)) return "invalid-models";
    if (model.name !== undefined && !isValidModelName(model.name)) return "invalid-models";
    if (!isMetaValid(model)) return "invalid-models";
    seen.add(model.id);
  }
  return null;
}

function isMetaValid(meta: CustomModelMeta): boolean {
  const flag = (value: unknown) => value === null || typeof value === "boolean";
  const count = (value: unknown) => value === null || isValidTokenCount(value);
  return flag(meta.reasoning) && flag(meta.images) && count(meta.contextWindow) && count(meta.maxTokens);
}

function eolOf(text: string): "\r\n" | "\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/** yaml 总是输出 \n；原文件是 CRLF 时转回去，免得整个文件的每一行都变成改动。 */
function render(doc: Document, original: string): string {
  const out = doc.toString();
  return eolOf(original) === "\r\n" ? out.replace(/\r?\n/g, "\r\n") : out;
}

function providersMap(doc: Document): YAMLMap | null {
  if (doc.contents === null || doc.contents === undefined) {
    doc.contents = new YAMLMap();
  }
  if (!isMap(doc.contents)) return null;
  const current = doc.contents.get("providers", true);
  if (current === undefined || current === null || (isScalar(current) && current.value === null)) {
    const created = new YAMLMap();
    doc.contents.set("providers", created);
    return created;
  }
  return isMap(current) ? (current as YAMLMap) : null;
}

function applyModels(doc: Document, provider: YAMLMap, input: CustomProviderInput): void {
  const existing = provider.get("models", true);
  const byId = new Map<string, YAMLMap>();
  if (isSeq(existing))
    for (const item of existing.items) {
      if (!isMap(item)) continue;
      const id = item.get("id");
      if (typeof id === "string") byId.set(id, item as YAMLMap);
    }
  const next = input.models.map((model) => {
    const node = byId.get(model.id) ?? (doc.createNode({ id: model.id }) as YAMLMap);
    if (model.name !== undefined) node.set("name", model.name);
    applyMeta(doc, node, model);
    return node;
  });
  if (next.length === 0) {
    provider.delete("models");
    return;
  }
  // 就地换 items，seq 上挂的注释留着。
  if (isSeq(existing)) {
    existing.items = next;
  } else {
    const seq = new YAMLSeq();
    seq.items = next;
    provider.set("models", seq);
  }
}

/** 只改和文件里现有值不同的项（`input: [ text, image ]` 这类原来的写法不被重排）；null = 去掉这一项。 */
function applyMeta(doc: Document, node: YAMLMap, meta: CustomModelMeta): void {
  const current = metaOf(node.toJSON() as Record<string, unknown>);
  const put = (key: string, value: unknown) => {
    if (value === null) node.delete(key);
    else node.set(key, value);
  };
  if (meta.reasoning !== current.reasoning) put("reasoning", meta.reasoning);
  if (meta.images !== current.images)
    put(
      "input",
      meta.images === null ? null : doc.createNode(meta.images ? ["text", "image"] : ["text"], { flow: true }),
    );
  if (meta.contextWindow !== current.contextWindow) put("contextWindow", meta.contextWindow);
  if (meta.maxTokens !== current.maxTokens) put("maxTokens", meta.maxTokens);
}

/** 新增（mode add）或修改（edit）一个 provider。只动 baseUrl / apiKey / auth / api / models / discovery 这几个键。 */
export function applyProvider(text: string | null, input: CustomProviderInput, mode: "add" | "edit"): Edit {
  const invalid = validateInput(input, mode);
  if (invalid !== null) return fail(invalid);
  const source = stripBom(text ?? "");
  const doc = parseDocument(source);
  if (doc.errors.length > 0) return fail("unreadable-file");
  const providers = providersMap(doc);
  if (providers === null) return fail("unreadable-file");

  const existing = providers.get(input.id, true);
  if (mode === "add" && existing !== undefined) return fail("exists");
  if (mode === "edit" && existing === undefined) return fail("not-found");
  let provider: YAMLMap;
  if (existing === undefined) {
    provider = new YAMLMap();
    providers.set(input.id, provider);
  } else if (isMap(existing)) {
    provider = existing as YAMLMap;
  } else {
    return fail("unreadable-file");
  }

  // `discovery` 只整体增删：已有的（类型、timeoutMs 等）原样保留，只在 true 且还没有时按 api 写默认类型。
  if (input.discovery === false) provider.delete("discovery");
  else if (input.discovery === true && !provider.has("discovery")) {
    const type = defaultDiscoveryType(input.api);
    if (type === null) return fail("invalid-api");
    provider.set("discovery", doc.createNode({ type }));
  }
  if (input.models.length === 0 && !provider.has("discovery")) return fail("needs-model");

  provider.set("baseUrl", normalizeBaseUrl(input.baseUrl));
  const key = input.key;
  if (key.kind === "literal" || key.kind === "env") {
    provider.set("apiKey", key.kind === "literal" ? key.value : key.name);
    if (provider.get("auth") === "none") provider.delete("auth");
  } else if (key.kind === "none") {
    provider.delete("apiKey");
    provider.set("auth", "none");
  }
  provider.set("api", input.api);
  applyModels(doc, provider, input);
  return { ok: true, text: render(doc, source) };
}

/** 删掉一个 provider；别的内容原样。 */
export function removeProvider(text: string | null, id: string): Edit {
  if (!isValidProviderId(id)) return fail("invalid-id");
  const source = stripBom(text ?? "");
  const doc = parseDocument(source);
  if (doc.errors.length > 0) return fail("unreadable-file");
  if (!isMap(doc.contents)) return fail(doc.contents === null ? "not-found" : "unreadable-file");
  const providers = doc.contents.get("providers", true);
  if (!isMap(providers)) return fail("not-found");
  if (!providers.delete(id)) return fail("not-found");
  return { ok: true, text: render(doc, source) };
}

// ——— 文件读写 ———

/** 同一进程内的 models.yml 写入串行：读-改-写之间不能被另一次写入插进来。 */
let writeQueue: Promise<unknown> = Promise.resolve();

async function mutate(agentDir: string, edit: (text: string | null) => Edit): Promise<CustomModelsOutcome> {
  const run = async (): Promise<CustomModelsOutcome> => {
    const located = await locate(agentDir);
    if (located.legacyJson) return fail("legacy-json");
    const result = edit(located.text);
    if (!result.ok) return result;
    if (located.text !== null) await copyFile(located.file, `${located.file}.bak`);
    await writeFileAtomic(located.file, result.text, `omp-studio-${process.pid}`);
    return { ok: true };
  };
  const next = writeQueue.then(run, run);
  writeQueue = next.catch(() => undefined);
  return next;
}

export async function readModelsFile(agentDir: string): Promise<CustomModelsFileInfo> {
  const located = await locate(agentDir);
  const parsed = parseProviders(located.text);
  // 读不懂的文件不假装是空的：抛出，界面显示"读取失败"，免得用户以为 provider 丢了。
  if (!parsed.ok) throw new Error(`models file is not readable YAML: ${path.basename(located.file)}`);
  return { path: located.file, exists: located.text !== null, providers: parsed.providers };
}

export function saveCustomProvider(
  agentDir: string,
  input: CustomProviderInput,
  mode: "add" | "edit",
): Promise<CustomModelsOutcome> {
  return mutate(agentDir, (text) => applyProvider(text, input, mode));
}

export function deleteCustomProvider(agentDir: string, id: string): Promise<CustomModelsOutcome> {
  return mutate(agentDir, (text) => removeProvider(text, id));
}

/** 文件里某个 provider 的 key 值；只给主进程内部用。 */
export async function readProviderKey(agentDir: string, providerId: string): Promise<string | null> {
  return providerKeyValue((await locate(agentDir)).text, providerId);
}
