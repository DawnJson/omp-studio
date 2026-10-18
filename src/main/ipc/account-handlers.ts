// 账号和模型的 IPC：模型列表、provider 列表、OAuth 登录、登出、API key。
// 除 API key 外都走服务进程（src/main/service/）；API key 由 safeStorage 存在 userData，不碰 ~/.omp（决策 D3）。
// key 只进不出：返回值、事件、日志里都没有 key。
import type { HandlerGroup, ModelOption } from "../../shared/ipc.ts";
import type { ModelInfo } from "../../shared/omp-wire/rpc-wire.generated.ts";
import { apiKeyStore } from "../omp-manager/api-keys.ts";
import { answerLoginInput, cancelLogin, startLogin } from "../service/login.ts";
import { serviceOmp } from "../service/service-omp.ts";
import { parseApiKey, parseInteger, parseString } from "./validate.ts";

function toModelOption(model: ModelInfo): ModelOption {
  return {
    key: { provider: model.provider, modelId: model.id },
    name: model.name,
    contextWindow: model.contextWindow,
    reasoning: model.reasoning,
    acceptsImages: model.input.includes("image"),
  };
}

const parseProviderId = (value: unknown) => parseString(value, "providerId", 200);

/** omp 只在启动时读环境变量：key 变了就关掉服务进程，下次用时带新的 key 重启（任务进程下次启动时同样带上）。 */
async function applyKeyChange(): Promise<void> {
  await serviceOmp.close();
}

export const accountHandlers: HandlerGroup<
  | "listModels"
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
  listModels: async () =>
    (await serviceOmp.use((connection) => connection.request("get_available_models"))).models.map(toModelOption),
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
    return (await serviceOmp.use((connection) => connection.request("get_logout_accounts", { providerId: id })))
      .accounts;
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
