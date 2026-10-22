// 后台任务看板：药丸（StatusPills）右半段 `⚡ N` 点开，向上弹出的列表——只列 bash 后台作业（子代理在右栏的子代理面板里）。
// 点一行展开动作：在 omp 的作业窗口查看输出、（运行中的）结束，见 TspJobActions.tsx。Esc / 点外面关闭，焦点回到触发它的按钮（Popover 处理）。
// 数据是 tsp-jobs-store 从 omp 的节点推出来的（shared/tsp/jobs.ts）；`/jobs` 从输入框打开它（ComposerTop 收请求）。
import { useId, useState } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import type { Job } from "../../../../shared/ui/jobs.ts";
import { useT } from "../../i18n/use-t.ts";
import { ChevronRight } from "../../icons.tsx";
import { formatElapsed } from "../conversation/format.ts";
import { useNow } from "../conversation/use-now.ts";
import { Popover } from "../../ui/Popover.tsx";
import { TspJobActions } from "./TspJobActions.tsx";

/** 已结束的用 omp 量的时长，运行中的用现在 - 开始；都没有就不显示。 */
function jobElapsed(job: Job, now: number): string | null {
  if (job.status === "running") return formatElapsed(now - job.startedAt);
  return job.durationMs === null ? null : formatElapsed(job.durationMs);
}

export function JobsBoard({
  taskId,
  jobs,
  open,
  onClose,
}: {
  taskId: TaskId;
  /** 只含 bash 作业（ComposerTop 过滤过）。 */
  jobs: readonly Job[];
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const [selected, setSelected] = useState<string | null>(null);
  const panelId = useId();
  const now = useNow(open && jobs.some((job) => job.status === "running"));
  const label = t("composer.jobs.btn.bash");
  return (
    <Popover open={open} onClose={onClose} align="end" width={420} label={label}>
      <div className="jobs-board" id={panelId} data-testid="jobs-board">
        <h3 className="jobs-title">{label}</h3>
        <ul className="jobs-list">
          {jobs.map((job) => {
            const expanded = selected === job.id;
            return (
              <li key={job.id} className="job-item">
                <button
                  type="button"
                  className="job-row"
                  data-testid="job-row"
                  data-job-id={job.id}
                  data-type={job.type}
                  data-status={job.status}
                  aria-expanded={expanded}
                  onClick={() => setSelected(expanded ? null : job.id)}
                >
                  <ChevronRight size={12} className="job-caret" />
                  <span className="job-label" title={job.label}>
                    {job.label}
                  </span>
                  <span className="job-status" data-status={job.status}>
                    <span className="job-dot" data-status={job.status} aria-hidden="true" />
                    {t(`composer.jobs.status.${job.status}`)}
                  </span>
                  <span className="job-elapsed">{jobElapsed(job, now)}</span>
                </button>
                {expanded && <TspJobActions taskId={taskId} job={job} onClose={onClose} />}
              </li>
            );
          })}
        </ul>
      </div>
    </Popover>
  );
}
