// 任务行（spec §4.2）：[状态点][标题][尾部]。选中用底色 + 左侧竖条，不改字重。
import { useRef } from "react";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import { limits, type Locale, type TaskState } from "../../../../shared/ipc.ts";
import { MoreIcon } from "./icons.tsx";
import { StatusDot } from "./StatusDot.tsx";
import { formatTaskTime } from "./task-time.ts";

export interface TaskRowProps {
  task: TaskState;
  selected: boolean;
  /** roving tabindex：整个列表只有一个停靠点。 */
  tabStop: boolean;
  renaming: boolean;
  t: TFunction;
  locale: Locale;
  now: number;
  onSelect(task: TaskState, viaKeyboard: boolean): void;
  onFocusItem(navId: string): void;
  onOpenMenu(task: TaskState, x: number, y: number, trigger: HTMLElement): void;
  onStartRename(task: TaskState): void;
  onCommitRename(task: TaskState, title: string | null): void;
  onArchive(task: TaskState): void;
}

export const taskNavId = (task: TaskState) => `task:${task.id}`;

function RenameInput({ task, title, t, onDone }: { task: TaskState; title: string; t: TFunction; onDone(value: string | null): void }) {
  const settled = useRef(false);
  const finish = (value: string | null) => {
    if (settled.current) return;
    settled.current = true;
    onDone(value);
  };
  return (
    <div className="sb-row" data-selected={false} data-testid="task-row">
      <span className="sb-row-main sb-row-editing">
        <StatusDot task={task} t={t} />
        <input
          className="sb-rename"
          aria-label={t("task.renameLabel")}
          defaultValue={title}
          maxLength={limits.titleMaxChars}
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

export function TaskRow(props: TaskRowProps) {
  const { task, selected, renaming, t } = props;
  const title = task.title.trim() === "" ? t("task.untitled") : task.title;

  if (renaming) return <RenameInput task={task} title={title} t={t} onDone={(value) => props.onCommitRename(task, value)} />;

  const tail =
    task.status === "needs_you" || task.status === "starting"
      ? null
      : task.status === "running"
        ? task.runStartedAt === null
          ? null
          : t("task.runningFor", { n: Math.max(1, Math.floor((props.now - task.runStartedAt) / 60_000)) })
      : task.lastTurn?.status === "aborted"
        ? t("task.stopped")
        : formatTaskTime(t, props.locale, task.updatedAt, props.now);

  return (
    <div
      className="sb-row"
      data-selected={selected}
      data-status={task.status}
      data-testid="task-row"
      onContextMenu={(event) => {
        event.preventDefault();
        props.onOpenMenu(task, event.clientX, event.clientY, event.currentTarget.querySelector<HTMLElement>(".sb-row-main") ?? event.currentTarget);
      }}
    >
      <button
        type="button"
        className="sb-row-main"
        data-nav={taskNavId(task)}
        tabIndex={props.tabStop ? 0 : -1}
        aria-current={selected ? "true" : undefined}
        onFocus={() => props.onFocusItem(taskNavId(task))}
        onClick={(event) => props.onSelect(task, event.detail === 0)}
        onKeyDown={(event) => {
          if (event.key === "F2") {
            event.preventDefault();
            props.onStartRename(task);
          } else if (event.key === "Delete") {
            event.preventDefault();
            props.onArchive(task);
          }
        }}
      >
        <StatusDot task={task} t={t} />
        <span className="sb-row-title">{title}</span>
        {tail !== null && <span className="sb-row-tail">{tail}</span>}
      </button>
      <button
        type="button"
        className="sb-row-more"
        tabIndex={-1}
        aria-label={t("task.more")}
        aria-haspopup="menu"
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          props.onOpenMenu(task, box.left, box.bottom + 4, event.currentTarget);
        }}
      >
        <MoreIcon />
      </button>
    </div>
  );
}
