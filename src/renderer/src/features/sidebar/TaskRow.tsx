// 任务行（spec §4.2）：[状态点][分叉箭头格][分叉图标][标题][尾部]。选中用 --bg-raised 底 + 细描边，不改字重。
// memo：props 是任务对象（没变的任务在 store 里是同一个对象）、几个布尔值、数字和稳定的 rows；尾部的相对时间各行自己从时钟里取，
// 时钟一跳只有文字变了的行重画。
import { memo, useRef, type CSSProperties } from "react";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import { limits, type Locale, type SessionSummary, type TaskState } from "../../../../shared/ipc.ts";
import { Branch, Dots } from "../../icons.tsx";
import { IconButton } from "../../ui/controls.tsx";
import { StatusDot } from "./StatusDot.tsx";
import { taskTail } from "../../../../shared/ui/task-time.ts";
import { taskTitle } from "../../../../shared/ui/sidebar-model.ts";
import { useCoarseClock } from "./task-time.ts";
import { ChevronIcon } from "./icons.tsx";

/** 分叉缩进：行上带 data-depth 和 --sb-depth，sidebar.css 按层数加左外边距并画竖向引导线；顶层什么都不加。 */
export function depthProps(depth: number): { "data-depth"?: number; style?: CSSProperties } {
  return depth === 0 ? {} : { "data-depth": depth, style: { "--sb-depth": depth } as CSSProperties };
}

/** 一行下面的分叉（spec §4.2）：total 全部后代行数，hidden 收起后没画的行数，collapsed 这一行是不是收起着。total 为 0 = 没有分叉。 */
export interface RowForks {
  total: number;
  hidden: number;
  collapsed: boolean;
}

/** 标题前面的两个小格：有分叉时给箭头留的空位（箭头是行里的兄弟按钮，按钮里不能套按钮），自己是分叉时的分叉图标。 */
export function ForkMarks({ depth, forks }: { depth: number; forks: RowForks }) {
  return (
    <>
      {forks.total > 0 && <span className="sb-fork-slot" aria-hidden="true" />}
      {depth > 0 && (
        <span className="sb-row-fork" aria-hidden="true">
          <Branch size={12} />
        </span>
      )}
    </>
  );
}

/** 有箭头可点：有分叉，且不是"收起着但下面的行全都要露出来（选中、在跑、等你确认），一行也没藏"——那时点了看不出变化。 */
function hasForkToggle(forks: RowForks): boolean {
  return forks.total > 0 && !(forks.collapsed && forks.hidden === 0);
}

/** 行主按钮上的 ←/→：收起 / 展开这一行下面的分叉（同文件夹头）。处理了返回 true。 */
export function forkArrowKey(key: string, navId: string, forks: RowForks, rows: RowHandlers): boolean {
  if (!hasForkToggle(forks)) return false;
  if ((key === "ArrowLeft" && !forks.collapsed) || (key === "ArrowRight" && forks.collapsed)) {
    rows.onToggleForks(navId);
    return true;
  }
  return false;
}

/**
 * 收起 / 展开分叉的箭头：盖在 .sb-fork-slot 那一格上。文字只在 aria-label / 悬停提示里：展开着是"收起 N 个分叉"，收起着是"展开 N 个分叉"（N = 藏起来的行数）。
 * 行是列表的停靠点时它也能 Tab 到（Enter / Space 翻转）；不带 data-nav，↑↓ 跳过它。
 */
export function ForkToggle({
  navId,
  forks,
  tabStop,
  rows,
}: {
  navId: string;
  forks: RowForks;
  tabStop: boolean;
  rows: RowHandlers;
}) {
  if (!hasForkToggle(forks)) return null;
  const label = forks.collapsed
    ? rows.t("sidebar.expandForks", { count: forks.hidden })
    : rows.t("sidebar.collapseForks", { count: forks.total });
  return (
    <button
      type="button"
      className="sb-fork-toggle"
      data-testid="sidebar-fork-toggle"
      data-collapsed={forks.collapsed}
      aria-expanded={!forks.collapsed}
      aria-label={label}
      title={label}
      tabIndex={tabStop ? 0 : -1}
      onClick={() => rows.onToggleForks(navId)}
    >
      <ChevronIcon />
    </button>
  );
}

/** 任务行和会话行共用的回调与格式化上下文；整个侧栏一份，只在语言变了时换新（行的 memo 靠它稳定）。 */
export interface RowHandlers {
  t: TFunction;
  locale: Locale;
  onSelect(task: TaskState, viaKeyboard: boolean): void;
  onFocusItem(navId: string): void;
  /** 收起 / 展开这一行（key）下面的分叉。 */
  onToggleForks(key: string): void;
  onOpenMenu(task: TaskState, x: number, y: number, trigger: HTMLElement): void;
  /** 历史会话行的右键菜单（归档）。 */
  onOpenSessionMenu(session: SessionSummary, x: number, y: number, trigger: HTMLElement): void;
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
  /** 分叉缩进层数（SidebarItem.depth）。 */
  depth: number;
  forks: RowForks;
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

export const TaskRow = memo(function TaskRow({ task, selected, tabStop, renaming, depth, forks, rows }: TaskRowProps) {
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
      {...depthProps(depth)}
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
          } else if (forkArrowKey(event.key, taskNavId(task), forks, rows)) event.preventDefault();
        }}
      >
        <StatusDot task={task} t={t} />
        <ForkMarks depth={depth} forks={forks} />
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
      <ForkToggle navId={taskNavId(task)} forks={forks} tabStop={tabStop} rows={rows} />
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
