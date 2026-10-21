// `/jobs`（S2Jobs）：studio 接管——不带参数打开输入框上方的作业弹层；`/jobs kill <id>|all` 结束作业（主进程拼命令，渲染进程不发自由文本）。
// omp 自己的 `/jobs` 弹窗只在弹层里"查看输出"时才打开（tsp-jobs-store.viewTspJobOutput）。
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { reportOmpError } from "../../ui/errors.ts";
import { pushToast } from "../dialogs/toast-store.ts";
import { killTspJob, requestOpenJobs } from "./tsp-jobs-store.ts";
import type { StudioSlashCommand } from "./studio-slash.ts";

const KILL = /^kill(?:\s+(\S+))?$/i;

export async function runJobsSlash(taskId: TaskId, args: string, t: TFunction): Promise<void> {
  const kill = KILL.exec(args);
  if (!kill) {
    requestOpenJobs(taskId);
    return;
  }
  const id = kill[1];
  if (id === undefined) {
    pushToast({ level: "info", message: t("slash.jobsKillUsage") });
    return;
  }
  try {
    await killTspJob(taskId, id);
  } catch (error) {
    reportOmpError(t, error);
  }
}

export const jobsSlash: StudioSlashCommand = {
  name: "jobs",
  descKey: "slash.jobsDesc",
  run: runJobsSlash,
};
