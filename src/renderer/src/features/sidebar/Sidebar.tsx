// 侧栏（spec §3.2、第 4 章）：竖排三行（新任务 / 搜索 / 打开文件夹）、"等你确认"条、按项目分组的任务、底部设置和语言/主题切换。
// 从顶栏下面开始，不画标题栏；底色 --bg-sidebar 与顶栏连成一片。宽度由外层容器给。
import { reportError } from "../../ui/errors.ts";
import { publishVisibleTaskIds } from "./visible-order-store.ts";
import { onStudioCommand } from "../palette/studio-command.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectId, TaskId, TaskState } from "../../../../shared/ipc.ts";
import { useShellUi } from "../../app/shell-store.ts";
import { useLocale, useT } from "../../i18n/use-t.ts";
import { selectTask, showView, useAppInfo, useMainView, useSelectedTaskId, useTasksState } from "../../store/index.ts";
import { Close } from "../../icons.tsx";
import { OverlayScrollbar } from "../../ui/OverlayScrollbar.tsx";
import { archiveWithUndo, useHiddenTasks } from "./archive-store.ts";
import { FolderPlusIcon, GearIcon, PlusIcon, SearchIcon } from "./icons.tsx";
import { HistorySection } from "./HistorySection.tsx";
import {
  defaultOpen,
  folderNavId,
  initialByTime,
  initialPerFolder,
  moreNavId,
  showMoreStep,
  timeLimitKey,
  visibleItems,
} from "./list-view.ts";
import { PreferenceMenus } from "./PreferenceMenus.tsx";
import { refreshProjects, useProjectsState } from "./projects-store.ts";
import { addProjectAsDraft, startDraftInFolder } from "./sidebar-actions.ts";
import { startDraft } from "../empty/index.ts";
import { isDefaultFolder } from "../empty/default-folder.ts";
import {
  buildFolders,
  buildTimeline,
  nextWaitingTask,
  projectLabels,
  waitingTasks,
  type SidebarFolder,
} from "../../../../shared/ui/sidebar-model.ts";
import type { RowHandlers } from "./TaskRow.tsx";
import { useNow } from "./task-time.ts";
import { useHistorySessions } from "./use-history-sessions.ts";
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
  const chatsDir = useAppInfo()?.chatsDir ?? null;
  const defaultLabel = t("empty.defaultFolder");

  const shellUi = useShellUi();
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({});
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [tabStop, setTabStop] = useState("");
  const [renamingId, setRenamingId] = useState<TaskState["id"] | null>(null);
  // 斜杠命令 /rename（不带新名字）：当前任务的行进入就地改名；侧栏收起时 App 同时把它展开。
  useEffect(
    () =>
      onStudioCommand((command) => {
        if (command === "rename" && selectedTaskId !== null) setRenamingId(selectedTaskId);
      }),
    [selectedTaskId],
  );
  const [query, setQuery] = useState("");
  const searching = query.trim() !== "";
  // 任务列表变了（新建、恢复、第一轮结束后会话挂上任务）就重取历史会话，挂上任务的会话从历史里消失。
  const historyKey = useMemo(
    () => tasksState.list.map((task) => `${task.id}:${task.lastTurn === null ? 0 : 1}`).join(","),
    [tasksState.list],
  );

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

  const order = shellUi.historyOrder;
  const sessions = useHistorySessions(searching, historyKey);
  // 任务和会话合成一个列表（搜索同时过滤两者）；默认文件夹（chats 目录）叫"默认文件夹"，不露出目录名。
  const folders = useMemo(
    () =>
      buildFolders({
        projects: projectsState.list,
        tasks: tasksState.list,
        sessions,
        hidden,
        query,
        defaultCwd: chatsDir,
      }).map((folder) => (isDefaultFolder(folder.cwd, chatsDir) ? { ...folder, label: defaultLabel } : folder)),
    [projectsState.list, tasksState.list, sessions, hidden, query, chatsDir, defaultLabel],
  );
  const timeline = useMemo(
    () =>
      order === "time"
        ? buildTimeline({ projects: projectsState.list, tasks: tasksState.list, sessions, hidden, query })
        : [],
    [order, projectsState.list, tasksState.list, sessions, hidden, query],
  );
  const waiting = useMemo(() => waitingTasks(tasksState.list, hidden), [tasksState.list, hidden]);
  const labelOf = (projectId: ProjectId) => {
    const project = projectsState.list.find((candidate) => candidate.id === projectId);
    if (project === undefined) return "";
    return isDefaultFolder(project.path, chatsDir)
      ? defaultLabel
      : (projectLabels(projectsState.list).get(projectId) ?? "");
  };

  // 搜索时忽略折叠，匹配的行都要看得见；否则用户点过的优先，没点过的看有没有选中/在跑/等你确认的任务。
  const isOpen = (folder: SidebarFolder) =>
    searching || (openOverride[folder.key] ?? defaultOpen(folder, selectedTaskId));

  const { menu, openTaskMenu, openProjectMenu } = useSidebarMenus({
    t,
    selectedTaskId,
    taskCount: (project) =>
      tasksState.list.filter((task) => task.projectId === project.id && !hidden.has(task.id)).length,
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
  const navIds =
    order === "time"
      ? (() => {
          const { shown, remaining } = visibleItems(
            timeline,
            searching ? Infinity : (limits[timeLimitKey] ?? initialByTime),
            selectedTaskId,
          );
          return [...shown.map((item) => item.key), ...(remaining > 0 ? [moreNavId(timeLimitKey)] : [])];
        })()
      : folders.flatMap((folder) => {
          if (!isOpen(folder)) return [folderNavId(folder)];
          const { shown, remaining } = visibleItems(
            folder.items,
            searching ? Infinity : (limits[folder.key] ?? initialPerFolder),
            selectedTaskId,
          );
          return [
            folderNavId(folder),
            ...shown.map((item) => item.key),
            ...(remaining > 0 ? [moreNavId(folder.key)] : []),
          ];
        });
  const selectedNav = selectedTaskId === null ? "" : `task:${selectedTaskId}`;
  const tabStopId = navIds.includes(tabStop) ? tabStop : navIds.includes(selectedNav) ? selectedNav : (navIds[0] ?? "");
  const visibleTaskKey = navIds
    .filter((id) => id.startsWith("task:"))
    .map((id) => id.slice("task:".length))
    .join("\n");
  useEffect(() => {
    publishVisibleTaskIds(visibleTaskKey === "" ? [] : (visibleTaskKey.split("\n") as TaskId[]));
  }, [visibleTaskKey]);

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
      <div className="sb-actions">
        <div className="sb-search">
          <SearchIcon />
          <input
            type="text"
            role="searchbox"
            data-testid="sidebar-search"
            value={query}
            placeholder={t("sidebar.search")}
            aria-label={t("sidebar.search")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape" && query !== "") {
                event.preventDefault();
                event.stopPropagation();
                setQuery("");
              } else if (event.key === "ArrowDown") {
                // 从搜索框直接进结果列表。
                const first = listRef.current?.querySelector<HTMLElement>("[data-nav]");
                if (first) {
                  event.preventDefault();
                  first.focus();
                }
              }
            }}
          />
          {query !== "" ? (
            <button
              type="button"
              className="sb-search-clear"
              aria-label={t("sidebar.clearSearch")}
              onClick={() => setQuery("")}
            >
              <Close size={12} />
            </button>
          ) : (
            <span className="sb-new-hint" aria-hidden="true">
              Ctrl F
            </span>
          )}
        </div>

        <button
          type="button"
          className="sb-new"
          data-testid="sidebar-new-task"
          // 草稿页（没选任务的对话区）就是"新任务"：和任务行的选中一样用 aria-current 标出来。
          aria-current={view === "conversation" && selectedTaskId === null ? "page" : undefined}
          title={`${t("sidebar.newTask")} (Ctrl N)`}
          onClick={() => startDraft(null)}
        >
          <PlusIcon />
          <span className="sb-new-label">{t("sidebar.newTask")}</span>
          <span className="sb-new-hint" aria-hidden="true">
            Ctrl N
          </span>
        </button>

        <button
          type="button"
          className="sb-new"
          data-testid="sidebar-open-folder"
          title={`${t("sidebar.openFolder")} (Ctrl Shift O)`}
          onClick={() => void addProjectAsDraft(t)}
        >
          <FolderPlusIcon />
          <span className="sb-new-label">{t("sidebar.openFolder")}</span>
          <span className="sb-new-hint" aria-hidden="true">
            Ctrl Shift O
          </span>
        </button>
      </div>

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
          <HistorySection
            folders={folders}
            timeline={timeline}
            searching={searching}
            isOpen={isOpen}
            limits={limits}
            selectedTaskId={selectedTaskId}
            tabStopId={tabStopId}
            renamingId={renamingId}
            rows={rows}
            onToggle={(folder, open) => setOpenOverride((current) => ({ ...current, [folder.key]: open }))}
            onShowMore={(key) =>
              setLimits((current) => ({
                ...current,
                [key]: (current[key] ?? (key === timeLimitKey ? initialByTime : initialPerFolder)) + showMoreStep,
              }))
            }
            onNewTask={(folder) => void startDraftInFolder(folder, t)}
            onOpenProjectMenu={openProjectMenu}
          />
          {searching && folders.length === 0 && timeline.length === 0 && (
            <p className="sb-note" role="status">
              {t("sidebar.searchNone")}
            </p>
          )}
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
        <PreferenceMenus />
      </div>
      {menu}
    </nav>
  );
}
