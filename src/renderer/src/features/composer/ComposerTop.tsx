// 输入框正上方的区域（spec §4.14，照 Tern）。自上而下：
//   药丸行  右对齐一颗 `[👥 N | ⚡ N]`（StatusPills：子代理 / 后台作业，各自点各自的，个数为 0 的那一段不画）；
//   状态行  左 = 运行图标 + 翻牌计时（FlipText）+ 细分隔线 + 当前活动；右 = 待办板（TodoBoard，点开展开阶段与条目）。
// 没有待办板时药丸不另占一行，直接并到状态行的右端；状态行也没有时（空闲、没有待办）药丸就直接在输入框上面。
// 状态行只在任务在跑（启动中 / 运行中 / 等你确认）或有待办时出现。这里只放结果性的信息：不画速度、token 数这类遥测。
// 数据全部来自 omp 的 TSP 文档：活动文字 shared/tsp/working.ts，子代理 shared/tsp/agent-hub.ts，作业 shared/tsp/jobs.ts，
// 待办 shared/tsp/todos.ts（主进程换算进 TaskState.todoPhases）；计时用主进程记的这一轮开始时间（TaskState.runStartedAt）。
// omp 自己的 HUD（作业胶囊、运行状态行、待办药丸）不画，见 TspChildren.tsx。
import { useMemo } from "react";
import type { TaskState } from "../../../../shared/ipc.ts";
import { AGENT_NODES, countActiveAgents } from "../../../../shared/tsp/agent-hub.ts";
import {
  deriveComposerFacts,
  parseLoaderText,
  sameComposerFacts,
  type ActionTarget,
  type ComposerFacts,
} from "../../../../shared/tsp/composer-facts.ts";
import { runningJobs } from "../../../../shared/tsp/jobs.ts";
import { deriveWorkingLabel } from "../../../../shared/tsp/working.ts";
import { useT } from "../../i18n/use-t.ts";
import { FlipText } from "../../ui/FlipText.tsx";
import { Reveal } from "../../ui/Reveal.tsx";
import { summarizeTodos } from "../conversation/todo-model.ts";
import { useNow } from "../conversation/use-now.ts";
import { useTspDerived } from "../tsp/tsp-store.ts";
import { formatElapsed } from "../tsp/fmt.ts";
import {
  CancelButton,
  ExtStatusTags,
  FocusBanner,
  IndeterminateBar,
  InterruptedNote,
  RetryActivity,
} from "./ComposerNotes.tsx";
import { PiWriteMark } from "./PiWriteMark.tsx";
import { StatusPills } from "./StatusPills.tsx";
import { TodoBoard } from "./TodoBoard.tsx";
import { useTspJobs } from "./tsp-jobs-store.ts";
import type { Job } from "../../../../shared/ui/jobs.ts";
import { useHeld } from "./use-held.ts";

const BUSY: ReadonlySet<TaskState["status"]> = new Set(["starting", "running", "needs_you"]);

/** 渲染用的快照：收起动画期间保留最后一次有内容时的样子。 */
interface View {
  task: TaskState;
  label: string | null;
  agents: number;
  /** 运行中的作业（除子代理；点 ⚡ 打开 omp 的作业弹窗，选中第一个）。 */
  running: readonly Job[];
  /** omp 状态区的事实（重试倒计时、压缩、中断提示、聚焦子代理，shared/tsp/composer-facts.ts）；文档还没有镜像为 null。 */
  facts: ComposerFacts | null;
}

function StatusLine({ task, label, facts }: { task: TaskState; label: string | null; facts: ComposerFacts | null }) {
  const t = useT();
  const now = useNow(task.runStartedAt !== null, task.runStartedAt ?? 0);
  const waiting = task.status === "needs_you";
  const retry = waiting ? null : (facts?.retry ?? null);
  const compaction = waiting ? null : (facts?.compaction ?? null);
  const loader = task.loaderText === null ? null : parseLoaderText(task.loaderText);
  const text = waiting
    ? t("composer.status.needsYou")
    : task.status === "starting"
      ? t("composer.status.starting")
      : (label ?? t("composer.status.working"));
  // 取消：重试和压缩点 omp 自己的取消 / 停止（`interrupt` 动作），能取消的空闲 loader（交接、分支摘要…）发 Esc。
  const cancel: ActionTarget | "escape" | null =
    retry?.cancel ?? compaction?.stop ?? (loader?.cancellable === true ? "escape" : null);
  return (
    <div className="run-main" data-testid="run-status-main" data-waiting={waiting || undefined}>
      {waiting ? (
        <span className="run-mark run-mark-waiting" aria-hidden="true" />
      ) : (
        <PiWriteMark className="run-mark" />
      )}
      {task.runStartedAt !== null && (
        <>
          <FlipText
            className="run-elapsed"
            testId="run-elapsed"
            value={formatElapsed(now - task.runStartedAt, "seconds")}
          />
          <span className="run-sep" aria-hidden="true" />
        </>
      )}
      {retry === null ? (
        <span className="run-activity" data-testid="run-activity">
          {text}
        </span>
      ) : (
        <RetryActivity retry={retry} />
      )}
      {compaction !== null && <IndeterminateBar />}
      {cancel !== null && <CancelButton taskId={task.id} target={cancel} />}
    </div>
  );
}

function TopContent({ view }: { view: View }) {
  const { task, label, agents, running, facts } = view;
  const busy = BUSY.has(task.status);
  const todo = summarizeTodos(task.todoPhases);
  const hasTodo = todo.total > 0;
  const hasPills = agents > 0 || running.length > 0;
  const interrupted = !busy && facts?.interrupted === true;
  const hasExt = task.extStatuses.length > 0;
  const pills = <StatusPills taskId={task.id} agents={agents} running={running} />;
  return (
    <div className="composer-top" data-testid="composer-top">
      {facts?.focus != null && <FocusBanner taskId={task.id} focus={facts.focus} />}
      {hasTodo && hasPills && <div className="top-pills">{pills}</div>}
      {(busy || hasTodo || hasPills || interrupted || hasExt) && (
        <div className="run-status" data-testid="run-status">
          {busy && <StatusLine task={task} label={label} facts={facts} />}
          {interrupted && <InterruptedNote taskId={task.id} />}
          <ExtStatusTags statuses={task.extStatuses} />
          {hasTodo ? (
            <div className="run-todo" data-testid="tsp-todo-bar">
              <TodoBoard taskId={task.id} phases={task.todoPhases} summary={todo} running={task.status === "running"} />
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
  const taskId = task.id;
  const label = useTspDerived(taskId, deriveWorkingLabel, Object.is);
  const agents = useTspDerived(taskId, countActiveAgents, Object.is, AGENT_NODES) ?? 0;
  const facts = useTspDerived(taskId, deriveComposerFacts, sameComposerFacts);
  const jobs = useTspJobs(taskId);
  // 药丸右半段 = 除子代理外所有运行中的作业（bash、eval、后台 task；shared/tsp/jobs.ts 的 runningJobs）。
  const running = useMemo(() => runningJobs(jobs), [jobs]);
  const busy = BUSY.has(task.status);
  const hasTodo = summarizeTodos(task.todoPhases).total > 0;
  const visible =
    busy ||
    hasTodo ||
    agents > 0 ||
    running.length > 0 ||
    task.extStatuses.length > 0 ||
    facts?.interrupted === true ||
    facts?.focus != null;
  const held = useHeld<View>(visible ? { task, label, agents, running, facts } : null);
  return <Reveal open={visible}>{held && <TopContent view={held} />}</Reveal>;
}
