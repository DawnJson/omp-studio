// 设置一个 provider 的 API key：设置页"设置 API key"和 Tavily 换备用 key（tavily/backup-keys.ts）共用。
// omp 实际取 key 的变量（provider-keys.ts 的 providerKeyEnv）写在 agent 目录 `.env` 里时改那一行（omp 优先用它，存凭据库不生效，setEnvKey）；
// 否则经 `omp auth import` 存凭据库（api-key.ts）。
import { acceptsApiKey, providerKeyEnv } from "../../shared/provider-keys.ts";
import { resolveAgentDir } from "../history/session-index.ts";
import { envSourceOf, readEnvText } from "../omp-config/env-file.ts";
import { setEnvKey } from "../omp-config/models-file.ts";
import { readyOmp } from "../omp-manager/index.ts";
import { serviceCwd, serviceOmp } from "../service/service-omp.ts";
import { cleanApiKey, importApiKey } from "./api-key.ts";

export async function saveProviderApiKey(providerId: string, key: string): Promise<void> {
  const agentDir = resolveAgentDir();
  const env = acceptsApiKey(providerId) ? providerKeyEnv(providerId, envSourceOf(await readEnvText(agentDir))) : null;
  const inEnvFile = env?.source === "env-file" && (await setEnvKey(agentDir, env.name, cleanApiKey(key)));
  if (!inEnvFile) await importApiKey(readyOmp().path, await serviceCwd(), providerId, key);
  // 凭据是另一个进程写进 omp 凭据库的：服务进程里 omp 缓存的认证状态（get_login_providers 的 authenticated）是旧的，关掉让下次读到新的。
  await serviceOmp.close();
}
