// 用量：订阅账号额度（omp usage）和近一年每日消耗（omp 的 stats.db）。只读，逻辑在 src/main/usage/。
import { app } from "electron";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { HandlerGroup } from "../../shared/ipc.ts";
import { ompManager } from "../omp-manager/index.ts";
import { fetchQuota, readHeatmap, runOmpCommand, statsDbPath } from "../usage/usage-service.ts";
import { parseBoolean } from "./validate.ts";

/** `omp stats` 第一次要读完全部历史会话，给足时间；超时就杀掉，下次接着同步。 */
const SYNC_TIMEOUT_MS = 15 * 60 * 1000;
const QUOTA_TIMEOUT_MS = 60 * 1000;

let syncing: Promise<void> | null = null;

async function omp(timeoutMs: number) {
  const status = ompManager().status;
  if (status.state !== "ready") throw new Error("omp is not ready");
  const cwd = path.join(app.getPath("userData"), "service");
  await mkdir(cwd, { recursive: true });
  return runOmpCommand(status.path, cwd, timeoutMs);
}

export const usageHandlers: HandlerGroup<"getUsageQuota" | "getUsageHeatmap"> = {
  getUsageQuota: async () => fetchQuota(await omp(QUOTA_TIMEOUT_MS)),
  getUsageHeatmap: async (refresh) => {
    if (parseBoolean(refresh, "refresh")) {
      // 同一时间只跑一个同步；omp 自己还会对 stats.db 加跨进程锁。
      syncing ??= omp(SYNC_TIMEOUT_MS)
        .then((run) => run(["stats", "--json"]))
        .then(() => undefined)
        .finally(() => {
          syncing = null;
        });
      await syncing;
    }
    return readHeatmap(statsDbPath());
  },
};
