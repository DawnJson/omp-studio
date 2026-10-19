// 项目分组（spec §4.3）：头部 + 任务行。折叠时头部右侧显示任务数，组内有等待任务再加一个琥珀菱形。
import type { Project, TaskId } from "../../../../shared/ipc.ts";
import { ChevronIcon, MoreIcon, PlusIcon } from "./icons.tsx";
import type { ProjectGroupModel } from "../../../../shared/ui/sidebar-model.ts";
import { TaskRow, type TaskRowProps } from "./TaskRow.tsx";
import { Reveal } from "../../ui/Reveal.tsx";

export const projectNavId = (project: Project) => `project:${project.id}`;

export const initialVisibleTasks = 6;
export const showMoreStep = 20;

export type RowHandlers = Pick<
  TaskRowProps,
  "t" | "locale" | "now" | "onSelect" | "onFocusItem" | "onOpenMenu" | "onStartRename" | "onCommitRename" | "onArchive"
>;

interface ProjectGroupProps {
  group: ProjectGroupModel;
  collapsed: boolean;
  /** 已展开的任务数上限（默认 6，"显示更多"每次 +20）。 */
  limit: number;
  selectedTaskId: TaskId | null;
  tabStopId: string;
  renamingId: TaskId | null;
  rows: RowHandlers;
  onToggle(project: Project, collapsed: boolean): void;
  onShowMore(project: Project): void;
  onNewTask(project: Project): void;
  onOpenProjectMenu(project: Project, x: number, y: number, trigger: HTMLElement): void;
}

export function ProjectGroup(props: ProjectGroupProps) {
  const { group, collapsed, rows } = props;
  const { t } = rows;
  const { project } = group;
  const navId = projectNavId(project);
  const hasWaiting = group.tasks.some((task) => task.status === "needs_you");
  // 选中的任务排在 6 条之外时也要看得见，所以上限至少覆盖到它。
  const selectedAt = group.tasks.findIndex((task) => task.id === props.selectedTaskId);
  const limit = Math.max(props.limit, selectedAt + 1);
  const shown = group.tasks.slice(0, limit);
  const remaining = group.tasks.length - shown.length;

  return (
    <section className="sb-group" aria-label={group.label}>
      <div
        className="sb-group-head"
        onContextMenu={(event) => {
          event.preventDefault();
          props.onOpenProjectMenu(
            project,
            event.clientX,
            event.clientY,
            event.currentTarget.querySelector<HTMLElement>(".sb-group-toggle") ?? event.currentTarget,
          );
        }}
      >
        <button
          type="button"
          className="sb-group-toggle"
          data-nav={navId}
          data-collapsed={collapsed}
          tabIndex={props.tabStopId === navId ? 0 : -1}
          aria-expanded={!collapsed}
          aria-label={t("sidebar.toggleProject", { project: group.label })}
          title={project.path}
          onFocus={() => rows.onFocusItem(navId)}
          onClick={() => props.onToggle(project, !collapsed)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" && !collapsed) {
              event.preventDefault();
              props.onToggle(project, true);
            } else if (event.key === "ArrowRight" && collapsed) {
              event.preventDefault();
              props.onToggle(project, false);
            }
          }}
        >
          <span className="sb-chevron">
            <ChevronIcon />
          </span>
          <span className="sb-group-name">{group.label}</span>
          {collapsed && (
            <span className="sb-group-count">
              {hasWaiting && <span className="sb-waiting-diamond" role="img" aria-label={t("sidebar.waitingHere")} />}
              {group.tasks.length}
            </span>
          )}
        </button>
        <button
          type="button"
          className="sb-icon-btn sb-group-action"
          tabIndex={-1}
          aria-label={t("sidebar.newInProject")}
          title={t("sidebar.newInProject")}
          onClick={() => props.onNewTask(project)}
        >
          <PlusIcon />
        </button>
        <button
          type="button"
          className="sb-icon-btn sb-group-action"
          tabIndex={-1}
          aria-label={t("sidebar.projectMenu")}
          aria-haspopup="menu"
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            props.onOpenProjectMenu(project, box.left, box.bottom + 4, event.currentTarget);
          }}
        >
          <MoreIcon />
        </button>
      </div>
      <Reveal open={!collapsed}>
        <div className="sb-group-body">
          {group.tasks.length === 0 && <p className="sb-group-empty">{t("sidebar.empty")}</p>}
          {shown.map((task) => (
            <TaskRow
              key={task.id}
              {...rows}
              task={task}
              selected={task.id === props.selectedTaskId}
              tabStop={props.tabStopId === `task:${task.id}`}
              renaming={props.renamingId === task.id}
            />
          ))}
          {remaining > 0 && (
            <button
              type="button"
              className="sb-show-more"
              data-nav={`more:${project.id}`}
              tabIndex={props.tabStopId === `more:${project.id}` ? 0 : -1}
              onFocus={() => rows.onFocusItem(`more:${project.id}`)}
              onClick={() => props.onShowMore(project)}
            >
              {t("sidebar.showMore", { n: Math.min(remaining, showMoreStep) })}
            </button>
          )}
        </div>
      </Reveal>
    </section>
  );
}
