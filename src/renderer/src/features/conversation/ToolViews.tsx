// 专用工具在对话流里的样子（Tern）：Task / wait = 状态行 + 子代理小卡；Todo = 分组清单；Ask = 问题 + 全部选项。
// 数据全部来自工具自己的参数 / 结果（tool-view.ts 解析）和子代理泳道（SubagentLane）；点子代理卡打开现有的 SubagentDetailPanel。
import { useState } from "react";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import type { TodoPhase } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import type { SubagentLane } from "../../../../shared/subagents.ts";
import { useT } from "../../i18n/use-t.ts";
import { Check, Users } from "../../icons.tsx";
import { SubagentDetailPanel } from "../lanes/SubagentDetailPanel.tsx";
import { Clamp } from "./Clamp.tsx";
import type { ToolStep } from "./model.ts";
import { summarizePhase } from "./todo-model.ts";
import { askViews, formatElapsed, taskAgentNames, waitJobs, type AskView, type WaitJob } from "./tool-view.ts";
import { useNow } from "./use-now.ts";

type CardStatus = "running" | "done" | "failed";

interface AgentCard {
  id: string;
  name: string;
  status: CardStatus;
  /** 已结束 / 已知时长（ms）；运行中的泳道用 startedAt 实时算。 */
  durationMs: number | null;
  startedAt: number | null;
  lane: SubagentLane | null;
}

/** 泳道状态（running / completed / failed / aborted）和 wait 的 job 状态同一套词：运行中、完成、其余都算失败。 */
function cardStatus(status: string): CardStatus {
  return status === "running" ? "running" : status === "completed" ? "done" : "failed";
}

function cardFromLane(lane: SubagentLane): AgentCard {
  return {
    id: lane.id,
    name: lane.id,
    status: cardStatus(lane.status),
    durationMs: lane.durationMs ?? (lane.endedAt !== null ? lane.endedAt - lane.startedAt : null),
    startedAt: lane.status === "running" ? lane.startedAt : null,
    lane,
  };
}

/** task 工具派出的代理：按参数里的名字对应泳道；泳道还没出现（或历史里没有）时按工具自己的状态画。 */
function taskCards(step: ToolStep, lanes: readonly SubagentLane[]): AgentCard[] {
  return taskAgentNames(step.args).map((name) => {
    const lane = lanes.find((candidate) => candidate.id === name);
    if (lane) return cardFromLane(lane);
    return {
      id: name,
      name,
      status: step.status === "running" ? "running" : step.status === "error" ? "failed" : "done",
      durationMs: null,
      startedAt: step.status === "running" ? step.startedAt : null,
      lane: null,
    };
  });
}

/** wait 工具在等的任务：优先用泳道（点得开），没有就用工具结果里的 job 信息。 */
function waitCards(jobs: readonly WaitJob[], lanes: readonly SubagentLane[]): AgentCard[] {
  return jobs.map((job) => {
    const lane = lanes.find((candidate) => candidate.id === job.id);
    if (lane) return cardFromLane(lane);
    return {
      id: job.id,
      name: job.label,
      status: cardStatus(job.status),
      durationMs: job.durationMs,
      startedAt: null,
      lane: null,
    };
  });
}

function JobsLine({ cards }: { cards: readonly AgentCard[] }) {
  const t = useT();
  const running = cards.filter((card) => card.status === "running").length;
  const done = cards.filter((card) => card.status === "done").length;
  const failed = cards.filter((card) => card.status === "failed").length;
  const parts =
    running > 0
      ? [t("tool.task.waiting", { running, total: cards.length })]
      : [t("tool.task.settled", { count: cards.length })];
  if (done > 0) parts.push(t("tool.task.done", { count: done }));
  if (failed > 0) parts.push(t("tool.task.failed", { count: failed }));
  return (
    <p className="jobs-line">
      <Users size={14} />
      <span className="jobs-line-main">{parts[0]}</span>
      {parts.length > 1 && <span className="jobs-line-rest">{parts.slice(1).join(" · ")}</span>}
    </p>
  );
}

function AgentGrid({
  cards,
  taskId,
  projectPath,
}: {
  cards: readonly AgentCard[];
  taskId: TaskId;
  projectPath: string | null;
}) {
  const t = useT();
  const [selected, setSelected] = useState<string | null>(null);
  const now = useNow(cards.some((card) => card.status === "running"));
  const selectedLane = cards.find((card) => card.id === selected)?.lane ?? null;
  return (
    <>
      <div className="agent-grid" data-testid="agent-grid">
        {cards.map((card) => {
          const duration = card.startedAt !== null ? now - card.startedAt : card.durationMs;
          const body = (
            <>
              <span className="agent-status" data-status={card.status} aria-hidden="true">
                {card.status === "done" ? <Check size={12} /> : null}
                {card.status === "failed" ? "✕" : null}
              </span>
              <span className="agent-name">{card.name}</span>
              {duration !== null && <span className="agent-time">{formatElapsed(duration)}</span>}
            </>
          );
          return card.lane === null ? (
            <div key={card.id} className="agent-card" data-status={card.status} data-testid="agent-card">
              {body}
            </div>
          ) : (
            <button
              key={card.id}
              type="button"
              className="agent-card"
              data-status={card.status}
              data-selected={card.id === selected || undefined}
              data-testid="agent-card"
              aria-pressed={card.id === selected}
              aria-label={t("tool.task.open", { name: card.name })}
              onClick={() => setSelected((current) => (current === card.id ? null : card.id))}
            >
              {body}
            </button>
          );
        })}
      </div>
      {selectedLane !== null && (
        <SubagentDetailPanel
          taskId={taskId}
          lane={selectedLane}
          projectPath={projectPath}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

export function TaskView({
  step,
  taskId,
  projectPath,
  lanes,
}: {
  step: ToolStep;
  taskId: TaskId;
  projectPath: string | null;
  lanes: readonly SubagentLane[];
}) {
  const cards = taskCards(step, lanes);
  const text = step.output?.trim() ?? "";
  return (
    <div className="tool-extra">
      {cards.length > 0 && <JobsLine cards={cards} />}
      {cards.length > 0 && <AgentGrid cards={cards} taskId={taskId} projectPath={projectPath} />}
      {text !== "" && (
        <Clamp lines={3} lineHeight="var(--lh-xs)" className="tool-result-text">
          <p className="tool-result-body">{text}</p>
        </Clamp>
      )}
    </div>
  );
}

export function WaitView({
  step,
  taskId,
  projectPath,
  lanes,
}: {
  step: ToolStep;
  taskId: TaskId;
  projectPath: string | null;
  lanes: readonly SubagentLane[];
}) {
  const jobs = waitJobs(step.result);
  if (jobs.length === 0) return null;
  const cards = waitCards(jobs, lanes);
  return (
    <div className="tool-extra">
      <JobsLine cards={cards} />
      <AgentGrid cards={cards} taskId={taskId} projectPath={projectPath} />
    </div>
  );
}

function TodoRing({ state }: { state: "pending" | "active" | "done" | "abandoned" | "blocked" }) {
  return (
    <span className="todo-ring" data-state={state} aria-hidden="true">
      {state === "done" ? <Check size={10} /> : null}
    </span>
  );
}

export function TodoView({ phases }: { phases: readonly TodoPhase[] }) {
  const t = useT();
  return (
    <div className="todo-list" data-testid="todo-list">
      {phases.map((phase, index) => {
        const progress = summarizePhase(phase);
        const finished = progress.total > 0 && progress.done === progress.total;
        return (
          <div key={`${phase.name}:${index}`} className="todo-phase">
            <div className="todo-phase-head">
              <TodoRing state={finished ? "done" : progress.active ? "active" : "pending"} />
              <span className="todo-phase-name">{phase.name}</span>
              <span className="todo-phase-count">
                {progress.done}/{progress.total}
              </span>
            </div>
            {!finished &&
              phase.tasks.map((task, taskIndex) => (
                <div
                  key={`${task.content}:${taskIndex}`}
                  className="todo-task"
                  data-status={task.status}
                  title={t(`tool.todo.${task.status}`)}
                >
                  <TodoRing
                    state={
                      task.status === "completed"
                        ? "done"
                        : task.status === "in_progress"
                          ? "active"
                          : task.status === "pending"
                            ? "pending"
                            : task.status
                    }
                  />
                  <span className="todo-task-text">{task.content}</span>
                  {task.blocker !== undefined && <span className="todo-task-note">{task.blocker}</span>}
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}

/** ask 头部的目标：单个问题就是问题本身，多个问题写个数。 */
export function askTarget(t: TFunction, views: readonly AskView[]): string | null {
  if (views.length === 0) return null;
  const first = views[0];
  return views.length === 1 && first ? first.question : t("tool.ask.count", { count: views.length });
}

export function AskAnswers({ step }: { step: ToolStep }) {
  const t = useT();
  const views = askViews(step.args, step.result);
  if (step.status === "running" || views.length === 0) return null;
  return (
    <div className="ask-list" data-testid="ask-answers">
      {views.map((view, index) => (
        <div key={`${view.question}:${index}`} className="ask-question">
          <p className="ask-text">{view.question}</p>
          {view.options.map((option) => {
            const chosen = view.selected.includes(option.label);
            return (
              <div
                key={option.label}
                className="ask-option"
                data-chosen={chosen || undefined}
                title={option.description ?? undefined}
              >
                <span className="ask-mark" aria-hidden="true">
                  {chosen ? <Check size={12} /> : null}
                </span>
                <span>{option.label}</span>
              </div>
            );
          })}
          {view.custom !== null && (
            <div className="ask-option" data-chosen>
              <span className="ask-mark" aria-hidden="true">
                <Check size={12} />
              </span>
              <span>{view.custom}</span>
            </div>
          )}
          {view.note !== null && (
            <p className="ask-note">
              {t("tool.ask.note")}: {view.note}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
