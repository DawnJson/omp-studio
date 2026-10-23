// 输入框上方右对齐的一颗药丸 `[👥 2 | ⚡ 2]`：左半段 = 运行中的子代理数（点开右栏的子代理面板），右半段 = 运行中的后台作业数
// （点开 omp 自己的作业弹窗，选中第一个运行中的作业：左边列表、右边输出和"Cancel job"都是 omp 的）。某一段个数为 0 就不画那一段；
// 两段都没有时整颗药丸不画。两段各自点各自的，药丸本身不是按钮。数据：子代理 shared/tsp/agent-hub.ts 的 countActiveAgents，
// 作业 tsp-jobs-store（shared/tsp/jobs.ts）。位置由 ComposerTop 定（见它的说明）。
import type { TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Bolt, Users } from "../../icons.tsx";
import { reportOmpError } from "../../ui/errors.ts";
import { toggleAgentsPanel, useAgentsPanel } from "../agents/index.ts";
import { openTspJobs } from "./tsp-jobs-store.ts";

export function StatusPills({
  taskId,
  agents,
  running,
}: {
  taskId: TaskId;
  /** 运行中的子代理数。 */
  agents: number;
  /** 运行中的 bash 作业 id。 */
  running: readonly string[];
}) {
  const t = useT();
  const panel = useAgentsPanel();
  const showAgents = agents > 0;
  const first = running[0];
  const agentsLabel = t("composer.pills.agents", { count: agents });
  const jobsLabel = t("composer.pills.jobs", { count: running.length });
  return (
    <div
      className="status-pills"
      data-testid="status-pills"
      data-empty={(!showAgents && first === undefined) || undefined}
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
      {showAgents && first !== undefined && <span className="status-pill-sep" aria-hidden="true" />}
      {first !== undefined && (
        <button
          type="button"
          className="status-pill-seg"
          data-testid="pill-jobs"
          data-count={running.length}
          aria-label={jobsLabel}
          aria-haspopup="dialog"
          title={jobsLabel}
          onClick={() => openTspJobs(taskId, first).catch((error: unknown) => reportOmpError(t, error))}
        >
          <Bolt size={13} />
          <span className="status-pill-count">{running.length}</span>
        </button>
      )}
    </div>
  );
}
