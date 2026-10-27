// 任务行（spec §4.2）：[状态点][标题][尾部]。选中用 --bg-raised 底 + 细描边，不改字重。
// memo：props 是任务对象（没变的任务在 store 里是同一个对象）、几个布尔值和稳定的 rows；尾部的相对时间各行自己从时钟里取，
// 时钟一跳只有文字变了的行重画。
import { memo, useRef } from "react";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import { limits, type Locale, type TaskState } from "../../../../shared/ipc.ts";
import { Branch, Dots } from "../../icons.tsx";
import { IconButton } from "../../ui/controls.tsx";
import { StatusDot } from "./StatusDot.tsx";
import { taskTail } from "../../../../shared/ui/task-time.ts";
import { taskTitle } from "../../../../shared/ui/sidebar-model.ts";
import { useCoarseClock } from "./task-time.ts";

/** 任务行和会话行共用的回调与格式化上下文；整个侧栏一份，只在语言变了时换新（行的 memo 靠它稳定）。 */
export interface RowHandlers {
  t: TFunction;
  locale: Locale;
  onSelect(task: TaskState, viaKeyboard: boolean): void;
  onFocusItem(navId: string): void;
  onOpenMenu(task: TaskState, x: number, y: number, trigger: HTMLElement): void;
  onStartRename(task: TaskState): void;
  onCommitRename(task: TaskState, title: string | null): void;
  onArchive(task: TaskState): void;
}

interface TaskRowProps {
  task: TaskState;
  selected: boolean;
  /** roving tabindex：整个列表只有一个停靠点。 */
  tabStop: boolean;
  renaming: boolean;
  rows: RowHandlers;
}

const taskNavId = (task: TaskState) => `task:${task.id}`;

function RenameInput({
  task,
  title,
  t,
  onDone,
}: {
  task: TaskState;
  title: string;
  t: TFunction;
  onDone(value: string | null): void;
}) {
  const settled = useRef(false);
  const finish = (value: string | null) => {
    if (settled.current) return;
    settled.current = true;
    onDone(value);
  };
  return (
    <div className="sb-row" data-flip-key={task.id} data-selected={false} data-testid="task-row">
      <span className="sb-row-main sb-row-editing">
        <StatusDot task={task} t={t} />
        <input
          className="sb-rename"
          aria-label={t("task.renameLabel")}
          defaultValue={title}
          maxLength={limits.titleMaxChars}
          spellCheck={false}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) finish(event.currentTarget.value);
            else if (event.key === "Escape") {
              event.stopPropagation();
              finish(null);
            }
          }}
          onBlur={(event) => finish(event.currentTarget.value)}
        />
      </span>
    </div>
  );
}

export const TaskRow = memo(function TaskRow({ task, selected, tabStop, renaming, rows }: TaskRowProps) {
  const { t } = rows;
  const cleanTitle = taskTitle(task);
  const title = cleanTitle === "" ? t("task.untitled") : cleanTitle;
  const tail = useCoarseClock((now) => taskTail(t, rows.locale, task, now));

  if (renaming)
    return <RenameInput task={task} title={title} t={t} onDone={(value) => rows.onCommitRename(task, value)} />;

  return (
    <div
      className="sb-row"
      data-flip-key={task.id}
      data-menu=""
      data-selected={selected}
      data-status={task.status}
      data-testid="task-row"
      onContextMenu={(event) => {
        event.preventDefault();
        rows.onOpenMenu(
          task,
          event.clientX,
          event.clientY,
          event.currentTarget.querySelector<HTMLElement>(".sb-row-main") ?? event.currentTarget,
        );
      }}
    >
      <button
        type="button"
        className="sb-row-main"
        data-nav={taskNavId(task)}
        tabIndex={tabStop ? 0 : -1}
        aria-current={selected ? "true" : undefined}
        onFocus={() => rows.onFocusItem(taskNavId(task))}
        onClick={(event) => rows.onSelect(task, event.detail === 0)}
        onKeyDown={(event) => {
          if (event.key === "F2") {
            event.preventDefault();
            rows.onStartRename(task);
          } else if (event.key === "Delete") {
            event.preventDefault();
            rows.onArchive(task);
          }
        }}
      >
        <StatusDot task={task} t={t} />
        <span className="sb-row-title" title={title}>
          {title}
        </span>
        {task.worktreeBranch !== null && (
          <span
            className="sb-row-branch"
            data-testid="task-row-worktree"
            title={t("git.row.worktree", { branch: task.worktreeBranch })}
            aria-label={t("git.row.worktree", { branch: task.worktreeBranch })}
          >
            <Branch size={12} />
          </span>
        )}
        {/* 没有时间也占着位置：⋯ 盖在这一格上，标题不跑到按钮底下 */}
        <span className="sb-row-tail">{tail}</span>
      </button>
      <IconButton
        className="sb-row-more"
        label={t("task.more")}
        tabIndex={-1}
        aria-haspopup="menu"
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          rows.onOpenMenu(task, box.left, box.bottom + 4, event.currentTarget);
        }}
      >
        <Dots />
      </IconButton>
    </div>
  );
});
