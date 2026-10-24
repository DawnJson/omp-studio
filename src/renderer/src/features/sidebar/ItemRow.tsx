// 列表里的一行（spec §4.2、§4.5）：studio 任务用 TaskRow，还没挂在任务上的历史会话用 SessionRow（点开 = 恢复成任务）。两种行同高（--row-task）、同一套行样式。
import type { SessionSummary, TaskId } from "../../../../shared/ipc.ts";
import { sessionTitle, type SidebarItem } from "../../../../shared/ui/sidebar-model.ts";
import { formatTaskTime } from "../../../../shared/ui/task-time.ts";
import { selectTask } from "../../store/index.ts";
import { reportError } from "../../ui/errors.ts";
import { SessionStatusDot } from "./StatusDot.tsx";
import { TaskRow, type RowHandlers } from "./TaskRow.tsx";

interface SessionRowProps {
  session: SessionSummary;
  tabStop: boolean;
  rows: RowHandlers;
}

function SessionRow({ session, tabStop, rows }: SessionRowProps) {
  const { t, locale, now } = rows;
  const label = sessionTitle(session) ?? t("history.untitled");
  const navId = `session:${session.id}`;
  return (
    <div className="sb-row" data-flip-key={session.id} data-testid="sidebar-session">
      <button
        type="button"
        className="sb-row-main"
        data-nav={navId}
        tabIndex={tabStop ? 0 : -1}
        title={`${label}\n${session.cwd}`}
        onFocus={() => rows.onFocusItem(navId)}
        onClick={() =>
          void window.studio
            .resumeSession(session.id)
            .then((task) => selectTask(task.id))
            .catch((error: unknown) => reportError(t, error, (message) => t("history.resumeFailed", { message })))
        }
      >
        <SessionStatusDot session={session} t={t} />
        <span className="sb-row-title">{label}</span>
        <span className="sb-row-tail">{formatTaskTime(t, locale, session.modifiedAt, now)}</span>
      </button>
    </div>
  );
}

interface ItemRowProps {
  item: SidebarItem;
  selectedTaskId: TaskId | null;
  tabStopId: string;
  renamingId: TaskId | null;
  rows: RowHandlers;
}

export function ItemRow({ item, selectedTaskId, tabStopId, renamingId, rows }: ItemRowProps) {
  if (item.kind === "session")
    return <SessionRow session={item.session} tabStop={tabStopId === item.key} rows={rows} />;
  return (
    <TaskRow
      {...rows}
      task={item.task}
      selected={item.task.id === selectedTaskId}
      tabStop={tabStopId === item.key}
      renaming={renamingId === item.task.id}
    />
  );
}
