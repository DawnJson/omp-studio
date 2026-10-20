// 文件夹分组（spec §4.3）：头部 + 任务和历史会话混排的行。折叠时头部右侧显示行数，组内有等待任务再加一个琥珀菱形。
// 头部的 + 在这个文件夹新建任务（纯历史文件夹会先把它加成项目）；⋯ 项目菜单只有 studio 项目才有。
import type { Project, TaskId } from "../../../../shared/ipc.ts";
import type { SidebarFolder } from "../../../../shared/ui/sidebar-model.ts";
import { Reveal } from "../../ui/Reveal.tsx";
import { ChevronIcon, MoreIcon, PlusIcon } from "./icons.tsx";
import { ItemRow } from "./ItemRow.tsx";
import { folderNavId, moreNavId, showMoreStep, visibleItems } from "./list-view.ts";
import type { RowHandlers } from "./TaskRow.tsx";

interface FolderGroupProps {
  folder: SidebarFolder;
  open: boolean;
  /** 展开时先显示的行数上限（"显示更多"每次 +20）。 */
  limit: number;
  selectedTaskId: TaskId | null;
  tabStopId: string;
  renamingId: TaskId | null;
  rows: RowHandlers;
  onToggle(folder: SidebarFolder, open: boolean): void;
  onShowMore(folder: SidebarFolder): void;
  onNewTask(folder: SidebarFolder): void;
  onOpenProjectMenu(project: Project, x: number, y: number, trigger: HTMLElement): void;
}

export function FolderGroup(props: FolderGroupProps) {
  const { folder, open, rows } = props;
  const { t } = rows;
  const { project } = folder;
  const navId = folderNavId(folder);
  const hasWaiting = folder.items.some((item) => item.kind === "task" && item.task.status === "needs_you");
  const { shown, remaining } = visibleItems(folder.items, props.limit, props.selectedTaskId);
  const moreId = moreNavId(folder.key);

  return (
    <section className="sb-folder" aria-label={folder.label} data-testid="sidebar-folder">
      <div
        className="sb-group-head"
        onContextMenu={(event) => {
          if (project === null) return;
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
          data-collapsed={!open}
          tabIndex={props.tabStopId === navId ? 0 : -1}
          aria-expanded={open}
          aria-label={t("sidebar.toggleProject", { project: folder.label })}
          title={folder.cwd}
          onFocus={() => rows.onFocusItem(navId)}
          onClick={() => props.onToggle(folder, !open)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" && open) {
              event.preventDefault();
              props.onToggle(folder, false);
            } else if (event.key === "ArrowRight" && !open) {
              event.preventDefault();
              props.onToggle(folder, true);
            }
          }}
        >
          <span className="sb-chevron">
            <ChevronIcon />
          </span>
          <span className="sb-group-name">{folder.label}</span>
          {!open && (
            <span className="sb-group-count">
              {hasWaiting && <span className="sb-waiting-diamond" role="img" aria-label={t("sidebar.waitingHere")} />}
              {folder.items.length}
            </span>
          )}
        </button>
        <button
          type="button"
          className="sb-icon-btn sb-group-action sb-group-new"
          data-testid="sidebar-project-new"
          tabIndex={-1}
          aria-label={t("sidebar.newInProject")}
          title={t("sidebar.newInProject")}
          onClick={() => props.onNewTask(folder)}
        >
          <PlusIcon />
        </button>
        {project !== null && (
          <button
            type="button"
            className="sb-icon-btn sb-group-action sb-group-more"
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
        )}
      </div>
      <Reveal open={open}>
        <div className="sb-group-body">
          {folder.items.length === 0 && <p className="sb-group-empty">{t("sidebar.empty")}</p>}
          {shown.map((item) => (
            <ItemRow
              key={item.key}
              item={item}
              selectedTaskId={props.selectedTaskId}
              tabStopId={props.tabStopId}
              renamingId={props.renamingId}
              rows={rows}
            />
          ))}
          {remaining > 0 && (
            <button
              type="button"
              className="sb-show-more"
              data-nav={moreId}
              data-testid="sidebar-history-more"
              tabIndex={props.tabStopId === moreId ? 0 : -1}
              onFocus={() => rows.onFocusItem(moreId)}
              onClick={() => props.onShowMore(folder)}
            >
              {t("sidebar.showMore", { n: Math.min(remaining, showMoreStep) })}
            </button>
          )}
        </div>
      </Reveal>
    </section>
  );
}
