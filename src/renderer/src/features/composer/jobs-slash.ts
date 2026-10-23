// `/jobs`（S2Jobs）：studio 接管——不带参数打开 omp 自己的作业弹窗，选中第一个运行中的作业（没有就选最近的那个）；
// 这个任务没有 bash 作业时给一条提示，不打开。`/jobs kill <id>|all` 结束作业（主进程拼命令，渲染进程不发自由文本）。
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { reportOmpError } from "../../ui/errors.ts";
import { pushToast } from "../dialogs/toast-store.ts";
import { killTspJob, openTspJobs, peekTspJobs } from "./tsp-jobs-store.ts";
import type { StudioSlashCommand } from "./studio-slash.ts";

const KILL = /^kill(?:\s+(\S+))?$/i;

async function runJobsSlash(taskId: TaskId, args: string, t: TFunction): Promise<void> {
  const kill = KILL.exec(args);
  if (!kill) {
    const own = peekTspJobs(taskId).filter((job) => job.type !== "agent");
    const target = own.find((job) => job.status === "running") ?? own.at(-1);
    if (target === undefined) {
      pushToast({ level: "info", message: t("slash.jobsEmpty") });
      return;
    }
    await openTspJobs(taskId, target.id).catch((error: unknown) => reportOmpError(t, error));
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
