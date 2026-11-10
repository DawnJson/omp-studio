// 列表里的一行（spec §4.2、§4.5）：studio 任务用 TaskRow，还没挂在任务上的历史会话用 SessionRow（点开 = 恢复成任务）。两种行同高（--row-task）、同一套行样式。
// 分叉出来的会话（任务或历史）缩进在原会话下面（SidebarItem.depth），原会话那一行带收起 / 展开分叉的箭头。
import { memo, useMemo } from "react";
import type { SessionSummary, TaskId } from "../../../../shared/ipc.ts";
import { sessionTitle, type ForkInfo, type SidebarItem } from "../../../../shared/ui/sidebar-model.ts";
import { formatTaskTime } from "../../../../shared/ui/task-time.ts";
import { selectTask } from "../../store/index.ts";
import { reportError } from "../../ui/errors.ts";
import { refreshProjects } from "./projects-store.ts";
import { SessionStatusDot } from "./StatusDot.tsx";
import { useCoarseClock } from "./task-time.ts";
import {
  depthProps,
  forkArrowKey,
  ForkMarks,
  ForkToggle,
  PinMark,
  TaskRow,
  type RowForks,
  type RowHandlers,
} from "./TaskRow.tsx";

interface SessionRowProps {
  session: SessionSummary;
  tabStop: boolean;
  depth: number;
  pinned: boolean;
  forks: RowForks;
  rows: RowHandlers;
}

const SessionRow = memo(function SessionRow({ session, tabStop, depth, pinned, forks, rows }: SessionRowProps) {
  const { t, locale } = rows;
  const label = sessionTitle(session) ?? t("history.untitled");
  const navId = `session:${session.id}`;
  const time = useCoarseClock((now) => formatTaskTime(t, locale, session.modifiedAt, now));
  return (
    <div
      className="sb-row"
      data-flip-key={session.id}
      data-testid="sidebar-session"
      {...depthProps(depth)}
      onContextMenu={(event) => {
        event.preventDefault();
        rows.onOpenSessionMenu(
          session,
          event.clientX,
          event.clientY,
          event.currentTarget.querySelector<HTMLElement>(".sb-row-main") ?? event.currentTarget,
        );
      }}
    >
      <button
        type="button"
        className="sb-row-main"
        data-nav={navId}
        tabIndex={tabStop ? 0 : -1}
        title={`${label}\n${session.cwd}`}
        onFocus={() => rows.onFocusItem(navId)}
        onKeyDown={(event) => {
          if (forkArrowKey(event.key, navId, forks, rows)) event.preventDefault();
        }}
        onClick={() =>
          void window.studio
            .resumeSession(session.id)
            // 恢复会让主进程重新显示移出列表的文件夹、加入新项目。
            .then((task) => Promise.all([selectTask(task.id), refreshProjects()]))
            .catch((error: unknown) => reportError(t, error, (message) => t("history.resumeFailed", { message })))
        }
      >
        <SessionStatusDot session={session} t={t} />
        <ForkMarks depth={depth} forks={forks} />
        <span className="sb-row-title">{label}</span>
        {pinned && <PinMark t={t} />}
        <span className="sb-row-tail">{time}</span>
      </button>
      <ForkToggle navId={navId} forks={forks} tabStop={tabStop} rows={rows} />
    </div>
  );
});

interface ItemRowProps {
  item: SidebarItem;
  /** 这一行下面的分叉（sidebar-model 的 visibleItems 给的）；没有分叉为 undefined。 */
  forks: ForkInfo | undefined;
  /** 这一行收起着分叉（搜索时总是 false）。 */
  collapsed: boolean;
  selectedTaskId: TaskId | null;
  tabStopId: string;
  renamingId: TaskId | null;
  rows: RowHandlers;
}

export function ItemRow({ item, forks, collapsed, selectedTaskId, tabStopId, renamingId, rows }: ItemRowProps) {
  // 拆成数字再合回一个对象：行是 memo 的，每次重算的 ForkInfo 是新对象，数字没变就不重画。
  const total = forks?.total ?? 0;
  const hidden = forks?.hidden ?? 0;
  const rowForks = useMemo<RowForks>(
    () => ({ total, hidden, collapsed: total > 0 && collapsed }),
    [total, hidden, collapsed],
  );
  if (item.kind === "session")
    return (
      <SessionRow
        session={item.session}
        tabStop={tabStopId === item.key}
        depth={item.depth}
        pinned={item.pinned}
        forks={rowForks}
        rows={rows}
      />
    );
  return (
    <TaskRow
      task={item.task}
      selected={item.task.id === selectedTaskId}
      tabStop={tabStopId === item.key}
      renaming={renamingId === item.task.id}
      depth={item.depth}
      pinned={item.pinned}
      forks={rowForks}
      rows={rows}
    />
  );
}
