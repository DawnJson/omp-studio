// 待办板：状态行右端一个按钮（进度环 + 当前项 + done/total，照 Tern 里的 omp），点开向上弹出阶段与条目（ComposerTop 摆它）。
// 数据是主进程的 TaskState.todoPhases（TSP 的 omp.hud.todo 节点换算，shared/tsp/todos.ts）。
// 全部完成后 omp 过 `tasks.todoClearDelay` 秒自己把这个节点删掉（omp 18.12.6），todoPhases 变空，按钮跟着消失。
// 浮层里（照 omp 的 `/todo`，docs/architecture/todo-board.md）：
// - 每条下面是备注（omp 给的最后一条备注；受阻的是阻塞原因）；
// - 每条右边的 ⋯ 菜单：开始 / 完成 / 放弃 / 删除，经 TaskCommand `todo` 变成 `/todo start|done|drop|rm <内容>` 发给任务的 omp，omp 的反馈原文回读；
// - 阶段全部完成 / 放弃时默认收起（同 omp 的 HUD），点阶段头展开，底部"展开全部"一次全展开；
// - 底部："添加条目"（`/todo append`，阶段可选，没写就追加到最后一个阶段）、"复制为 Markdown"（本地拼，格式同 omp `/todo copy`）。
import { useCallback, useEffect, useId, useState } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import type { TodoPhase } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { todoItemOps, type TodoItemOp } from "../../../../shared/tsp/todos.ts";
import { useT } from "../../i18n/use-t.ts";
import { CopyIcon, Dots, Plus } from "../../icons.tsx";
import { Button, IconButton, TextField } from "../../ui/controls.tsx";
import { MenuList, type MenuEntry } from "../../ui/Menu.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { summarizePhase, toRoman, type TodoSummary } from "../conversation/todo-model.ts";
import { onStudioCommand } from "../palette/studio-command.ts";
import { copyTodoMarkdown, runTodo } from "./todo-actions.ts";
import { TodoMark } from "./TodoMark.tsx";

const OP_LABEL = {
  start: "board.todoStart",
  done: "board.todoDone",
  drop: "board.todoDrop",
  rm: "board.todoRemove",
} as const satisfies Record<TodoItemOp, `board.${string}`>;

export function TodoBoard({
  taskId,
  phases,
  summary,
  running,
}: {
  taskId: TaskId;
  phases: readonly TodoPhase[];
  summary: TodoSummary;
  running: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // 斜杠命令 /todo：打开待办板。
  useEffect(() => onStudioCommand((command) => command === "todo" && setOpen(true)), []);
  // 关掉浮层时条目菜单也收起：不然下次打开它还开着（2026-10-29 审计）。
  const close = useCallback(() => {
    setOpen(false);
    setMenuFor(null);
  }, []);
  const panelId = useId();
  const phaseListId = useId();
  const { done, total, current } = summary;
  const shown = phases.filter((phase) => phase.tasks.length > 0);
  const finished = total > 0 && done === total;
  const label = finished ? t("composer.todoAllDone") : current?.content;

  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [expandAll, setExpandAll] = useState(false);
  // 已做完的阶段默认收起；用户点开的记在这里（按阶段名）。
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState("");
  const [newPhase, setNewPhase] = useState("");

  // 全部完成 / 放弃的阶段（omp 的 HUD 也把它们收起）。
  const isSettled = (phase: TodoPhase) =>
    phase.tasks.every((task) => task.status === "completed" || task.status === "abandoned");
  const isCollapsed = (phase: TodoPhase) => !expandAll && isSettled(phase) && !opened.has(phase.name);
  const anyCollapsed = shown.some(isCollapsed);

  const run = async (command: Parameters<typeof runTodo>[2]): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    try {
      return await runTodo(t, taskId, command);
    } finally {
      setBusy(false);
    }
  };

  const submitNew = async () => {
    const task = newText.trim();
    if (task === "") return;
    const phase = newPhase.trim();
    const ok = await run({ kind: "todo", op: "append", task, ...(phase === "" ? {} : { phase }) });
    if (ok) setNewText("");
  };

  return (
    <div className="ui-popover-anchor todo-anchor">
      <button
        type="button"
        className="ui-chip todo-board"
        data-testid="todo-board"
        data-finished={finished || undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        aria-label={t("composer.todoBoard", { done, total })}
        title={current?.content}
        onClick={() => setOpen((value) => !value)}
      >
        {/* 照 Tern 里的 omp：进度环（已完成 / 总数，0 是一个圆点）+ 当前项（全部完成时写"全部完成"）+ 计数。 */}
        <TodoMark state="progress" progress={total > 0 ? done / total : 0} className="todo-board-mark" />
        {label && <span className="todo-current">{label}</span>}
        <span className="todo-count">
          {done}/{total}
        </span>
      </button>
      <Popover open={open} onClose={close} align="end" width={380} label={t("conversation.todoTitle")}>
        <div className="todo-popover" id={panelId} data-testid="todo-popover" aria-busy={busy}>
          {shown.map((phase, index) => {
            const progress = summarizePhase(phase);
            const collapsed = isCollapsed(phase);
            const settled = isSettled(phase);
            const state =
              progress.total > 0 && progress.done === progress.total
                ? "done"
                : progress.done > 0 || progress.active
                  ? "active"
                  : "pending";
            const head = (
              <>
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
              </>
            );
            return (
              <section
                key={`${index}:${phase.name}`}
                className="todo-phase"
                data-testid="todo-phase"
                data-collapsed={collapsed || undefined}
              >
                <h3 className="todo-phase-head">
                  {settled ? (
                    <button
                      type="button"
                      className="todo-phase-toggle"
                      data-testid="todo-phase-toggle"
                      aria-expanded={!collapsed}
                      onClick={() =>
                        setOpened((previous) => {
                          const next = new Set(previous);
                          if (next.has(phase.name)) next.delete(phase.name);
                          else next.add(phase.name);
                          return next;
                        })
                      }
                    >
                      {head}
                    </button>
                  ) : (
                    head
                  )}
                </h3>
                {!collapsed && (
                  <ul>
                    {phase.tasks.map((item, itemIndex) => {
                      const key = `${index}:${itemIndex}`;
                      const menuOpen = menuFor === key;
                      const items: MenuEntry[] = todoItemOps(item.status).flatMap((op): MenuEntry[] => {
                        const entry: MenuEntry = {
                          id: op,
                          label: t(OP_LABEL[op]),
                          testId: `todo-op-${op}`,
                          ...(op === "rm" ? { tone: "danger" as const } : {}),
                          onSelect: () => void run({ kind: "todo", op, target: item.content }),
                        };
                        return op === "rm" ? [{ kind: "separator", id: "sep" }, entry] : [entry];
                      });
                      return (
                        <li key={itemIndex} className="todo-item" data-status={item.status} data-testid="todo-item">
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
                            {item.notes?.map((note, noteIndex) => (
                              <span key={noteIndex} className="todo-note" data-testid="todo-note">
                                {note}
                              </span>
                            ))}
                            {menuOpen && (
                              <MenuList
                                items={items}
                                label={t("board.todoActions", { name: item.content })}
                                testId="todo-item-menu"
                                onPicked={() => setMenuFor(null)}
                              />
                            )}
                          </span>
                          <IconButton
                            label={t("board.todoActions", { name: item.content })}
                            testId="todo-item-more"
                            className="todo-more"
                            expanded={menuOpen}
                            disabled={busy}
                            onClick={() => setMenuFor(menuOpen ? null : key)}
                          >
                            <Dots size={14} />
                          </IconButton>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
          {adding && (
            <form
              className="todo-add"
              data-testid="todo-add-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitNew();
              }}
            >
              <TextField
                size="sm"
                value={newText}
                onChange={setNewText}
                placeholder={t("board.todoAddText")}
                aria-label={t("board.todoAddText")}
                testId="todo-add-text"
                autoFocus
              />
              <TextField
                size="sm"
                value={newPhase}
                onChange={setNewPhase}
                placeholder={t("board.todoAddPhase")}
                aria-label={t("board.todoAddPhase")}
                testId="todo-add-phase"
                list={phaseListId}
              />
              <datalist id={phaseListId}>
                {shown.map((phase) => (
                  <option key={phase.name} value={phase.name} />
                ))}
              </datalist>
              <Button
                size="sm"
                variant="primary"
                testId="todo-add-submit"
                disabled={busy || newText.trim() === ""}
                onClick={() => void submitNew()}
              >
                {t("board.todoAddSubmit")}
              </Button>
            </form>
          )}
          <div className="todo-foot">
            <Button
              size="sm"
              variant="quiet"
              testId="todo-add"
              icon={<Plus size={14} />}
              aria-expanded={adding}
              onClick={() => {
                setMenuFor(null);
                setAdding((value) => !value);
              }}
            >
              {t("board.todoAdd")}
            </Button>
            <IconButton
              label={t("board.todoCopyMarkdown")}
              testId="todo-copy"
              onClick={() => copyTodoMarkdown(t, phases)}
            >
              <CopyIcon size={14} />
            </IconButton>
            {(anyCollapsed || expandAll) && (
              <Button
                size="sm"
                variant="quiet"
                testId="todo-expand-all"
                onClick={() => setExpandAll((value) => !value)}
              >
                {t(expandAll ? "board.todoCollapseAll" : "board.todoExpandAll")}
              </Button>
            )}
          </div>
        </div>
      </Popover>
    </div>
  );
}
