// 账号和模型的 IPC：模型列表、provider 列表、OAuth 登录、登出、API key。
// 除 API key 和非对话模型外都走服务进程（src/main/service/）；非对话模型跑一次 `omp models --kind all --json`（rpc 没有这个命令）。
// API key 由 safeStorage 存在 userData，不碰 ~/.omp（决策 D3）。key 只进不出：返回值、事件、日志里都没有 key。
import type { HandlerGroup } from "../../shared/ipc.ts";
import { parseRunnerModels } from "../../shared/omp-output/models.ts";
import { apiKeyStore } from "../omp-manager/api-keys.ts";
import { getApiKeyEnv, readyOmp } from "../omp-manager/index.ts";
import { answerLoginInput, cancelLogin, startLogin } from "../service/login.ts";
import { listModelOptions } from "../service/default-model.ts";
import { serviceCwd, serviceOmp } from "../service/service-omp.ts";
import { startupCache } from "../service/startup-cache-instance.ts";
import { requireSuccess, runOmpCommand } from "../usage/usage-service.ts";
import { parseApiKey, parseInteger, parseString } from "./validate.ts";

/** `omp models` 会先刷新没缓存的 provider 目录（联网），给足时间。 */
const MODELS_TIMEOUT_MS = 60 * 1000;

const parseProviderId = (value: unknown) => parseString(value, "providerId", 200);

/** omp 只在启动时读环境变量：key 变了就关掉服务进程，下次用时带新的 key 重启（任务进程下次启动时同样带上）。 */
async function applyKeyChange(): Promise<void> {
  await serviceOmp.close();
}

export const accountHandlers: HandlerGroup<
  | "listModels"
  | "listRunnerModels"
  | "listLoginProviders"
  | "startLogin"
  | "answerLoginInput"
  | "cancelLogin"
  | "listAccounts"
  | "logout"
  | "saveApiKey"
  | "clearApiKey"
  | "listApiKeyProviders"
> = {
  listModels: () => listModelOptions(),
  listRunnerModels: async () => {
    const run = runOmpCommand(readyOmp().path, await serviceCwd(), MODELS_TIMEOUT_MS, await getApiKeyEnv());
    const result = await run(["models", "--kind", "all", "--json"]);
    requireSuccess("omp models", result);
    return parseRunnerModels(result.stdout);
  },
  listLoginProviders: async () =>
    (await serviceOmp.use((connection) => connection.request("get_login_providers"))).providers,
  startLogin: (providerId) => startLogin(parseProviderId(providerId)),
  answerLoginInput: (inputId, value) => {
    answerLoginInput(
      parseString(inputId, "inputId", 200),
      value === null ? null : parseString(value, "value", 8192, { allowEmpty: true }),
    );
    return Promise.resolve();
  },
  cancelLogin: () => cancelLogin(),
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
  },
  saveApiKey: async (providerId, key) => {
    await apiKeyStore().save(parseProviderId(providerId), parseApiKey(key));
    await applyKeyChange();
  },
  clearApiKey: async (providerId) => {
    await apiKeyStore().clear(parseProviderId(providerId));
    await applyKeyChange();
  },
  listApiKeyProviders: () => apiKeyStore().list(),
};
