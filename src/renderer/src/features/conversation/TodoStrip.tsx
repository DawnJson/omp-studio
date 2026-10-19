// 待办进度条（spec 4.6 的 ProgressPill）：有 todoPhases 时在对话流顶部出现，点开列出阶段与条目。
// 数据是主进程的 TaskState.todoPhases（get_state，todo 工具结束后刷新）；这里只显示。
import { useEffect, useId, useRef, useState } from "react";
import type { TodoPhase } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { useT } from "../../i18n/use-t.ts";
import { Check, ChevronDown, ChevronRight } from "../../icons.tsx";
import { summarizeTodos } from "./todo-model.ts";

export function TodoStrip({ phases }: { phases: readonly TodoPhase[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const { done, total, current } = summarizeTodos(phases);
  const visible = phases.some((phase) => phase.tasks.length > 0);

  useEffect(() => {
    if (!open) return;
    // document 先于 Composer 的 window 监听收到事件（冒泡顺序）；preventDefault 让 Composer 不再把这次 Esc 当成"停止任务"。
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setOpen(false);
    };
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  if (!visible) return null;
  const finished = total > 0 && done === total;

  return (
    <div className="todo-strip" ref={root} data-testid="todo-strip">
      <button
        type="button"
        className="todo-pill"
        aria-expanded={open}
        aria-controls={panelId}
        data-finished={finished || undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="todo-count">
          {done}/{total}
        </span>
        {current && <span className="todo-current">{current.content}</span>}
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && (
        <div className="todo-panel" id={panelId} role="region" aria-label={t("conversation.todoTitle")}>
          {phases.map((phase, index) => (
            <section key={`${index}:${phase.name}`} className="todo-phase">
              <h3 className="todo-phase-name">{phase.name}</h3>
              <ul>
                {phase.tasks.map((item, itemIndex) => (
                  <li key={itemIndex} className="todo-item" data-status={item.status}>
                    <span className="todo-mark" aria-hidden="true">
                      {item.status === "completed" && <Check size={12} />}
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
          ))}
        </div>
      )}
    </div>
  );
}
