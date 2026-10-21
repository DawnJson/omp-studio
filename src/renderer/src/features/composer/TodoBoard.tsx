// 待办板：状态栏右侧一个按钮（环 + 当前项 + done/total），点开向上弹出阶段与条目。
// 数据是主进程的 TaskState.todoPhases（get_state，todo 工具结束后刷新）；这里只显示。
import { useCallback, useEffect, useId, useState } from "react";
import type { TodoPhase } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { useT } from "../../i18n/use-t.ts";
import { Check } from "../../icons.tsx";
import { summarizePhase, toRoman, type TodoSummary } from "../conversation/todo-model.ts";
import { Popover } from "./Popover.tsx";
import { onStudioCommand } from "../palette/studio-command.ts";

/** 圆环：底圈 + 已完成比例的弧；进行中且任务在跑时，再叠一段慢慢转的弧。 */
function Ring({ done, total, spinning }: { done: number; total: number; spinning: boolean }) {
  const percent = total > 0 ? (done / total) * 100 : 0;
  return (
    <svg className="todo-ring" viewBox="0 0 16 16" aria-hidden="true">
      <circle className="todo-ring-track" cx="8" cy="8" r="6" />
      <circle className="todo-ring-done" cx="8" cy="8" r="6" pathLength="100" strokeDasharray={`${percent} 100`} />
      {spinning && <circle className="todo-ring-run" cx="8" cy="8" r="6" pathLength="100" strokeDasharray="22 78" />}
    </svg>
  );
}

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
    <div className="pop-anchor todo-anchor">
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
        {/* 全部完成时换成对勾：满圈的完成色(--st-done)和底圈太接近，看着像空的。 */}
        {finished ? (
          <Check size={14} className="todo-ring-check" />
        ) : (
          <Ring done={done} total={total} spinning={spinning} />
        )}
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
                  ? "partial"
                  : "pending";
            return (
              <section key={`${index}:${phase.name}`} className="todo-phase">
                <h3 className="todo-phase-head">
                  <span className="todo-phase-mark" data-state={state} aria-hidden="true">
                    {state === "done" && <Check size={10} />}
                  </span>
                  <span className="todo-phase-no">{toRoman(index + 1)}.</span>
                  <span className="todo-phase-name">{phase.name}</span>
                  <span className="todo-phase-count">
                    {progress.done}/{progress.total}
                  </span>
                </h3>
                <ul>
                  {phase.tasks.map((item, itemIndex) => (
                    <li key={itemIndex} className="todo-item" data-status={item.status}>
                      <span className="todo-mark" aria-hidden="true">
                        {item.status === "completed" && <Check size={10} />}
                      </span>
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
