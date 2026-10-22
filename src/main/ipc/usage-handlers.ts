// 用量：订阅账号额度（omp usage）和近一年每日消耗（omp 的 stats.db）。只读，逻辑在 src/main/usage/。
import type { HandlerGroup } from "../../shared/ipc.ts";
import { getApiKeyEnv, readyOmp } from "../omp-manager/index.ts";
import { serviceCwd } from "../service/service-omp.ts";
import { fetchQuota, readHeatmap, requireSuccess, runOmpCommand, statsDbPath } from "../usage/usage-service.ts";
import { parseBoolean } from "./validate.ts";

/** `omp stats` 第一次要读完全部历史会话，给足时间；超时就杀掉，下次接着同步。 */
const SYNC_TIMEOUT_MS = 15 * 60 * 1000;
const QUOTA_TIMEOUT_MS = 60 * 1000;

let syncing: Promise<void> | null = null;

async function omp(timeoutMs: number) {
  return runOmpCommand(readyOmp().path, await serviceCwd(), timeoutMs, await getApiKeyEnv());
}

/** 让 omp 自己跑一次 `omp stats --json` 把新会话同步进 stats.db（同一时间只跑一个；omp 还会对库加跨进程锁）。会话信息 / 请求记录也用它。 */
export async function syncStatsDb(): Promise<void> {
  syncing ??= omp(SYNC_TIMEOUT_MS)
    .then((run) => run(["stats", "--json"]))
    .then((result) => requireSuccess("omp stats", result))
    .finally(() => {
      syncing = null;
    });
  await syncing;
}

export const usageHandlers: HandlerGroup<"getUsageQuota" | "getUsageHeatmap"> = {
  getUsageQuota: async () => fetchQuota(await omp(QUOTA_TIMEOUT_MS)),
  getUsageHeatmap: async (refresh) => {
    if (parseBoolean(refresh, "refresh")) await syncStatsDb();
    return readHeatmap(statsDbPath());
  },
};
