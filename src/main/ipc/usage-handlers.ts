// 用量：订阅账号额度（omp usage）和近一年每日消耗（omp 的 stats.db，在 SQLite worker 里读）。只读，逻辑在 src/main/usage/。
import type { HandlerGroup, UsageHeatmap } from "../../shared/ipc.ts";
import { getOmpExecutable } from "../omp-manager/index.ts";
import { serviceCwd } from "../service/service-omp.ts";
import { readInDbWorker } from "../usage/db-worker-client.ts";
import { fetchQuota, requireSuccess, runOmpCommand, statsDbPath } from "../usage/usage-service.ts";
import { parseBoolean } from "./validate.ts";

/** `omp stats` 第一次要读完全部历史会话，给足时间；超时就杀掉，下次接着同步。 */
const SYNC_TIMEOUT_MS = 15 * 60 * 1000;
const QUOTA_TIMEOUT_MS = 60 * 1000;
/** 热力图的缓存时间：stats.db 只在 `omp stats` 运行时变（刷新、请求记录会先同步，同步后作废缓存），几分钟内重开用量页不再读库。 */
const HEATMAP_TTL_MS = 3 * 60 * 1000;

let syncing: Promise<void> | null = null;
let heatmap: { at: number; value: Promise<UsageHeatmap> } | null = null;

/** 等 omp 就绪再跑：空状态的用量卡片一启动就读热力图（先同步），那时发现流程可能还没走完；直接取就绪状态会抛 "omp is not ready"，失败留在缓存里，打开用量对话框也不重读。 */
async function omp(timeoutMs: number) {
  const { path } = await getOmpExecutable();
  return runOmpCommand(path, await serviceCwd(), timeoutMs);
}

/** 让 omp 自己跑一次 `omp stats --json` 把新会话同步进 stats.db（同一时间只跑一个；omp 还会对库加跨进程锁）。会话信息 / 请求记录也用它。 */
export async function syncStatsDb(): Promise<void> {
  syncing ??= omp(SYNC_TIMEOUT_MS)
    .then((run) => run(["stats", "--json"]))
    .then((result) => requireSuccess("omp stats", result))
    .finally(() => {
      syncing = null;
      heatmap = null;
    });
  await syncing;
}

export const usageHandlers: HandlerGroup<"getUsageQuota" | "getUsageHeatmap"> = {
  getUsageQuota: async (refresh) => fetchQuota(await omp(QUOTA_TIMEOUT_MS), parseBoolean(refresh, "refresh")),
  getUsageHeatmap: async (refresh) => {
    if (parseBoolean(refresh, "refresh")) await syncStatsDb();
    const now = Date.now();
    if (heatmap === null || now - heatmap.at > HEATMAP_TTL_MS) {
      const value = readInDbWorker("heatmap", statsDbPath(), now);
      const entry = { at: now, value };
      heatmap = entry;
      // 读失败（库被锁、结构对不上）不缓存：下次再读。
      value.catch(() => {
        if (heatmap === entry) heatmap = null;
      });
    }
    return heatmap.value;
  },
};
