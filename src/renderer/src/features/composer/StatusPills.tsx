// 输入框上方右对齐的一颗药丸 `[👥 2 | ⚡ 2]`：左半段 = 运行中的子代理数（点开右栏的子代理面板），右半段 = 运行中的后台作业数
// （点开向上弹出的作业看板，JobsBoard）。某一段个数为 0 就不画那一段；两段都没有时整颗药丸不画，只留（需要时）看板的锚点——
// 作业都结束后 `/jobs` 仍能打开看板看已结束的。两段各自点各自的，药丸本身不是按钮。数据：子代理 shared/tsp/agent-hub.ts 的
// countActiveAgents，作业 tsp-jobs-store（shared/tsp/jobs.ts）。位置由 ComposerTop 定（见它的说明）。
import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import type { Job } from "../../../../shared/ui/jobs.ts";
import { useT } from "../../i18n/use-t.ts";
import { Bolt, Users } from "../../icons.tsx";
import { toggleAgentsPanel, useAgentsPanel } from "../agents/index.ts";
import { JobsBoard } from "./JobsBoard.tsx";

export function StatusPills({
  taskId,
  agents,
  running,
  jobs,
  jobsOpen,
  setJobsOpen,
}: {
  taskId: TaskId;
  /** 运行中的子代理数。 */
  agents: number;
  /** 运行中的后台作业数。 */
  running: number;
  /** 本任务已知的 bash 作业（含已结束的，看板里列）。 */
  jobs: readonly Job[];
  jobsOpen: boolean;
  setJobsOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const t = useT();
  const panel = useAgentsPanel();
  const closeJobs = useCallback(() => setJobsOpen(false), [setJobsOpen]);
  const showAgents = agents > 0;
  const showJobs = running > 0;
  const agentsLabel = t("composer.pills.agents", { count: agents });
  const jobsLabel = t("composer.pills.jobs", { count: running });
  return (
    <div
      className="status-pills"
      data-testid="status-pills"
      data-empty={(!showAgents && !showJobs) || undefined}
      role="group"
      aria-label={t("composer.pills.aria")}
    >
      {showAgents && (
        <button
          type="button"
          className="status-pill-seg"
          data-testid="pill-agents"
          data-count={agents}
          aria-label={agentsLabel}
          aria-expanded={panel?.taskId === taskId}
          title={agentsLabel}
          onClick={() => toggleAgentsPanel(taskId)}
        >
          <Users size={13} />
          <span className="status-pill-count">{agents}</span>
        </button>
      )}
      {showAgents && showJobs && <span className="status-pill-sep" aria-hidden="true" />}
      <div className="ui-popover-anchor jobs-anchor">
        {showJobs && (
          <button
            type="button"
            className="status-pill-seg"
            data-testid="pill-jobs"
            data-count={running}
            aria-label={jobsLabel}
            aria-expanded={jobsOpen}
            aria-haspopup="dialog"
            title={jobsLabel}
            onClick={() => setJobsOpen((open) => !open)}
          >
            <Bolt size={13} />
            <span className="status-pill-count">{running}</span>
          </button>
        )}
        <JobsBoard taskId={taskId} jobs={jobs} open={jobsOpen} onClose={closeJobs} />
      </div>
    </div>
  );
}
