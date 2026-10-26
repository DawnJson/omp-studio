// 启动时把 studio 自带的账号型 provider 扩展写进 omp 的扩展目录（deploy.ts），之后所有 omp 进程自动加载，不用传参数。
// 部署失败不阻塞任何功能（任务照跑，只是看不到那些 provider），所以这里只记日志。
import { app } from "electron";
import { rm } from "node:fs/promises";
import path from "node:path";
import { resolveAgentDir } from "../history/session-index.ts";
import { log } from "../log/log.ts";
import { deployAccountExtension } from "./deploy.ts";

/** 应用就绪后、起任何 omp 之前调用一次。 */
export async function prepareAccountExtension(): Promise<void> {
  try {
    await deployAccountExtension(resolveAgentDir());
  } catch (error) {
    log.error("account provider extension: deploy failed", error);
  }
  // 0.4.24–0.4.27 写在 userData 里、用 `-e` 加载的旧部署，现在没人读了。
  await rm(path.join(app.getPath("userData"), "omp-extensions"), { recursive: true, force: true, maxRetries: 3 }).catch(
    (error: unknown) => log.warn("account provider extension: removing the old deployment failed", error),
  );
}
