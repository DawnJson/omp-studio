// 账号和模型的 IPC：模型列表、provider 列表、OAuth 登录、登出、API key。
// 除 API key 和非对话模型外都走服务进程（src/main/service/）；非对话模型跑一次 `omp models --kind all --json`（rpc 没有这个命令）。
// API key 经 `omp auth import` 存进 omp 的凭据库（login/api-key.ts）；omp 实际取 key 的那个变量已写在 agent 目录 `.env` 里时改那一行（omp 优先用 `.env`）。
// 清除就是 logout 那条 api_key 凭据。key 只进不出：返回值、事件、日志里都没有 key。
// Tavily 的备用 key 存在 studio 内置扩展的目录里，不进 omp 的凭据库（tavily/backup-keys.ts）。
import { limits, type HandlerGroup } from "../../shared/ipc.ts";
import { parseRunnerModels } from "../../shared/omp-output/models.ts";
import { acceptsApiKey, keyEnvProviderIds, providerKeyEnv, type ProviderKeyEnv } from "../../shared/provider-keys.ts";
import { resolveAgentDir } from "../history/session-index.ts";
import { cleanApiKey, importApiKey } from "../login/api-key.ts";
import { setEnvKey } from "../omp-config/models-file.ts";
import { envSourceOf, readEnvText } from "../omp-config/env-file.ts";
import { readyOmp } from "../omp-manager/index.ts";
import { listTavilyKeyUsage, readBackupKeys, writeBackupKeys } from "../tavily/backup-keys.ts";
import { answerLoginInput, cancelLogin, startLogin } from "../service/login.ts";
import { terminalLogin } from "../login/terminal-login-instance.ts";
import { listModelOptions, reloadServiceModels } from "../service/default-model.ts";
import { serviceCwd, serviceOmp } from "../service/service-omp.ts";
import { startupCache } from "../service/startup-cache-instance.ts";
import { requireSuccess, runOmpCommand } from "../usage/usage-service.ts";
import { parseApiKey, parseBoolean, parseInteger, parseString } from "./validate.ts";

/** `omp models` 会先刷新没缓存的 provider 目录（联网），给足时间。 */
const MODELS_TIMEOUT_MS = 60 * 1000;

const parseProviderId = (value: unknown) => parseString(value, "providerId", 200);

export const accountHandlers: HandlerGroup<
  | "listModels"
  | "listRunnerModels"
  | "listLoginProviders"
  | "startLogin"
  | "answerLoginInput"
  | "cancelLogin"
  | "startTerminalLogin"
  | "cancelTerminalLogin"
  | "listAccounts"
  | "logout"
  | "saveApiKey"
  | "apiKeyEnvSources"
  | "setTavilyBackupKeys"
  | "tavilyBackupKeyCount"
  | "tavilyKeyUsage"
> = {
  listModels: (refresh) => listModelOptions(parseBoolean(refresh, "refresh")),
  listRunnerModels: async () => {
    const run = runOmpCommand(readyOmp().path, await serviceCwd(), MODELS_TIMEOUT_MS);
    const result = await run(["models", "--kind", "all", "--json"]);
    requireSuccess("omp models", result);
    return parseRunnerModels(result.stdout);
  },
  listLoginProviders: async () =>
    (await serviceOmp.use((connection) => connection.request("get_login_providers"))).providers,
  // 登录在服务进程里做，它自己的认证状态已经是新的；缓存的模型目录和默认模型作废，下次读时现读（新登录的 provider 的模型要出现）。
  startLogin: async (providerId) => {
    const outcome = await startLogin(parseProviderId(providerId));
    if (outcome.ok) startupCache().forgetCatalog();
    return outcome;
  },
  answerLoginInput: (inputId, value) => {
    answerLoginInput(
      parseString(inputId, "inputId", 200),
      value === null ? null : parseString(value, "value", 8192, { allowEmpty: true }),
    );
    return Promise.resolve();
  },
  cancelLogin: () => cancelLogin(),
  // providerId 不可信：TerminalLogin.start 在 omp 的登录 provider 列表里查，不在就 reject、不起进程。
  // 凭据是另一个进程写进 omp 凭据库的：服务进程里 omp 缓存的认证状态是旧的，reloadServiceModels 关掉它并作废模型缓存。
  startTerminalLogin: async (providerId) => {
    const outcome = await terminalLogin().start(parseProviderId(providerId));
    if (outcome.ok) await reloadServiceModels();
    return outcome;
  },
  cancelTerminalLogin: () => terminalLogin().cancel(),
  listAccounts: async (providerId) => {
    const id = parseProviderId(providerId);
    const { accounts } = await serviceOmp.use((connection) =>
      connection.request("get_logout_accounts", { providerId: id }),
    );
    // 输入框费用后面的 "(sub)"：有 OAuth 凭据就是订阅登录（use-subscription.ts）。
    startupCache().setSubscription(
      id,
      accounts.some((account) => account.type === "oauth"),
    );
    return accounts;
  },
  logout: async (providerId, credentialId) => {
    const id = parseProviderId(providerId);
    const credential = parseInteger(credentialId, "credentialId", 0, Number.MAX_SAFE_INTEGER);
    await serviceOmp.use((connection) => connection.request("logout", { providerId: id, credentialId: credential }));
    startupCache().forgetCatalog();
  },
  // omp 实际取 key 的变量（provider-keys.ts 的 providerKeyEnv）写在 agent 目录 `.env` 里时改那一行（omp 优先用它，存凭据库不生效，setEnvKey）；否则存凭据库。
  saveApiKey: async (providerId, key) => {
    const id = parseProviderId(providerId);
    const raw = parseApiKey(key);
    const agentDir = resolveAgentDir();
    const env = acceptsApiKey(id) ? providerKeyEnv(id, envSourceOf(await readEnvText(agentDir))) : null;
    const inEnvFile = env?.source === "env-file" && (await setEnvKey(agentDir, env.name, cleanApiKey(raw)));
    if (!inEnvFile) await importApiKey(readyOmp().path, await serviceCwd(), id, raw);
    await reloadServiceModels();
  },
  apiKeyEnvSources: async () => {
    const sourceOf = envSourceOf(await readEnvText(resolveAgentDir()));
    const result: Record<string, ProviderKeyEnv> = {};
    for (const id of keyEnvProviderIds()) {
      const env = providerKeyEnv(id, sourceOf);
      if (env !== null) result[id] = env;
    }
    return result;
  },
  // 备用 key 写进扩展目录（tavily/backup-keys.ts），正在跑的 omp 下次要换 key 时就读到。
  setTavilyBackupKeys: async (keys) => {
    const text = parseString(keys, "keys", limits.apiKeyMaxChars, { allowEmpty: true });
    const unique = [...new Set(text.split(/\s+/).filter((key) => key !== ""))];
    await writeBackupKeys(unique);
    return unique.length;
  },
  tavilyBackupKeyCount: async () => (await readBackupKeys()).length,
  tavilyKeyUsage: () => listTavilyKeyUsage(),
};
