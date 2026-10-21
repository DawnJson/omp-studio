// 后台任务看板：输入框右上方单独一行的两个小按钮——`后台任务`（bash）和 `子代理`（task），各自带 ● 运行中 / ✓ 已结束 计数，
// 点开向上弹出同一个看板（只列该类型）；点一行展开——命令看输出尾部，子代理直接内嵌泳道里的详情面板。
// Esc / 点外面关闭，焦点回到触发它的按钮（Popover 处理）。本会话从没有过某类 job 时对应按钮不出现。
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { countJobs, type Job } from "../../../../shared/ui/jobs.ts";
import { useT } from "../../i18n/use-t.ts";
import { Branch, Check, ChevronRight, Terminal, Users } from "../../icons.tsx";
import { useLanes } from "../../store/index.ts";
import { formatElapsed } from "../conversation/format.ts";
import { useNow } from "../conversation/use-now.ts";
import { SubagentDetailPanel } from "../lanes/SubagentDetailPanel.tsx";
import { pushToast } from "../dialogs/toast-store.ts";
import { Popover } from "./Popover.tsx";
import { TspJobActions } from "./TspJobActions.tsx";
import { useJobsOpenRequests } from "./tsp-jobs-store.ts";

/** 已结束的用 omp 量的时长，运行中的用现在 - 开始；都没有就不显示。 */
function jobElapsed(job: Job, now: number): string | null {
  if (job.status === "running") return formatElapsed(now - job.startedAt);
  return job.durationMs === null ? null : formatElapsed(job.durationMs);
}

function JobTypeIcon({ type }: { type: Job["type"] }) {
  return type === "bash" ? <Terminal size={14} /> : <Branch size={14} />;
}

type JobType = Job["type"];

/** 按钮顺序：后台任务在左，子代理在右。 */
const TYPES: readonly JobType[] = ["bash", "task"];

export function JobsBoard({
  taskId,
  jobs,
  projectPath,
  tsp = false,
}: {
  taskId: TaskId;
  jobs: readonly Job[];
  projectPath: string | null;
  /** TSP 任务：作业来自 omp 的节点（tsp-jobs-store），弹层里多"结束 / 查看输出"。 */
  tsp?: boolean;
}) {
  const t = useT();
  const present = TYPES.filter((type) => jobs.some((job) => job.type === type));
  // `/jobs`：有作业就打开第一个按钮的弹层，没有就提示。
  const requests = useJobsOpenRequests(taskId);
  const handled = useRef(requests);
  useEffect(() => {
    if (requests === handled.current) return;
    handled.current = requests;
    if (present.length === 0) pushToast({ level: "info", message: t("slash.jobsEmpty") });
  }, [requests, present.length, t]);
  if (present.length === 0) return null;
  return (
    <div className="jobs-group">
      {present.map((type, index) => (
        <JobsButton
          key={type}
          type={type}
          taskId={taskId}
          jobs={jobs.filter((job) => job.type === type)}
          projectPath={projectPath}
          tsp={tsp}
          openSeq={index === 0 ? requests : null}
        />
      ))}
    </div>
  );
}

function JobsButton({
  type,
  taskId,
  jobs,
  projectPath,
  tsp,
  openSeq,
}: {
  type: JobType;
  taskId: TaskId;
  jobs: readonly Job[];
  projectPath: string | null;
  tsp: boolean;
  /** 非 null：`/jobs` 请求的序号，变大就打开（只有第一个按钮收）。 */
  openSeq: number | null;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const lastSeq = useRef(openSeq);
  useEffect(() => {
    if (openSeq === null || openSeq === lastSeq.current) return;
    lastSeq.current = openSeq;
    setOpen(true);
  }, [openSeq]);
  const [selected, setSelected] = useState<string | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const panelId = useId();
  const lanes = useLanes(taskId);
  const counts = countJobs(jobs);
  const now = useNow(open && counts.running > 0);
  const selectedJob = selected === null ? null : (jobs.find((job) => job.id === selected) ?? null);
  const running = counts.running > 0;
  const label = t(`composer.jobs.btn.${type}`);
  const summary = t(`composer.jobs.pill.${type}`, { running: counts.running, done: counts.done });

  return (
    <div className="pop-anchor jobs-anchor">
      <button
        type="button"
        className="jobs-pill"
        data-testid={`jobs-pill-${type}`}
        data-running={running || undefined}
        data-failed={counts.failed > 0 || undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        aria-label={summary}
        title={summary}
        onClick={() => setOpen((value) => !value)}
      >
        {type === "bash" ? (
          <Terminal size={13} className="jobs-pill-icon" />
        ) : (
          <Users size={13} className="jobs-pill-icon" />
        )}
        <span className="jobs-pill-label">{label}</span>
        <span className="jobs-pill-count" data-testid="jobs-pill-count" data-state={running ? "running" : "done"}>
          {running ? <span className="job-dot" data-status="running" aria-hidden="true" /> : <Check size={12} />}
          {running ? counts.running : counts.done}
        </span>
      </button>
      <Popover open={open} onClose={close} align="end" width={420} label={label}>
        <div className="jobs-board" id={panelId} data-testid="jobs-board">
          <h3 className="jobs-title">{label}</h3>
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
                  {expanded && tsp && <TspJobActions taskId={taskId} job={job} onClose={close} />}
                  {expanded &&
                    !tsp &&
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
