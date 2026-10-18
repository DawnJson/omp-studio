// 侧栏（spec §3.2、第 4 章）：新任务、"等你确认"条、按项目分组的任务、底部设置和命令面板入口。
// 从顶栏下面开始，不画标题栏；底色 --bg-sidebar 与顶栏连成一片。宽度由外层容器给。
import { reportError } from "../../ui/errors.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Project, ProjectId, TaskState } from "../../../../shared/ipc.ts";
import { setCollapsedProjects, useShellUi } from "../../app/shell-store.ts";
import { useLocale, useT } from "../../i18n/use-t.ts";
import {
  selectTask,
  setPaletteOpen,
  showView,
  useMainView,
  useSelectedTaskId,
  useTasksState,
} from "../../store/index.ts";
import { OverlayScrollbar } from "../../ui/OverlayScrollbar.tsx";
import { archiveWithUndo, useHiddenTasks } from "./archive-store.ts";
import { FolderPlusIcon, GearIcon, PlusIcon, SearchIcon } from "./icons.tsx";
import { initialVisibleTasks, ProjectGroup, projectNavId, showMoreStep, type RowHandlers } from "./ProjectGroup.tsx";
import { refreshProjects, useProjectsState } from "./projects-store.ts";
import { addProjectAsDraft } from "./sidebar-actions.ts";
import { startDraft } from "../empty/index.ts";
import { groupTasks, nextWaitingTask, waitingTasks } from "../../../../shared/ui/sidebar-model.ts";
import { taskNavId } from "./TaskRow.tsx";
import { useNow } from "./task-time.ts";
import { useSidebarMenus } from "./use-sidebar-menus.tsx";
import "./sidebar.css";

export function Sidebar() {
  const t = useT();
  const locale = useLocale();
  const listRef = useRef<HTMLDivElement>(null);
  const now = useNow();
  const view = useMainView();
  const selectedTaskId = useSelectedTaskId();
  const tasksState = useTasksState();
  const projectsState = useProjectsState();
  const hidden = useHiddenTasks();

  const shellUi = useShellUi();
  const collapsed = useMemo(() => new Set<string>(shellUi.collapsedProjects), [shellUi.collapsedProjects]);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [tabStop, setTabStop] = useState("");
  const [renamingId, setRenamingId] = useState<TaskState["id"] | null>(null);

  useEffect(() => {
    void refreshProjects();
    // 拖入文件夹时主进程已经把它加入项目。
    return window.studio.onProjectDropped(() => void refreshProjects());
  }, []);
  // 恢复历史会话会让主进程自动加入新项目：任务指向列表里没有的项目时重新取一次。
  const unknownProject = useMemo(
    () =>
      projectsState.loaded &&
      tasksState.list.some((task) => !projectsState.list.some((project) => project.id === task.projectId)),
    [projectsState, tasksState.list],
  );
  useEffect(() => {
    if (unknownProject) void refreshProjects();
  }, [unknownProject]);

  const groups = useMemo(
    () => groupTasks(projectsState.list, tasksState.list, hidden),
    [projectsState.list, tasksState.list, hidden],
  );
  const waiting = useMemo(() => waitingTasks(tasksState.list, hidden), [tasksState.list, hidden]);
  const labelOf = (projectId: ProjectId) => groups.find((group) => group.project.id === projectId)?.label ?? "";

  const toggleProject = (project: Project, collapse: boolean) => {
    const next = new Set(collapsed);
    if (collapse) next.add(project.id);
    else next.delete(project.id);
    setCollapsedProjects([...next]);
  };

  const { menu, openTaskMenu, openProjectMenu } = useSidebarMenus({
    t,
    selectedTaskId,
    taskCount: (project) => groups.find((group) => group.project.id === project.id)?.tasks.length ?? 0,
    onRename: (task) => setRenamingId(task.id),
  });

  const rows: RowHandlers = {
    t,
    locale,
    now,
    onSelect: (task, viaKeyboard) =>
      void selectTask(task.id)
        .then(() => {
          // 键盘 Enter 选中才进输入框；方向键浏览时焦点留在侧栏。
          if (viaKeyboard) document.querySelector<HTMLElement>("[data-composer-input]")?.focus();
        })
        .catch((error: unknown) => reportError(t, error)),
    onFocusItem: setTabStop,
    onOpenMenu: openTaskMenu,
    onStartRename: (task) => setRenamingId(task.id),
    onCommitRename: (task, title) => {
      setRenamingId(null);
      const next = title?.trim() ?? "";
      if (next !== "" && next !== task.title)
        void window.studio.renameTask(task.id, next).catch((error: unknown) => reportError(t, error));
    },
    onArchive: (task) => archiveWithUndo(task.id, selectedTaskId, t),
  };

  // roving tabindex：整个列表一个停靠点，记住的那个已不存在时回到选中的任务，再不行是第一项。
  const navIds = groups.flatMap((group) => [
    projectNavId(group.project),
    ...(collapsed.has(group.project.id) ? [] : group.tasks.map(taskNavId)),
  ]);
  const selectedNav = selectedTaskId === null ? "" : `task:${selectedTaskId}`;
  const tabStopId = navIds.includes(tabStop) ? tabStop : navIds.includes(selectedNav) ? selectedNav : (navIds[0] ?? "");

  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-nav]")];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at === -1) return;
    event.preventDefault();
    const to =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : Math.min(items.length - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)));
    items[to]?.focus();
  };

  const firstWaiting = nextWaitingTask(waiting, selectedTaskId);

  return (
    <nav className="sb" aria-label={t("sidebar.label")} data-testid="sidebar">
      <button type="button" className="sb-new" onClick={() => startDraft(null)}>
        <PlusIcon />
        <span className="sb-new-label">{t("sidebar.newTask")}</span>
        <kbd className="kbd">Ctrl N</kbd>
      </button>

      {firstWaiting !== null && (
        <button
          type="button"
          className="sb-waiting"
          data-testid="waiting-strip"
          onClick={() => void selectTask(firstWaiting.id).catch((error: unknown) => reportError(t, error))}
        >
          <span className="sb-waiting-diamond" aria-hidden="true" />
          <span className="sb-waiting-text">
            {waiting.length === 1
              ? t("sidebar.waitingOne", { project: labelOf(firstWaiting.projectId) })
              : t("sidebar.waitingMany", { n: waiting.length })}
          </span>
        </button>
      )}

      <div className="sb-list-host">
        <div className="sb-list" ref={listRef} onKeyDown={onListKeyDown}>
          {!tasksState.loaded && tasksState.error === null && (
            <p className="sb-note" role="status">
              {t("sidebar.loading")}
            </p>
          )}
          {tasksState.error !== null && (
            <p className="sb-note sb-note-error">{t("sidebar.loadFailed", { message: tasksState.error })}</p>
          )}
          {projectsState.error !== null && (
            <div className="sb-no-projects">
              <p className="sb-note sb-note-error">{t("sidebar.projectsFailed", { message: projectsState.error })}</p>
              <button type="button" className="sb-secondary" onClick={() => void refreshProjects()}>
                {t("common.retry")}
              </button>
            </div>
          )}
          {projectsState.loaded && projectsState.list.length === 0 && (
            <div className="sb-no-projects">
              <button type="button" className="sb-secondary" onClick={() => void addProjectAsDraft(t)}>
                <FolderPlusIcon />
                {t("sidebar.addProject")}
              </button>
            </div>
          )}
          {groups.map((group) => (
            <ProjectGroup
              key={group.project.id}
              group={group}
              collapsed={collapsed.has(group.project.id)}
              limit={limits[group.project.id] ?? initialVisibleTasks}
              selectedTaskId={selectedTaskId}
              tabStopId={tabStopId}
              renamingId={renamingId}
              rows={rows}
              onToggle={toggleProject}
              onShowMore={(project) =>
                setLimits((current) => ({
                  ...current,
                  [project.id]: (current[project.id] ?? initialVisibleTasks) + showMoreStep,
                }))
              }
              onNewTask={(project) => startDraft(project.id)}
              onOpenProjectMenu={openProjectMenu}
            />
          ))}
        </div>
        <OverlayScrollbar target={listRef} />
      </div>

      <div className="sb-bottom">
        <button
          type="button"
          className="sb-settings"
          data-active={view === "settings"}
          onClick={() => showView("settings")}
        >
          <GearIcon />
          <span>{t("sidebar.settings")}</span>
        </button>
        <button
          type="button"
          className="sb-icon-btn"
          aria-label={t("sidebar.palette")}
          title={`${t("sidebar.palette")} (Ctrl K)`}
          onClick={() => setPaletteOpen(true)}
        >
          <SearchIcon />
        </button>
        <button
          type="button"
          className="sb-icon-btn"
          aria-label={t("sidebar.addProject")}
          title={t("sidebar.addProject")}
          onClick={() => void addProjectAsDraft(t)}
        >
          <FolderPlusIcon />
        </button>
      </div>
      {menu}
    </nav>
  );
}
