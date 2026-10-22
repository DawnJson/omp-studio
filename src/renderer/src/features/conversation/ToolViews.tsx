// 专用工具在子代理记录里的样子（Tern）：Todo = 分组清单；Ask = 问题 + 全部选项。
// 数据全部来自工具自己的参数 / 结果（tool-view.ts 解析）。
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { TodoPhase } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { useT } from "../../i18n/use-t.ts";
import { Check } from "../../icons.tsx";
import type { ToolStep } from "./model.ts";
import { summarizePhase } from "./todo-model.ts";
import { askViews, type AskView } from "./tool-view.ts";

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
  if (views.length === 0) return null;
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
