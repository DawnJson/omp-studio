// 自定义模型：直接读写 omp 的 `models.yml`（仓库所有者 2026-10-18 同意的例外，见 AGENTS.md「omp 的边界」和
// docs/architecture/custom-models.md）：omp 没有写 models.yml 的命令或 RPC。
// 规则（唯一的例外，不扩大）：
// - 只改 `providers.<id>` 这一层的条目，用 yaml 的 Document API，注释、其它 provider、其它根键、条目里不认识的字段原样保留；
// - 文件在 agent 目录里：models.yml 优先于 models.yaml（omp://models.md），都没有就新建 models.yml；
// - 只有 models.json（omp 启动时才迁移成 yml）时不写，免得新建的 yml 盖住 omp 的迁移；
// - 原子写（src/main/tasks/atomic-write.ts），写前把旧内容留一份 `models.yml.bak`；同进程内的写入串行；
// - key 只进不出：读出的信息里没有 key 的内容，日志里也不出现 key；
// - 环境变量形式的 key 顺带写 agent 目录的 `.env`（仓库所有者 2026-10-24 同意的第二处例外，规则见 env-file.ts）：
//   带值保存时写那一行；改完或删掉后没人再引用、也不是内置 provider 认的变量（unusedEnvName）就删掉那一行。
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
  unusedEnvName,
  type CustomKeyState,
  type ProviderOverrideInput,
  type CustomModelEntry,
  type CustomModelMeta,
  type CustomModelsErrorCode,
  type CustomModelsFileInfo,
  type CustomModelsOutcome,
  type CustomProviderInfo,
  type CustomProviderInput,
  type EnvSource,
} from "../../shared/custom-models.ts";
import { nonEmptyString as str } from "../../shared/type-guards.ts";
import { log } from "../log/log.ts";
import { writeFileAtomic } from "../tasks/atomic-write.ts";
import { envFilePath, envSourceOf, readEnvText, removeEnvLine, setEnvLine } from "./env-file.ts";

/** 全大写的值一律当环境变量名；大小写混合的（`Pro_KIMI_API_KEY`）只有确实设置了才算，免得把真 key 当成变量名显示出来。 */
const envLikeKey = /^[A-Z][A-Z0-9_]*$/;

type SourceOf = (name: string) => EnvSource;

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

function keyStateOf(entry: Record<string, unknown>, sourceOf: SourceOf): CustomKeyState {
  const key = entry["apiKey"];
  if (typeof key !== "string" || key === "") return { kind: "none" };
  if (key.startsWith("!")) return { kind: "command" };
  if (!isValidEnvName(key)) return { kind: "literal" };
  // omp 的规则：值正好是一个已设置的环境变量名就用变量的值，否则把值本身当 key（omp://providers.md）。
  const source = sourceOf(key);
  return envLikeKey.test(key) || source !== "missing" ? { kind: "env", name: key, source } : { kind: "literal" };
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

const hasMeta = (meta: CustomModelMeta): boolean =>
  meta.reasoning !== null || meta.images !== null || meta.contextWindow !== null || meta.maxTokens !== null;

/** `modelOverrides`（模型 id → 覆盖项）里写了能力参数的模型。 */
function overrideEntries(value: unknown): ({ id: string } & CustomModelMeta)[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const out: ({ id: string } & CustomModelMeta)[] = [];
  for (const [id, raw] of Object.entries(value)) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const meta = metaOf(raw as Record<string, unknown>);
    if (hasMeta(meta)) out.push({ id, ...meta });
  }
  return out;
}

export type ParseResult = { ok: true; providers: CustomProviderInfo[] } | { ok: false; code: CustomModelsErrorCode };

/** 从 models.yml 文本里读出 providers。文本为 null/空 = 没有任何 provider。`sourceOf` 判断 `apiKey` 里的变量名设在哪。 */
export function parseProviders(text: string | null, sourceOf: SourceOf): ParseResult {
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
      key: keyStateOf(entry, sourceOf),
      models: modelEntries(entry["models"]),
      discovery: typeof entry["discovery"] === "object" && entry["discovery"] !== null,
      overrides: overrideEntries(entry["modelOverrides"]),
      oauthShaping: entry["api"] === "anthropic-messages" && entry["auth"] === undefined,
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

/** 环境变量形式的 key：变量名合法；带值时值和直接填的 key 一样校验（非空、无控制字符、不以 `!` 开头）。 */
function isValidEnvKey(key: { name: string; value?: string }): boolean {
  return isValidEnvName(key.name) && (key.value === undefined || key.value === "" || isValidLiteralKey(key.value));
}

function validateInput(input: CustomProviderInput, mode: "add" | "edit"): CustomModelsErrorCode | null {
  if (!isValidProviderId(input.id)) return "invalid-id";
  if (normalizeBaseUrl(input.baseUrl) === null) return "invalid-url";
  if (!isKnownApi(input.api)) return "invalid-api";
  const key = input.key;
  if (key.kind === "literal" && !isValidLiteralKey(key.value)) return "invalid-key";
  if (key.kind === "env" && !isValidEnvKey(key)) return "invalid-key";
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
  // 自定义 anthropic-messages 没写 `auth` 时 omp 按订阅（OAuth）组装请求，system 开头带每次都变的 `cch`，中转站缓存不命中
  // （omp://models.md「Allowed auth/discovery values」）。`none`、`oauth` 是用户选的，不动。
  if (input.api === "anthropic-messages" && provider.get("auth") !== "none" && provider.get("auth") !== "oauth")
    provider.set("auth", "apiKey");
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

/**
 * 改一个只覆盖 omp 内置 provider 的条目（没有 `models`、`discovery`，比如 `anthropic` 下只有 `modelOverrides`）：
 * 这种条目没法走 applyProvider（它要求 baseUrl 和模型）。只动 `apiKey`（和 `auth: none`）以及 `modelOverrides` 里各模型的
 * 能力参数，别的键（`baseUrl`、覆盖项里的 `name`、`compat`……）原样。覆盖项空了删覆盖项，`modelOverrides` 空了删它，
 * 条目空了删条目（omp 认为没有任何覆盖项的条目不合法，omp://models.md "Override-only provider"）。
 */
export function applyOverride(text: string | null, id: string, input: ProviderOverrideInput): Edit {
  if (!isValidProviderId(id)) return fail("invalid-id");
  const key = input.key;
  if (key?.kind === "literal" && !isValidLiteralKey(key.value)) return fail("invalid-key");
  if (key?.kind === "env" && !isValidEnvKey(key)) return fail("invalid-key");
  if (input.models.length > limits.models) return fail("invalid-models");
  const wanted = new Map<string, CustomModelMeta>();
  for (const model of input.models) {
    if (!isValidModelId(model.id) || wanted.has(model.id) || !isMetaValid(model)) return fail("invalid-models");
    wanted.set(model.id, model);
  }
  const source = stripBom(text ?? "");
  const doc = parseDocument(source);
  if (doc.errors.length > 0) return fail("unreadable-file");
  if (!isMap(doc.contents)) return fail(doc.contents === null ? "not-found" : "unreadable-file");
  const providers = doc.contents.get("providers", true);
  if (!isMap(providers)) return fail("not-found");
  const provider = providers.get(id, true);
  if (provider === undefined) return fail("not-found");
  if (!isMap(provider)) return fail("unreadable-file");

  if (key === null) provider.delete("apiKey");
  else if (key.kind !== "keep") {
    provider.set("apiKey", key.kind === "literal" ? key.value : key.name);
    if (provider.get("auth") === "none") provider.delete("auth");
  }

  const existing = provider.get("modelOverrides", true);
  if (existing !== undefined && existing !== null && !isMap(existing)) return fail("unreadable-file");
  const overrides = (existing as YAMLMap | undefined) ?? new YAMLMap();
  const none: CustomModelMeta = { reasoning: null, images: null, contextWindow: null, maxTokens: null };
  const emptied: unknown[] = [];
  for (const pair of overrides.items) {
    const modelId = isScalar(pair.key) ? pair.key.value : pair.key;
    if (typeof modelId !== "string" || wanted.has(modelId) || !isMap(pair.value)) continue;
    applyMeta(doc, pair.value as YAMLMap, none);
    if ((pair.value as YAMLMap).items.length === 0) emptied.push(pair.key);
  }
  for (const modelKey of emptied) overrides.delete(modelKey);
  for (const [modelId, meta] of wanted) {
    const current = overrides.get(modelId, true);
    if (current !== undefined && current !== null && !isMap(current)) return fail("unreadable-file");
    const node = (current as YAMLMap | undefined) ?? new YAMLMap();
    applyMeta(doc, node, meta);
    if (node.items.length === 0) overrides.delete(modelId);
    else if (current === undefined || current === null) overrides.set(modelId, node);
  }
  if (overrides.items.length === 0) provider.delete("modelOverrides");
  else if (existing === undefined || existing === null) provider.set("modelOverrides", overrides);

  if (provider.items.length === 0) providers.delete(id);
  return { ok: true, text: render(doc, source) };
}

// ——— 文件读写 ———

/** 同一进程内 models.yml 和 `.env` 的写入串行：读-改-写之间不能被另一次写入插进来。 */
let writeQueue: Promise<unknown> = Promise.resolve();

/** 要写进 `.env` 的 key（环境变量形式、带了值）。 */
type EnvWrite = { name: string; value: string } | null;

function envWriteOf(key: CustomProviderInput["key"] | ProviderOverrideInput["key"]): EnvWrite {
  return key?.kind === "env" && key.value !== undefined && key.value !== ""
    ? { name: key.name, value: key.value }
    : null;
}

/**
 * 改 models.yml 里的 provider `id`，并同步 agent 目录的 `.env`：带值的环境变量 key 写进去；
 * 改完后这个 provider 原来引用、现在没人引用的变量（unusedEnvName）删掉。先写 `.env` 再写 models.yml：
 * models.yml 写失败时 `.env` 里只是多一行没人用的变量，不会出现 models.yml 引用了一个不存在的变量。
 */
async function mutate(
  agentDir: string,
  id: string,
  edit: (text: string | null) => Edit,
  envWrite: EnvWrite,
): Promise<CustomModelsOutcome> {
  const run = async (): Promise<CustomModelsOutcome> => {
    const located = await locate(agentDir);
    if (located.legacyJson) return fail("legacy-json");
    const result = edit(located.text);
    if (!result.ok) return result;

    const envText = await readEnvText(agentDir);
    let nextEnv = envText;
    if (envWrite !== null) {
      const written = setEnvLine(nextEnv, envWrite.name, envWrite.value);
      if (!written.ok) return fail("unsafe-env");
      nextEnv = written.text;
    }
    const before = parseProviders(located.text, envSourceOf(envText));
    const after = parseProviders(result.text, envSourceOf(nextEnv));
    const unused =
      before.ok && after.ok
        ? unusedEnvName(
            before.providers.find((provider) => provider.id === id),
            after.providers,
          )
        : null;
    if (unused !== null && nextEnv !== null) {
      const removed = removeEnvLine(nextEnv, unused);
      // 删不干净（跨行的引号值之类）就留着这一行：没人引用的变量不影响 omp。
      if (removed.ok) nextEnv = removed.text;
      else log.info(`custom provider ${id}: left unused ${unused} in .env (not a single-line entry)`);
    }

    if (nextEnv !== envText && nextEnv !== null) {
      const file = envFilePath(agentDir);
      if (envText !== null) await copyFile(file, `${file}.bak`);
      await writeFileAtomic(file, nextEnv, `omp-studio-${process.pid}`);
      log.info(
        `custom provider ${id}: .env ${envWrite !== null ? `set ${envWrite.name}` : ""}${unused !== null ? ` removed ${unused}` : ""}`,
      );
    }
    if (located.text !== null) await copyFile(located.file, `${located.file}.bak`);
    await writeFileAtomic(located.file, result.text, `omp-studio-${process.pid}`);
    const shadowed = envWrite !== null && envSourceOf(nextEnv)(envWrite.name) === "system";
    return shadowed ? { ok: true, envShadowed: envWrite.name } : { ok: true };
  };
  const next = writeQueue.then(run, run);
  writeQueue = next.catch(() => undefined);
  return next;
}

export async function readModelsFile(agentDir: string): Promise<CustomModelsFileInfo> {
  const located = await locate(agentDir);
  const parsed = parseProviders(located.text, envSourceOf(await readEnvText(agentDir)));
  // 读不懂的文件不假装是空的：抛出，界面显示"读取失败"，免得用户以为 provider 丢了。
  if (!parsed.ok) throw new Error(`models file is not readable YAML: ${path.basename(located.file)}`);
  return { path: located.file, exists: located.text !== null, providers: parsed.providers };
}

export function saveCustomProvider(
  agentDir: string,
  input: CustomProviderInput,
  mode: "add" | "edit",
): Promise<CustomModelsOutcome> {
  return mutate(agentDir, input.id, (text) => applyProvider(text, input, mode), envWriteOf(input.key));
}

export function deleteCustomProvider(agentDir: string, id: string): Promise<CustomModelsOutcome> {
  return mutate(agentDir, id, (text) => removeProvider(text, id), null);
}

export function saveProviderOverride(
  agentDir: string,
  id: string,
  input: ProviderOverrideInput,
): Promise<CustomModelsOutcome> {
  return mutate(agentDir, id, (text) => applyOverride(text, id, input), envWriteOf(input.key));
}

/** 文件里某个 provider 的 key 值；只给主进程内部用。 */
export async function readProviderKey(agentDir: string, providerId: string): Promise<string | null> {
  return providerKeyValue((await locate(agentDir)).text, providerId);
}

/**
 * 内置 provider 的 key 已经写在 agent 目录 `.env` 里（`name` 是它的变量，比如 TAVILY_API_KEY）：改那一行，返回 true。
 * omp 18.12.6 实测 `.env` 的变量比 `omp auth import` 存的 key 优先，这时存进凭据库 omp 也不用，所以改 `.env`
 * （仓库所有者 2026-10-24 批准，AGENTS.md「omp 的边界」）。变量不在 `.env` 里（没设、或系统环境变量里有）不写，返回 false。
 * 和 models.yml / 自定义 provider 的 `.env` 写入同一个队列；`.env` 的写法规则见 env-file.ts。
 */
export function setEnvKey(agentDir: string, name: string, value: string): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    const text = await readEnvText(agentDir);
    if (envSourceOf(text)(name) !== "env-file") return false;
    const written = setEnvLine(text, name, value);
    if (!written.ok) throw new Error(`the ${name} line in .env can't be rewritten safely; edit .env by hand`);
    const file = envFilePath(agentDir);
    await copyFile(file, `${file}.bak`);
    await writeFileAtomic(file, written.text, `omp-studio-${process.pid}`);
    log.info(`provider key: .env set ${name}`);
    return true;
  };
  const next = writeQueue.then(run, run);
  writeQueue = next.catch(() => undefined);
  return next;
}
