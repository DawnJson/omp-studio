// 服务进程：登录、列 provider、设置页列模型这类不属于任何任务的操作用的 omp（docs/architecture/login.md）。
// `omp --mode rpc-ui --no-session`，cwd 是 userData/service/，按需启动，空闲 5 分钟关掉（生命周期见 idle-omp.ts）。
import { app } from "electron";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { buildOmpLaunch } from "../omp/launch.ts";
import { assignToAppJob } from "../platform/win32/job-object.ts";
import { IdleOmp } from "./idle-omp.ts";

const IDLE_CLOSE_MS = 5 * 60 * 1000;

/** 中性目录 userData/service：不让任何项目层配置混进来。 */
export async function serviceCwd(): Promise<string> {
  const cwd = path.join(app.getPath("userData"), "service");
  await mkdir(cwd, { recursive: true });
  return cwd;
}

export const serviceOmp = new IdleOmp({
  cwd: serviceCwd,
  launch: (cwd) => buildOmpLaunch({ cwd, noSession: true }),
  assignJob: assignToAppJob,
  idleCloseMs: IDLE_CLOSE_MS,
});
