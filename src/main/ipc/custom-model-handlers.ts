// 自定义模型的 IPC：读写 omp 的 models.yml、一键拉取模型列表。规则和边界见 AGENTS.md「omp 的边界」、
// docs/architecture/custom-models.md。key 只进不出；日志只记 provider id 和结果，不记 key、不记 URL 里的查询串。
import { existsSync } from "node:fs";
import { net, shell } from "electron";
import path from "node:path";
import {
  isValidEnvName,
  limits,
  type CustomKeyInput,
  type CustomKeyValue,
  type CustomProviderInput,
  type FetchModelsOutcome,
} from "../../shared/custom-models.ts";
import type { HandlerGroup } from "../../shared/ipc.ts";
import { envFilePath, envSourceOf, envValues, readEnvText } from "../omp-config/env-file.ts";
import { resolveAgentDir } from "../history/session-index.ts";
import { log } from "../log/log.ts";
import { fetchModelList, resolveKeyToken } from "../omp-config/fetch-models.ts";
import {
  deleteCustomProvider,
  readModelsFile,
  readProviderKey,
  saveCustomProvider,
  setCustomProviderKey,
} from "../omp-config/models-file.ts";
import { readyOmp } from "../omp-manager/index.ts";
import { serviceCwd, serviceOmp } from "../service/service-omp.ts";
import { requireSuccess, runOmpCommand } from "../usage/usage-service.ts";
import { IpcValidationError, parseBoolean, parseInteger, parseOneOf, parseRecord, parseString } from "./validate.ts";

/** `omp models refresh` 要联网拉各 provider 的目录，慢的会要几十秒。 */
const REFRESH_TIMEOUT_MS = 120_000;

function parseKey(value: unknown): CustomKeyInput {
  const record = parseRecord(value, "key");
  const kind = parseOneOf(record["kind"], "key.kind", ["keep", "none", "literal", "env"] as const);
  if (kind === "literal") return { kind, value: parseString(record["value"], "key.value", 4096, { allowEmpty: true }) };
  if (kind === "env") {
    const name = parseString(record["name"], "key.name", 128, { allowEmpty: true });
    const keyValue = record["value"];
    if (keyValue === undefined) return { kind, name };
    return { kind, name, value: parseString(keyValue, "key.value", 4096, { allowEmpty: true }) };
  }
  return { kind };
}

function nullable<T>(value: unknown, name: string, parse: (value: unknown, name: string) => T): T | null {
  return value === null ? null : parse(value, name);
}

function parseKeyValue(value: unknown): CustomKeyValue | null {
  if (value === null) return null;
  const key = parseKey(value);
  if (key.kind === "literal" || key.kind === "env") return key;
  throw new IpcValidationError(`key.kind must be literal or env`);
}

function parseTokens(value: unknown, name: string): number {
  return parseInteger(value, name, 1, limits.tokens);
}

/** 只校验形状（类型、长度）；内容规则（id 字符集、URL 协议……）在 models-file.ts，不合格返回 {ok:false, code}。 */
function parseInput(value: unknown): CustomProviderInput {
  const record = parseRecord(value, "input");
  const models = record["models"];
  if (!Array.isArray(models) || models.length > 1000) throw new IpcValidationError("models 必须是数组");
  return {
    id: parseString(record["id"], "id", 200, { allowEmpty: true }),
    baseUrl: parseString(record["baseUrl"], "baseUrl", 4096, { allowEmpty: true }),
    api: parseString(record["api"], "api", 100, { allowEmpty: true }),
    key: parseKey(record["key"]),
    models: (models as unknown[]).map((item) => {
      const model = parseRecord(item, "model");
      const name = model["name"];
      return {
        id: parseString(model["id"], "model.id", 1000, { allowEmpty: true }),
        ...(name !== undefined && { name: parseString(name, "model.name", 1000, { allowEmpty: true }) }),
        reasoning: nullable(model["reasoning"], "model.reasoning", parseBoolean),
        images: nullable(model["images"], "model.images", parseBoolean),
        contextWindow: nullable(model["contextWindow"], "model.contextWindow", parseTokens),
        maxTokens: nullable(model["maxTokens"], "model.maxTokens", parseTokens),
      };
    }),
    ...(record["discovery"] !== undefined && { discovery: parseBoolean(record["discovery"], "discovery") }),
  };
}

async function fetchProviderModels(value: unknown): Promise<FetchModelsOutcome> {
  const record = parseRecord(value, "request");
  const baseUrl = parseString(record["baseUrl"], "baseUrl", 4096, { allowEmpty: true });
  const api = parseString(record["api"], "api", 100, { allowEmpty: true });
  const key = parseKey(record["key"]);
  const providerId = record["providerId"] === undefined ? null : parseString(record["providerId"], "providerId", 200);

  let raw: string | null = null;
  if (key.kind === "literal") raw = key.value.trim() === "" || /\p{Cc}/u.test(key.value) ? null : key.value;
  else if (key.kind === "env" && key.value !== undefined && key.value !== "")
    raw = /\p{Cc}/u.test(key.value) ? null : key.value; // 刚填、还没写进 .env 的 key 直接用
  else if (key.kind === "env") raw = key.name;
  else if (key.kind === "keep" && providerId !== null) raw = await readProviderKey(resolveAgentDir(), providerId);
  if ((key.kind === "literal" || key.kind === "env") && raw === null) return { ok: false, code: "invalid-key" };

  let token: string | null = null;
  if (raw !== null) {
    // 和 omp 一样：进程里非空的环境变量优先，其次 agent 目录的 .env（studio 自己的进程没加载它）。
    const fromProcess = Object.entries(process.env).filter(([, v]) => v !== undefined && v !== "");
    const env = { ...envValues(await readEnvText(resolveAgentDir())), ...Object.fromEntries(fromProcess) };
    token = resolveKeyToken(raw, env);
    if (token === null) return { ok: false, code: "command-key" };
  }
  const outcome = await fetchModelList((url, init) => net.fetch(url, init), { baseUrl, api, token });
  log.info(
    `custom provider ${providerId ?? "(new)"}: fetch models ${outcome.ok ? `ok (${outcome.models.length})` : outcome.code}`,
  );
  return outcome;
}

export const customModelHandlers: HandlerGroup<
  | "listCustomProviders"
  | "saveCustomProvider"
  | "deleteCustomProvider"
  | "setCustomProviderKey"
  | "fetchProviderModels"
  | "refreshModels"
  | "openModelsFile"
  | "openEnvFile"
  | "envKeySource"
> = {
  listCustomProviders: () => readModelsFile(resolveAgentDir()),
  saveCustomProvider: async (mode, input) => {
    const outcome = await saveCustomProvider(
      resolveAgentDir(),
      parseInput(input),
      parseOneOf(mode, "mode", ["add", "edit"] as const),
    );
    log.info(`custom provider ${mode}: ${outcome.ok ? "saved" : outcome.code}`);
    // omp 只在启动时读 models.yml（实测 18.12.1：同一进程里改了文件不会重新加载），所以关掉服务进程，
    // 下次读模型列表时重新起；已经在跑的任务进程要等下次启动才看得到。
    if (outcome.ok) await serviceOmp.close();
    return outcome;
  },
  deleteCustomProvider: async (providerId) => {
    const outcome = await deleteCustomProvider(resolveAgentDir(), parseString(providerId, "providerId", 200));
    log.info(`custom provider delete: ${outcome.ok ? "deleted" : outcome.code}`);
    if (outcome.ok) await serviceOmp.close();
    return outcome;
  },
  setCustomProviderKey: async (providerId, key) => {
    const outcome = await setCustomProviderKey(
      resolveAgentDir(),
      parseString(providerId, "providerId", 200),
      parseKeyValue(key),
    );
    log.info(`custom provider key ${key === null ? "clear" : "set"}: ${outcome.ok ? "saved" : outcome.code}`);
    if (outcome.ok) await serviceOmp.close();
    return outcome;
  },
  fetchProviderModels,
  refreshModels: async () => {
    const run = runOmpCommand(readyOmp().path, await serviceCwd(), REFRESH_TIMEOUT_MS);
    requireSuccess("omp models refresh", await run(["models", "refresh"]));
    log.info("omp models refresh: done");
    // 服务进程的模型注册表是启动时建的：关掉它，下次读模型列表时重新起、读到刷新后的目录。
    await serviceOmp.close();
  },
  openModelsFile: async () => {
    const info = await readModelsFile(resolveAgentDir());
    await openInShell(info.exists ? info.path : path.dirname(info.path));
  },
  // omp 启动时读 agent 目录的 `.env`（omp://providers.md「.env discovery」）；没有时打开目录。
  openEnvFile: async () => {
    const file = envFilePath(resolveAgentDir());
    await openInShell(existsSync(file) ? file : path.dirname(file));
  },
  // 只回答"这个变量设在哪"，不回值；不合法的名字当没设置。
  envKeySource: async (name) => {
    const parsed = parseString(name, "name", limits.envName, { allowEmpty: true });
    if (!isValidEnvName(parsed)) return "missing";
    return envSourceOf(await readEnvText(resolveAgentDir()))(parsed);
  },
};

async function openInShell(target: string): Promise<void> {
  if (!existsSync(target)) throw new Error("the omp agent directory does not exist yet");
  // openPath 失败不抛，返回错误文字；没有程序关联的扩展名（如 .env）Windows 弹"打开方式"，返回空串。
  const failure = await shell.openPath(target);
  if (failure !== "") throw new Error(failure);
}
