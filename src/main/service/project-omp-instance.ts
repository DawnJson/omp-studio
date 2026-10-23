// 项目目录 rpc-ui 池的单例：`runBuiltin`（项目范围的内置命令）和斜杠菜单的命令列表（任务目录里的 skill / 自定义命令 / 扩展命令）共用。
// 退出：全部关掉（主进程被强杀时由 Job Object 兜底）。
import { buildOmpLaunch } from "../omp/launch.ts";
import { assignToAppJob } from "../platform/win32/job-object.ts";
import { pathKey } from "../tasks/task-registry.ts";
import { registerShutdownHook } from "../window/shutdown.ts";
import { PROJECT_IDLE_CLOSE_MS, ProjectOmpPool } from "./project-omp.ts";

export const projectOmp = new ProjectOmpPool(
  { launch: (cwd) => buildOmpLaunch({ cwd, noSession: true }), assignJob: assignToAppJob },
  PROJECT_IDLE_CLOSE_MS,
  pathKey,
);
registerShutdownHook(() => projectOmp.close());
