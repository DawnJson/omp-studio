// 侧栏（spec §3.2、第 4 章）：竖排三行（搜索 / 新任务 / 打开文件夹）、"等你确认"条、按项目分组的任务、底部是设置和（更新下载好后才有的）新版本标签。
// 从顶栏下面开始，不画标题栏；底色 --bg-sidebar 与顶栏连成一片。宽度由外层容器给。
import { reportError } from "../../ui/errors.ts";
import { publishVisibleTaskIds } from "./visible-order-store.ts";
import { onStudioCommand } from "../palette/studio-command.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectId, TaskId, TaskState } from "../../../../shared/ipc.ts";
import { setFolderOrder, setHistoryOrder, useShellValue } from "../../app/shell-store.ts";
import { useLocale, useT } from "../../i18n/use-t.ts";
import { shortcutLabel } from "../../app/platform-keys.ts";
import {
  selectTask,
  showView,
  useAppInfo,
  useDownloadedVersion,
  useMainView,
  useSelectedTaskId,
  useTasksState,
} from "../../store/index.ts";
import { Close } from "../../icons.tsx";
import { Button, IconButton, TextField } from "../../ui/controls.tsx";
import { OverlayScrollbar } from "../../ui/OverlayScrollbar.tsx";
import { useInstallUpdate } from "../settings/use-install-update.tsx";
import { archiveWithUndo, useHiddenTasks } from "./archive-store.ts";
import { FolderPlusIcon, GearIcon, PlusIcon, SearchIcon } from "./icons.tsx";
import { HistoryHead, HistorySection } from "./HistorySection.tsx";
import {
  defaultOpen,
  folderNavId,
  flatLimitKey,
  initialFlat,
  initialPerFolder,
  moreNavId,
  showMoreStep,
} from "./list-view.ts";
import { refreshProjects, useProjectsState } from "./projects-store.ts";
import { addProjectAsDraft, startDraftInFolder } from "./sidebar-actions.ts";
import { startDraft } from "../empty/index.ts";
import { isDefaultFolder } from "../empty/default-folder.ts";
import {
  adoptNewFolders,
  buildFolders,
  moveFolder,
  buildArchived,
  buildChats,
  nextWaitingTask,
  projectLabels,
  visibleItems,
  unreadSegments,
  waitingTasks,
  type SidebarFolder,
} from "../../../../shared/ui/sidebar-model.ts";
import type { RowHandlers } from "./TaskRow.tsx";
import { useHistorySessions, useHistorySessionsLoaded } from "./use-history-sessions.ts";
import { useSidebarMenus } from "./use-sidebar-menus.tsx";
import "./sidebar.css";

const noneCollapsed: ReadonlySet<string> = new Set();

export function Sidebar() {
  const t = useT();
  const locale = useLocale();
  const listRef = useRef<HTMLDivElement>(null);
  const view = useMainView();
  const selectedTaskId = useSelectedTaskId();
  const tasksState = useTasksState();
  const downloadedVersion = useDownloadedVersion();
  const installing = useInstallUpdate();
  const projectsState = useProjectsState();
  const hidden = useHiddenTasks();
  const chatsDir = useAppInfo()?.chatsDir ?? null;
  const defaultLabel = t("empty.defaultFolder");

  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({});
  const [limits, setLimits] = useState<Record<string, number>>({});
  // 收起了分叉的行（SidebarItem.key）：默认都展开；和文件夹的展开状态一样只在内存，重开应用回到全部展开。
  const [collapsedForks, setCollapsedForks] = useState<ReadonlySet<string>>(() => new Set());
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
  // 恢复历史会话会让主进程自动加入新项目、重新显示移出列表的项目：任务指向列表里没有的项目时重新取一次。
  const unknownProject = useMemo(
    () =>
      projectsState.loaded &&
      tasksState.list.some((task) => !projectsState.list.some((project) => project.id === task.projectId)),
    [projectsState, tasksState.list],
  );
  useEffect(() => {
    if (unknownProject) void refreshProjects();
  }, [unknownProject]);

  const order = useShellValue("historyOrder");
  const sessions = useHistorySessions(searching, historyKey);
  // "归档"不记进外壳状态：重开应用回到平常的列表。最后一条归档的恢复后自己回到平常的列表。
  const [showArchived, setShowArchived] = useState(false);
  const hasArchived = useMemo(() => sessions.some((session) => session.archived), [sessions]);
  const mode = showArchived && hasArchived ? "archived" : order;
  // 任务和会话合成一个列表（搜索同时过滤两者）。"项目"是除默认文件夹（chats 目录）以外的文件夹，
  // 顺序是用户拖出来的（ShellState.folderOrder），任务跑完不挪（spec §4.5）；默认文件夹里的在"对话"。
  const folderOrder = useShellValue("folderOrder");
  const shellLoaded = useShellValue("loaded");
  const sessionsLoaded = useHistorySessionsLoaded();
  const folders = useMemo(
    () =>
      buildFolders({
        projects: projectsState.list,
        tasks: tasksState.list,
        sessions,
        hidden,
        query,
        defaultCwd: chatsDir,
        folderOrder,
      }),
    [projectsState.list, tasksState.list, sessions, hidden, query, chatsDir, folderOrder],
  );
  // 新出现的文件夹（新开的项目、终端里新目录的会话）一出现就记进顺序的最前面，之后不再因为活动挪动。
  // 等项目、任务、历史会话、外壳状态都读回来再记：否则还没读到的目录会被当成新的，存盘的顺序也会被默认值盖掉。
  const ready = shellLoaded && projectsState.loaded && tasksState.loaded && sessionsLoaded && chatsDir !== null;
  useEffect(() => {
    if (!ready || searching) return;
    const next = adoptNewFolders(folderOrder, folders);
    if (next !== null) setFolderOrder(next);
  }, [ready, searching, folderOrder, folders]);
  const onMoveFolder = useCallback(
    (folder: SidebarFolder, to: number) => setFolderOrder(moveFolder(folderOrder, folders, folder.key, to)),
    [folderOrder, folders],
  );
  const chats = useMemo(
    () =>
      buildChats({
        projects: projectsState.list,
        tasks: tasksState.list,
        sessions,
        hidden,
        query,
        defaultCwd: chatsDir,
      }),
    [projectsState.list, tasksState.list, sessions, hidden, query, chatsDir],
  );
  const archived = useMemo(() => buildArchived({ sessions, query }), [sessions, query]);
  // 平铺的列表："对话"，或"归档"。
  const flat = mode === "archived" ? archived : chats;
  // 选中的任务换了、而它在另一段（比如在"项目"里点了新任务、在默认文件夹里发出第一条）：切到它所在的那一段，免得刚建的任务看不见。
  // 只在选中项变化时看一次，之后用户自己切走不拉回来。
  const selectedSegment = useMemo(() => {
    const task = tasksState.list.find((candidate) => candidate.id === selectedTaskId);
    const project = task && projectsState.list.find((candidate) => candidate.id === task.projectId);
    if (project === undefined || chatsDir === null) return null;
    return isDefaultFolder(project.path, chatsDir) ? "chats" : "folder";
  }, [tasksState.list, projectsState.list, selectedTaskId, chatsDir]);
  const followedTask = useRef<TaskState["id"] | null>(null);
  useEffect(() => {
    if (selectedSegment === null || followedTask.current === selectedTaskId) return;
    followedTask.current = selectedTaskId;
    setShowArchived(false);
    if (selectedSegment !== order) setHistoryOrder(selectedSegment);
  }, [selectedSegment, selectedTaskId, order]);
  const waiting = useMemo(
    () => waitingTasks(tasksState.list, projectsState.list, hidden),
    [projectsState.list, tasksState.list, hidden],
  );
  const unread = useMemo(
    () => unreadSegments(tasksState.list, projectsState.list, hidden, chatsDir),
    [projectsState.list, tasksState.list, hidden, chatsDir],
  );
  // 项目、对话、归档都没有东西（也不在搜索）：标题行和列表都不画；否则留着标题行，免得切不回别的分段。
  const listed = searching || folders.length > 0 || chats.length > 0 || hasArchived;
  const labelOf = (projectId: ProjectId) => {
    const project = projectsState.list.find((candidate) => candidate.id === projectId);
    if (project === undefined) return "";
    return isDefaultFolder(project.path, chatsDir)
      ? defaultLabel
      : (projectLabels(projectsState.list).get(projectId) ?? "");
  };

  // 搜索时忽略折叠，匹配的行都要看得见；否则用户点过的优先，没点过的看有没有选中/在跑/等你确认的任务。
  const isOpen = useCallback(
    (folder: SidebarFolder) => searching || (openOverride[folder.key] ?? defaultOpen(folder, selectedTaskId)),
    [searching, openOverride, selectedTaskId],
  );
  // 分叉的收起同理：搜索时全部展开。
  const foldedForks = searching ? noneCollapsed : collapsedForks;
  // 因为选中 / 在跑 / 等你确认而展开的文件夹记成"展开"：任务跑完、换了选中项都不再自己收起，只有用户点了才折叠。
  const autoOpened = useMemo(
    () =>
      folders
        .filter((folder) => openOverride[folder.key] === undefined && defaultOpen(folder, selectedTaskId))
        .map((folder) => folder.key)
        .join("\n"),
    [folders, openOverride, selectedTaskId],
  );
  useEffect(() => {
    if (autoOpened === "") return;
    setOpenOverride((current) => {
      const next = { ...current };
      for (const key of autoOpened.split("\n")) next[key] ??= true;
      return next;
    });
  }, [autoOpened]);

  const { menu, openTaskMenu, openSessionMenu, openProjectMenu } = useSidebarMenus({
    t,
    selectedTaskId,
    onRename: (task) => setRenamingId(task.id),
  });

  // 行的回调：一份稳定的对象（只在语言变了时换新），回调里读最新的选中任务和菜单，任务行的 memo 才有用。
  const latest = useRef({ selectedTaskId, openTaskMenu, openSessionMenu });
  latest.current = { selectedTaskId, openTaskMenu, openSessionMenu };
  const rows = useMemo<RowHandlers>(
    () => ({
      t,
      locale,
      onSelect: (task, viaKeyboard) =>
        void selectTask(task.id)
          .then(() => {
            // 键盘 Enter 选中才进输入框；方向键浏览时焦点留在侧栏。
            if (viaKeyboard) document.querySelector<HTMLElement>("[data-composer-input]")?.focus();
          })
          .catch((error: unknown) => reportError(t, error)),
      onFocusItem: setTabStop,
      onToggleForks: (key) =>
        setCollapsedForks((current) => {
          const next = new Set(current);
          if (!next.delete(key)) next.add(key);
          return next;
        }),
      onOpenMenu: (task, x, y, trigger) => latest.current.openTaskMenu(task, x, y, trigger),
      onOpenSessionMenu: (session, x, y, trigger) => latest.current.openSessionMenu(session, x, y, trigger),
      onStartRename: (task) => setRenamingId(task.id),
      onCommitRename: (task, title) => {
        setRenamingId(null);
        const next = title?.trim() ?? "";
        if (next !== "" && next !== task.title)
          void window.studio.renameTask(task.id, next).catch((error: unknown) => reportError(t, error));
      },
      onArchive: (task) => archiveWithUndo(task.id, latest.current.selectedTaskId, t),
    }),
    [t, locale],
  );

  // roving tabindex：整个列表一个停靠点，记住的那个已不存在时回到选中的任务，再不行是第一项。
  const navIds = useMemo(() => {
    if (mode !== "folder") {
      const { shown, remaining } = visibleItems(
        flat,
        searching ? Infinity : (limits[flatLimitKey] ?? initialFlat),
        selectedTaskId,
        foldedForks,
      );
      return [...shown.map((item) => item.key), ...(remaining > 0 ? [moreNavId(flatLimitKey)] : [])];
    }
    return folders.flatMap((folder) => {
      if (!isOpen(folder)) return [folderNavId(folder)];
      const { shown, remaining } = visibleItems(
        folder.items,
        searching ? Infinity : (limits[folder.key] ?? initialPerFolder),
        selectedTaskId,
        foldedForks,
      );
      return [folderNavId(folder), ...shown.map((item) => item.key), ...(remaining > 0 ? [moreNavId(folder.key)] : [])];
    });
  }, [mode, flat, folders, searching, limits, isOpen, selectedTaskId, foldedForks]);
  const selectedNav = selectedTaskId === null ? "" : `task:${selectedTaskId}`;
  const tabStopId = navIds.includes(tabStop) ? tabStop : navIds.includes(selectedNav) ? selectedNav : (navIds[0] ?? "");
  const visibleTaskKey = useMemo(
    () =>
      navIds
        .filter((id) => id.startsWith("task:"))
        .map((id) => id.slice("task:".length))
        .join("\n"),
    [navIds],
  );
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
        <TextField
          size="sm"
          width="100%"
          role="searchbox"
          testId="sidebar-search"
          value={query}
          placeholder={t("sidebar.search")}
          aria-label={t("sidebar.search")}
          leading={<SearchIcon />}
          trailing={
            query !== "" ? (
              <IconButton className="sb-search-clear" label={t("sidebar.clearSearch")} onClick={() => setQuery("")}>
                <Close size={12} />
              </IconButton>
            ) : (
              <span className="ui-affix" aria-hidden="true">
                {shortcutLabel("Ctrl F")}
              </span>
            )
          }
          onChange={setQuery}
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

        <button
          type="button"
          className="sb-new"
          data-testid="sidebar-new-task"
          // 草稿页（没选任务的对话区）就是"新任务"：和任务行的选中一样用 aria-current 标出来。
          aria-current={view === "conversation" && selectedTaskId === null ? "page" : undefined}
          onClick={() => startDraft(null)}
        >
          <PlusIcon />
          <span className="sb-new-label">{t("sidebar.newTask")}</span>
          <span className="sb-new-hint" aria-hidden="true">
            {shortcutLabel("Ctrl N")}
          </span>
        </button>

        <button
          type="button"
          className="sb-new"
          data-testid="sidebar-open-folder"
          onClick={() => void addProjectAsDraft(t)}
        >
          <FolderPlusIcon />
          <span className="sb-new-label">{t("sidebar.openFolder")}</span>
          <span className="sb-new-hint" aria-hidden="true">
            {shortcutLabel("Ctrl Shift O")}
          </span>
        </button>
      </div>

      {/* 只有一个在等时带上项目名；项目找不到（名字为空）时不写空的"· "（2026-10-29：原来是"1 个任务在等你 ·"） */}
      {firstWaiting !== null && (
        <button
          type="button"
          className="sb-waiting"
          data-testid="waiting-strip"
          onClick={() => void selectTask(firstWaiting.id).catch((error: unknown) => reportError(t, error))}
        >
          <span className="sb-waiting-diamond" aria-hidden="true" />
          <span className="sb-waiting-text">
            {waiting.length !== 1
              ? t("sidebar.waitingMany", { n: waiting.length })
              : labelOf(firstWaiting.projectId) === ""
                ? t("sidebar.waitingOneBare")
                : t("sidebar.waitingOne", { project: labelOf(firstWaiting.projectId) })}
          </span>
        </button>
      )}

      {listed && (
        <HistoryHead
          mode={mode}
          hasArchived={hasArchived}
          unread={unread}
          t={t}
          onModeChange={(next) => {
            setShowArchived(next === "archived");
            if (next !== "archived") setHistoryOrder(next);
          }}
        />
      )}
      <div className="sb-list-host">
        <div className="sb-list" ref={listRef} onKeyDown={onListKeyDown}>
          {tasksState.error !== null && (
            <p className="sb-note sb-note-error">{t("sidebar.loadFailed", { message: tasksState.error })}</p>
          )}
          {projectsState.error !== null && (
            <div className="sb-no-projects">
              <p className="sb-note sb-note-error">{t("sidebar.projectsFailed", { message: projectsState.error })}</p>
              <Button size="sm" onClick={() => void refreshProjects()}>
                {t("common.retry")}
              </Button>
            </div>
          )}
          {listed && (
            <HistorySection
              mode={mode}
              folders={folders}
              flat={flat}
              searching={searching}
              isOpen={isOpen}
              limits={limits}
              collapsedForks={foldedForks}
              selectedTaskId={selectedTaskId}
              tabStopId={tabStopId}
              renamingId={renamingId}
              rows={rows}
              onToggle={(folder, open) => setOpenOverride((current) => ({ ...current, [folder.key]: open }))}
              onShowMore={(key) =>
                setLimits((current) => ({
                  ...current,
                  [key]: (current[key] ?? (key === flatLimitKey ? initialFlat : initialPerFolder)) + showMoreStep,
                }))
              }
              onNewTask={(folder) => void startDraftInFolder(folder, t)}
              onOpenProjectMenu={openProjectMenu}
              onMoveFolder={onMoveFolder}
            />
          )}
          {searching && (mode === "folder" ? folders.length === 0 : flat.length === 0) && (
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
          aria-pressed={view === "settings"}
          // 再点一次退出设置，回到进入前的对话（同设置页里的 Esc）。
          onClick={() => showView(view === "settings" ? "conversation" : "settings")}
        >
          <GearIcon />
          <span>{t("sidebar.settings")}</span>
        </button>
        {downloadedVersion !== null && (
          <button
            type="button"
            className="sb-update"
            title={t("sidebar.updateTip")}
            disabled={installing.busy}
            onClick={installing.requestInstall}
            data-testid="sidebar-update"
          >
            <span className="sb-update-dot" aria-hidden="true" />
            <span className="sb-update-text">{t("sidebar.update", { version: downloadedVersion })}</span>
          </button>
        )}
      </div>
      {installing.dialog}
      {menu}
    </nav>
  );
}
