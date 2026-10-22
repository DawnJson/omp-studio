// 待办板：状态行右端一个按钮（状态图标 + 当前项 + done/total），点开向上弹出阶段与条目（ComposerTop 摆它）。
// 数据是主进程的 TaskState.todoPhases（TSP 的 omp.hud.todo 节点换算，shared/tsp/todos.ts）；这里只显示。
import { useCallback, useEffect, useId, useState } from "react";
import type { TodoPhase } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { useT } from "../../i18n/use-t.ts";
import { TodoMark } from "./TodoMark.tsx";
import { summarizePhase, toRoman, type TodoSummary } from "../conversation/todo-model.ts";
import { Popover } from "../../ui/Popover.tsx";
import { onStudioCommand } from "../palette/studio-command.ts";

export function TodoBoard({
  phases,
  summary,
  running,
}: {
  phases: readonly TodoPhase[];
  summary: TodoSummary;
  running: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // 斜杠命令 /todo：打开待办板。
  useEffect(() => onStudioCommand((command) => command === "todo" && setOpen(true)), []);
  const close = useCallback(() => setOpen(false), []);
  const panelId = useId();
  const { done, total, current } = summary;
  const shown = phases.filter((phase) => phase.tasks.length > 0);
  const spinning = running && current?.status === "in_progress";
  const finished = total > 0 && done === total;

  return (
    <div className="ui-popover-anchor todo-anchor">
      <button
        type="button"
        className="todo-board"
        data-testid="todo-board"
        data-finished={finished || undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        aria-label={t("composer.todoBoard", { done, total })}
        title={current?.content}
        onClick={() => setOpen((value) => !value)}
      >
        {/* 全部完成 = 对勾；进行中且任务在跑 = 转动的细弧；其余是细圈（带已完成比例的弧）。 */}
        <TodoMark
          state={finished ? "done" : spinning || done > 0 ? "active" : "pending"}
          spinning={spinning}
          progress={spinning ? undefined : total > 0 ? done / total : 0}
          className="todo-board-mark"
        />
        {current && <span className="todo-current">{current.content}</span>}
        <span className="todo-count">
          {done}/{total}
        </span>
      </button>
      <Popover open={open} onClose={close} align="end" width={380} label={t("conversation.todoTitle")}>
        <div className="todo-popover" id={panelId} data-testid="todo-popover">
          {shown.map((phase, index) => {
            const progress = summarizePhase(phase);
            const state =
              progress.total > 0 && progress.done === progress.total
                ? "done"
                : progress.done > 0 || progress.active
                  ? "active"
                  : "pending";
            return (
              <section key={`${index}:${phase.name}`} className="todo-phase">
                <h3 className="todo-phase-head">
                  <TodoMark
                    state={state}
                    spinning={running && progress.active}
                    progress={progress.total > 0 ? progress.done / progress.total : 0}
                    className="todo-phase-mark"
                  />
                  <span className="todo-phase-no">{toRoman(index + 1)}.</span>
                  <span className="todo-phase-name">{phase.name}</span>
                  <span className="todo-phase-count">
                    {progress.done}/{progress.total}
                  </span>
                </h3>
                <ul>
                  {phase.tasks.map((item, itemIndex) => (
                    <li key={itemIndex} className="todo-item" data-status={item.status}>
                      <TodoMark
                        state={
                          item.status === "completed"
                            ? "done"
                            : item.status === "in_progress"
                              ? "active"
                              : item.status === "blocked"
                                ? "blocked"
                                : item.status === "abandoned"
                                  ? "abandoned"
                                  : "pending"
                        }
                        spinning={running && item.status === "in_progress"}
                        className="todo-mark"
                      />
                      <span className="todo-text">
                        <span className="todo-content">{item.content}</span>
                        <span className="sr-only">{t(`conversation.todo.${item.status}`)}</span>
                        {item.status === "blocked" && item.blocker && (
                          <span className="todo-blocker">{item.blocker}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </Popover>
    </div>
  );
}
