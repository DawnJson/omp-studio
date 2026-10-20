// 后台任务看板：输入框工具行右侧的小胶囊（● 运行中 │ ✓ 已结束），点开向上弹出列表；
// 点一行展开——命令看输出尾部，子代理直接内嵌泳道里的详情面板。Esc / 点外面关闭，焦点回到胶囊（Popover 处理）。
import { useCallback, useId, useState } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { countJobs, type Job } from "../../../../shared/ui/jobs.ts";
import { useT } from "../../i18n/use-t.ts";
import { Branch, Check, ChevronRight, Terminal } from "../../icons.tsx";
import { useLanes } from "../../store/index.ts";
import { formatElapsed } from "../conversation/format.ts";
import { useNow } from "../conversation/use-now.ts";
import { SubagentDetailPanel } from "../lanes/SubagentDetailPanel.tsx";
import { Popover } from "./Popover.tsx";

/** 已结束的用 omp 量的时长，运行中的用现在 - 开始；都没有就不显示。 */
export function jobElapsed(job: Job, now: number): string | null {
  if (job.status === "running") return formatElapsed(now - job.startedAt);
  return job.durationMs === null ? null : formatElapsed(job.durationMs);
}

export function JobTypeIcon({ type }: { type: Job["type"] }) {
  return type === "bash" ? <Terminal size={14} /> : <Branch size={14} />;
}

export function JobsBoard({
  taskId,
  jobs,
  projectPath,
}: {
  taskId: TaskId;
  jobs: readonly Job[];
  projectPath: string | null;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const panelId = useId();
  const lanes = useLanes(taskId);
  const counts = countJobs(jobs);
  const now = useNow(open && counts.running > 0);
  if (jobs.length === 0) return null;
  const selectedJob = selected === null ? null : (jobs.find((job) => job.id === selected) ?? null);

  return (
    <div className="pop-anchor jobs-anchor">
      <button
        type="button"
        className="jobs-pill"
        data-testid="jobs-pill"
        data-running={counts.running > 0 || undefined}
        data-failed={counts.failed > 0 || undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        aria-label={t("composer.jobs.pill", { running: counts.running, done: counts.done })}
        title={t("composer.jobs.pill", { running: counts.running, done: counts.done })}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="jobs-pill-part" data-testid="jobs-pill-running">
          <span className="job-dot" data-status="running" aria-hidden="true" />
          {counts.running}
        </span>
        <span className="jobs-pill-sep" aria-hidden="true" />
        <span className="jobs-pill-part" data-testid="jobs-pill-done">
          <Check size={12} />
          {counts.done}
        </span>
      </button>
      <Popover open={open} onClose={close} align="end" width={420} label={t("composer.jobs.title")}>
        <div className="jobs-board" id={panelId} data-testid="jobs-board">
          <h3 className="jobs-title">{t("composer.jobs.title")}</h3>
          <ul className="jobs-list">
            {jobs.map((job) => {
              const expanded = selectedJob?.id === job.id;
              const elapsed = jobElapsed(job, now);
              const lane = job.type === "task" ? lanes.find((item) => item.id === job.id) : undefined;
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
                    <span className="job-type" title={t(`composer.jobs.type.${job.type}`)}>
                      <JobTypeIcon type={job.type} />
                    </span>
                    <span className="job-label" title={job.label}>
                      {job.label}
                    </span>
                    <span className="job-status" data-status={job.status}>
                      <span className="job-dot" data-status={job.status} aria-hidden="true" />
                      {t(`composer.jobs.status.${job.status}`)}
                    </span>
                    <span className="job-elapsed">{elapsed}</span>
                  </button>
                  {expanded &&
                    (job.type === "bash" ? (
                      <pre className="job-output" data-testid="job-output">
                        {job.output ?? t("composer.jobs.noOutput")}
                      </pre>
                    ) : lane ? (
                      <SubagentDetailPanel
                        taskId={taskId}
                        lane={lane}
                        projectPath={projectPath}
                        onClose={() => setSelected(null)}
                      />
                    ) : (
                      <p className="job-note">{t("composer.jobs.noAgent")}</p>
                    ))}
                </li>
              );
            })}
          </ul>
        </div>
      </Popover>
    </div>
  );
}
