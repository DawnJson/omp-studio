// 输入框上方的状态栏：左 = 本次运行已用时间 + 当前活动；右 = 待办板。两边都没内容时整行淡出收起。
import { useMemo } from "react";
import type { TaskState } from "../../../../shared/ipc.ts";
import type { Transcript } from "../../../../shared/transcript.ts";
import { countJobs, type Job } from "../../../../shared/ui/jobs.ts";
import { useT } from "../../i18n/use-t.ts";
import { Reveal } from "../../ui/Reveal.tsx";
import { formatElapsed } from "../conversation/format.ts";
import { liveStatusText, scanLive } from "../conversation/live-status.ts";
import { summarizeTodos } from "../conversation/todo-model.ts";
import { useNow } from "../conversation/use-now.ts";
import { useWaitingSince } from "../conversation/use-waiting-since.ts";
import { DotSphereMark } from "./DotSphereMark.tsx";
import { jobElapsed, JobTypeIcon } from "./JobsBoard.tsx";
import { TodoBoard } from "./TodoBoard.tsx";
import { useHeld } from "./use-held.ts";

const BUSY: readonly TaskState["status"][] = ["starting", "running", "needs_you"];

interface RowProps {
  task: TaskState;
  transcript: Transcript | null;
  waitingSince: number | null;
  jobs: readonly Job[];
}

/** 状态行下最多并排的 job 小卡数；多的折成 +N。 */
const MAX_CHIPS = 4;

function RunStatusRow({ task, transcript, waitingSince, jobs }: RowProps) {
  const t = useT();
  const busy = BUSY.includes(task.status);
  const running = useMemo(() => jobs.filter((job) => job.status === "running"), [jobs]);
  const now = useNow(busy);
  const scan = useMemo(() => scanLive(transcript), [transcript]);
  const counts = useMemo(() => countJobs(jobs), [jobs]);
  const summary = summarizeTodos(task.todoPhases);

  return (
    <div className="run-status" data-testid="run-status">
      {busy && (
        <div className="run-main" data-testid="run-status-main" data-waiting={task.status === "needs_you" || undefined}>
          {task.status === "needs_you" ? (
            <span className="run-mark run-mark-waiting" aria-hidden="true" />
          ) : (
            <DotSphereMark className="run-mark" />
          )}
          {task.runStartedAt !== null && (
            <>
              <span className="run-elapsed">{formatElapsed(now - task.runStartedAt)}</span>
              <span className="run-sep" aria-hidden="true" />
            </>
          )}
          <span className="run-activity">
            {liveStatusText(
              { status: task.status, waitingSince, subagentsRunning: task.runningSubagents, scan, jobs: counts },
              now,
              t,
            )}
          </span>
        </div>
      )}
      {busy && running.length > 0 && (
        <div className="job-chips" data-testid="job-chips">
          {running.slice(0, MAX_CHIPS).map((job) => (
            <span key={job.id} className="job-chip" data-testid="job-chip" data-job-id={job.id} title={job.label}>
              <JobTypeIcon type={job.type} />
              <span className="job-chip-label">{job.label}</span>
              <span className="job-chip-time">{jobElapsed(job, now)}</span>
            </span>
          ))}
          {running.length > MAX_CHIPS && <span className="job-chip-more">+{running.length - MAX_CHIPS}</span>}
        </div>
      )}
      {summary.total > 0 && (
        <TodoBoard phases={task.todoPhases} summary={summary} running={task.status === "running"} />
      )}
    </div>
  );
}

export function RunStatus({
  task,
  transcript,
  jobs,
}: {
  task: TaskState;
  transcript: Transcript | null;
  jobs: readonly Job[];
}) {
  const waitingSince = useWaitingSince(task);
  const visible = BUSY.includes(task.status) || summarizeTodos(task.todoPhases).total > 0;
  // 收起动画期间内容不能先消失：保留最后一次有内容时的快照。
  const held = useHeld(visible ? { task, transcript, waitingSince, jobs } : null);
  return <Reveal open={visible}>{held && <RunStatusRow {...held} />}</Reveal>;
}
