// 输入框正上方的区域（spec §4.14，照 Tern）。自上而下：
//   药丸行  右对齐一颗 `[👥 N | ⚡ N]`（StatusPills：子代理 / 后台作业，各自点各自的，个数为 0 的那一段不画）；
//   状态行  左 = 运行图标 + 翻牌计时（FlipText）+ 细分隔线 + 当前活动；右 = 待办板（TodoBoard，点开展开阶段与条目）。
// 没有待办板时药丸不另占一行，直接并到状态行的右端；状态行也没有时（空闲、没有待办）药丸就直接在输入框上面。
// 状态行只在任务在跑（启动中 / 运行中 / 等你确认）或有待办时出现。这里只放结果性的信息：不画速度、token 数这类遥测。
// 数据全部来自 omp 的 TSP 文档：活动文字 shared/tsp/working.ts，子代理 shared/tsp/agent-hub.ts，作业 shared/tsp/jobs.ts，
// 待办 shared/tsp/todos.ts（主进程换算进 TaskState.todoPhases）；计时用主进程记的这一轮开始时间（TaskState.runStartedAt）。
// omp 自己的 HUD（作业胶囊、运行状态行、待办药丸）不画，见 TspChildren.tsx。
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { TaskState } from "../../../../shared/ipc.ts";
import { countActiveAgents } from "../../../../shared/tsp/agent-hub.ts";
import { deriveWorkingLabel } from "../../../../shared/tsp/working.ts";
import type { Job } from "../../../../shared/ui/jobs.ts";
import { useT } from "../../i18n/use-t.ts";
import { FlipText } from "../../ui/FlipText.tsx";
import { Reveal } from "../../ui/Reveal.tsx";
import { formatElapsed } from "../conversation/format.ts";
import { summarizeTodos } from "../conversation/todo-model.ts";
import { useNow } from "../conversation/use-now.ts";
import { pushToast } from "../dialogs/toast-store.ts";
import { useTspDerived } from "../tsp/tsp-store.ts";
import { DotSphereMark } from "./DotSphereMark.tsx";
import { StatusPills } from "./StatusPills.tsx";
import { TodoBoard } from "./TodoBoard.tsx";
import { useJobsOpenRequests, useTspJobs } from "./tsp-jobs-store.ts";
import { useHeld } from "./use-held.ts";

const BUSY: readonly TaskState["status"][] = ["starting", "running", "needs_you"];

/** 渲染用的快照：收起动画期间保留最后一次有内容时的样子。 */
interface View {
  task: TaskState;
  label: string | null;
  agents: number;
  running: number;
  jobsOpen: boolean;
}

function StatusLine({ task, label }: { task: TaskState; label: string | null }) {
  const t = useT();
  const now = useNow(true);
  const waiting = task.status === "needs_you";
  const text = waiting
    ? t("composer.status.needsYou")
    : task.status === "starting"
      ? t("composer.status.starting")
      : (label ?? t("composer.status.working"));
  return (
    <div className="run-main" data-testid="run-status-main" data-waiting={waiting || undefined}>
      {waiting ? (
        <span className="run-mark run-mark-waiting" aria-hidden="true" />
      ) : (
        <DotSphereMark className="run-mark" />
      )}
      {task.runStartedAt !== null && (
        <>
          <FlipText className="run-elapsed" testId="run-elapsed" value={formatElapsed(now - task.runStartedAt)} />
          <span className="run-sep" aria-hidden="true" />
        </>
      )}
      <span className="run-activity" data-testid="run-activity">
        {text}
      </span>
    </div>
  );
}

function TopContent({
  view,
  jobs,
  setJobsOpen,
}: {
  view: View;
  jobs: readonly Job[];
  setJobsOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const { task, label, agents, running, jobsOpen } = view;
  const busy = BUSY.includes(task.status);
  const todo = summarizeTodos(task.todoPhases);
  const hasTodo = todo.total > 0;
  const hasPills = agents > 0 || running > 0 || jobsOpen;
  const pills = (
    <StatusPills
      taskId={task.id}
      agents={agents}
      running={running}
      jobs={jobs}
      jobsOpen={jobsOpen}
      setJobsOpen={setJobsOpen}
    />
  );
  return (
    <div className="composer-top" data-testid="composer-top">
      {hasTodo && hasPills && <div className="top-pills">{pills}</div>}
      {(busy || hasTodo || hasPills) && (
        <div className="run-status" data-testid="run-status">
          {busy && <StatusLine task={task} label={label} />}
          {hasTodo ? (
            <div className="run-todo" data-testid="tsp-todo-bar">
              <TodoBoard phases={task.todoPhases} summary={todo} running={task.status === "running"} />
            </div>
          ) : (
            hasPills && <div className="run-pills">{pills}</div>
          )}
        </div>
      )}
    </div>
  );
}

export function ComposerTop({ task }: { task: TaskState }) {
  const t = useT();
  const taskId = task.id;
  const label = useTspDerived(taskId, deriveWorkingLabel, Object.is);
  const agents = useTspDerived(taskId, countActiveAgents, Object.is) ?? 0;
  const allJobs = useTspJobs(taskId);
  const bash = useMemo(() => allJobs.filter((job) => job.type === "bash"), [allJobs]);
  const running = useMemo(() => bash.filter((job) => job.status === "running").length, [bash]);
  const [jobsOpen, setJobsOpen] = useState(false);

  // `/jobs`：有 bash 作业（含已结束的）就打开看板，没有就提示。这个组件一直挂着（不在 Reveal 里），请求不会丢。
  const requests = useJobsOpenRequests(taskId);
  const handled = useRef(requests);
  const hasBash = bash.length > 0;
  useEffect(() => {
    if (requests === handled.current) return;
    handled.current = requests;
    if (hasBash) setJobsOpen(true);
    else pushToast({ level: "info", message: t("slash.jobsEmpty") });
  }, [requests, hasBash, t]);
  // 作业一个不剩（切任务、重开）时看板自己关。
  useEffect(() => {
    if (!hasBash) setJobsOpen(false);
  }, [hasBash]);

  const busy = BUSY.includes(task.status);
  const hasTodo = summarizeTodos(task.todoPhases).total > 0;
  const visible = busy || hasTodo || agents > 0 || running > 0 || jobsOpen;
  const held = useHeld<View>(visible ? { task, label, agents, running, jobsOpen } : null);
  return <Reveal open={visible}>{held && <TopContent view={held} jobs={bash} setJobsOpen={setJobsOpen} />}</Reveal>;
}
