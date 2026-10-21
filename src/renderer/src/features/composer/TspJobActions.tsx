// TSP 任务作业弹层里的动作（S2Jobs）：数据和动作见 tsp-jobs-store.ts。
// bash 作业：结束（`/jobs kill`）、在 omp 的作业窗口查看输出（输出只在那里有，omp 没有别的通道）；
// 子代理作业：在子代理面板里查看（结束 / 插话在面板里）。
import { useState } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import type { Job } from "../../../../shared/ui/jobs.ts";
import { useT } from "../../i18n/use-t.ts";
import { reportOmpError } from "../../ui/errors.ts";
import { openAgentsPanel } from "../agents/index.ts";
import { killTspJob, viewTspJobOutput } from "./tsp-jobs-store.ts";

export function TspJobActions({ taskId, job, onClose }: { taskId: TaskId; job: Job; onClose: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  if (job.type === "task") {
    return (
      <div className="job-actions" data-testid="tsp-job-actions">
        <button
          type="button"
          className="job-action"
          data-testid="tsp-job-open-agent"
          onClick={() => {
            onClose();
            openAgentsPanel(taskId, job.id);
          }}
        >
          {t("composer.jobs.openAgent")}
        </button>
      </div>
    );
  }
  return (
    <div className="job-actions" data-testid="tsp-job-actions">
      <p className="job-note">{t("composer.jobs.tspOutputHint")}</p>
      <button
        type="button"
        className="job-action"
        data-testid="tsp-job-view-output"
        onClick={() => {
          onClose();
          viewTspJobOutput(taskId, job.id).catch((error: unknown) => reportOmpError(t, error));
        }}
      >
        {t("composer.jobs.viewOutput")}
      </button>
      {job.status === "running" && (
        <button
          type="button"
          className="job-action"
          data-testid="tsp-job-kill"
          data-danger=""
          disabled={busy}
          onClick={() => {
            setBusy(true);
            killTspJob(taskId, job.id)
              .catch((error: unknown) => reportOmpError(t, error))
              .finally(() => setBusy(false));
          }}
        >
          {t("composer.jobs.kill")}
        </button>
      )}
    </div>
  );
}
