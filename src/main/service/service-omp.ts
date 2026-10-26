// 服务进程：登录、列 provider、设置页列模型这类不属于任何任务的操作用的 omp（docs/architecture/login.md）。
// `omp --mode rpc-ui --no-session`，cwd 是 userData/service/，按需启动，空闲 5 分钟关掉（生命周期见 idle-omp.ts）。
// 一个可用模型都没有时（新装、还没登录也没有 key），omp 18.12.6 的 rpc-ui 握手前就以 1 退出（"No default model selected"），
// 设置页连 provider 列表都拿不到、没法登录；这时带 `--model <占位>` 再起一次，进程能活着答登录、列表这些请求。
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

/** 内置目录里有的模型（omp 18.12.6 实测：没凭据也能起来；目录里没有的模型照样退出）。只占位，不会用它发请求。 */
const PLACEHOLDER_MODEL = "anthropic/claude-sonnet-4-5";
/** omp 因为没有任何可用模型而退出时写的 stderr（omp 18.12.6 `main.ts`）。 */
const NO_MODEL_EXIT = /No default model selected|No models available/;

let placeholderModel = false;

/** 当前服务进程是不是用占位模型起的：是的话 get_state 的模型不是用户的默认模型。 */
export function serviceHasNoModel(): boolean {
  return placeholderModel;
}

export const serviceOmp = new IdleOmp({
  cwd: serviceCwd,
  launch: (cwd) => {
    placeholderModel = false;
    return buildOmpLaunch({ cwd, noSession: true });
  },
  relaunch: async (cwd, exit) => {
    if (!NO_MODEL_EXIT.test(exit.stderrTail)) return null;
    placeholderModel = true;
    return await buildOmpLaunch({ cwd, noSession: true, model: PLACEHOLDER_MODEL });
  },
  assignJob: assignToAppJob,
  idleCloseMs: IDLE_CLOSE_MS,
});
