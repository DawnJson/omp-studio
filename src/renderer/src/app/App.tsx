// 应用布局（spec §3.1–3.3）：36px 通栏任务条 + 侧栏 + 四角圆的主区“纸面”；窄窗口侧栏变抽屉。
// 各功能入口的导出名和 props 是约定（props 只有 id，数据从 store hook 取）。
import { reportError } from "../ui/errors.ts";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { groupTasks, visibleOrder } from "../../../shared/ui/sidebar-model.ts";
import { Composer } from "../features/composer/index.ts";
import { ConversationView } from "../features/conversation/index.ts";
import { GitBar, GitDialogHost } from "../features/git/index.ts";
import { DialogLayer } from "../features/dialogs/index.ts";
import { DropOverlay, EmptyState, startDraft } from "../features/empty/index.ts";
import { OmpSetupView } from "../features/omp-setup/index.ts";
import { ReviewHost } from "../features/review/index.ts";
import { CommandPalette } from "../features/palette/index.ts";
import { SettingsView } from "../features/settings/index.ts";
import { onStudioCommand } from "../features/palette/studio-command.ts";
import { useHiddenTasks } from "../features/sidebar/archive-store.ts";
import { jumpToWaitingTask, Sidebar, useProjects } from "../features/sidebar/index.ts";
import { useLocale, useT } from "../i18n/use-t.ts";
import { openReview } from "../store/review-store.ts";
import {
  selectTask,
  setPaletteOpen,
  showView,
  useAppInfo,
  useMainView,
  usePaletteOpen,
  useSelectedTaskId,
  useSettings,
  useTasks,
} from "../store/index.ts";
import { AboutDialog } from "./AboutDialog.tsx";
import { AppMenu } from "./AppMenu.tsx";
import { setDrawerOpen, setSidebarCollapsed, useShellUi } from "./shell-store.ts";
import { SidebarResizer } from "./SidebarResizer.tsx";
import { TopBar } from "./TopBar.tsx";
import { useNavigation } from "./use-navigation.ts";
import { useShortcuts } from "./use-shortcuts.ts";

/** 帮助与反馈的落点：本仓库的 Issues（选模板页）。内测期间仓库私有，内测用户需要先被加为协作者才能打开。 */
const helpUrl = "https://github.com/DawnJson/omp-studio/issues/new/choose";

/** spec §3.3：窄于 1000px 侧栏改成覆盖式抽屉。 */
const narrowQuery = "(max-width: 999px)";

function useNarrow(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia(narrowQuery);
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    },
    () => window.matchMedia(narrowQuery).matches,
  );
}

const composerSelector = "[data-composer-input]";

function focusComposer(scrollToEnd: boolean): void {
  const field = document.querySelector<HTMLTextAreaElement>(composerSelector);
  field?.focus({ preventScroll: true });
  // 光标放在草稿末尾。
  field?.setSelectionRange(field.value.length, field.value.length);
  const log = document.querySelector<HTMLElement>('[role="log"]');
  if (scrollToEnd && log) log.scrollTop = log.scrollHeight;
}

/** F6 的三个区域：侧栏（当前的一个 Tab 停靠点，没有就取第一个按钮）→ 对话区 → 输入框。 */
function focusRegion(delta: 1 | -1): void {
  const regions = [
    document.querySelector<HTMLElement>('nav.sb [tabindex="0"], nav.sb button'),
    document.querySelector<HTMLElement>('[role="log"]'),
    document.querySelector<HTMLElement>(composerSelector),
  ].filter((element): element is HTMLElement => element !== null && element.getClientRects().length > 0);
  if (regions.length === 0) return;
  const at = regions.findIndex((region) => region.contains(document.activeElement));
  regions[(at + delta + regions.length) % regions.length]?.focus();
}

export function App() {
  const t = useT();
  const locale = useLocale();
  const appInfo = useAppInfo();
  const settings = useSettings();
  const taskId = useSelectedTaskId();
  const view = useMainView();
  const paletteOpen = usePaletteOpen();
  const shell = useShellUi();
  const narrow = useNarrow();
  const navigation = useNavigation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  const theme = settings?.theme ?? "system";
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset["theme"];
    else root.dataset["theme"] = theme;
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const sidebarShown = narrow ? shell.drawerOpen : !shell.sidebarCollapsed;
  const asDrawer = narrow;

  // 选了任务或变宽之后，抽屉自动收起。
  useEffect(() => setDrawerOpen(false), [taskId, narrow]);

  const projects = useProjects();
  const tasks = useTasks();
  const hidden = useHiddenTasks();
  const order = useMemo(() => visibleOrder(groupTasks(projects, tasks, hidden)), [projects, tasks, hidden]);
  const openTask = (id: (typeof order)[number]["id"] | undefined) => {
    if (id !== undefined) selectTask(id).catch((error: unknown) => reportError(t, error));
  };

  // spec §5.3：启动、切换任务后焦点进输入框；正在别的输入控件（命令面板等）里时不抢。
  // 这是选中任务后聚焦输入框的唯一一处（Composer 自己不再聚焦）；同步在提交后执行，不用 rAF，所以点任务后焦点位置是确定的。
  useEffect(() => {
    if (view !== "conversation") return;
    const active = document.activeElement;
    const typing =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLElement && active.isContentEditable);
    // 焦点在侧栏里（键盘移动、点了任务行）时不抢：spec 5.3 侧栏里 ↑↓ 留在侧栏。
    const inSidebar = active instanceof HTMLElement && active.closest("[data-testid=sidebar]") !== null;
    if (inSidebar) return;
    if (!typing || active.matches(composerSelector)) focusComposer(false);
  }, [taskId, view]);

  const paletteOpenRef = useRef(paletteOpen);
  paletteOpenRef.current = paletteOpen;

  // 新任务 = 草稿（空状态里的输入框）；发出第一条消息时才创建任务。
  const newTask = () => startDraft();
  const toggleSidebar = () => {
    if (narrow) setDrawerOpen(!shell.drawerOpen);
    else setSidebarCollapsed(!shell.sidebarCollapsed);
  };

  // 命令面板的"切换侧栏"以事件发来；用 ref 取最新的 toggleSidebar。
  const toggleSidebarRef = useRef(toggleSidebar);
  toggleSidebarRef.current = toggleSidebar;
  useEffect(() => onStudioCommand((command) => command === "toggleSidebar" && toggleSidebarRef.current()), []);
  const reportErrorRef = useRef((error: unknown) => reportError(t, error));
  reportErrorRef.current = (error: unknown) => reportError(t, error);
  // 点系统通知：主进程聚焦窗口并发 focusTask，切到对应任务。
  useEffect(
    () => window.studio.onFocusTask((id) => selectTask(id).catch((error: unknown) => reportErrorRef.current(error))),
    [],
  );

  useShortcuts({
    newTask,
    newTaskInCurrentProject: () => startDraft(tasks.find((task) => task.id === taskId)?.projectId ?? null),
    jumpToWaiting: () => void jumpToWaitingTask(taskId, t),
    focusComposer: () => focusComposer(true),
    nthTask: (n) => openTask(order[n - 1]?.id),
    cycleTask: (delta) => {
      if (order.length === 0) return;
      const at = order.findIndex((task) => task.id === taskId);
      openTask(
        order[at === -1 ? (delta === 1 ? 0 : order.length - 1) : (at + delta + order.length) % order.length]?.id,
      );
    },
    cycleRegion: focusRegion,
    togglePalette: () => setPaletteOpen(!paletteOpenRef.current),
    openSettings: () => showView("settings"),
    toggleSidebar,
    goBack: navigation.goBack,
    goForward: navigation.goForward,
    toggleMenu: () => setMenuOpen((open) => !open),
    openReview: () => {
      if (taskId !== null && view === "conversation") openReview(taskId);
    },
    closeDrawer: () => {
      if (!narrow || !shell.drawerOpen) return false;
      setDrawerOpen(false);
      return true;
    },
  });

  return (
    <div
      id="app"
      data-testid="app-root"
      data-locale={appInfo?.locale}
      data-sidebar={sidebarShown ? "shown" : "hidden"}
      data-drawer={asDrawer}
    >
      <TopBar menuOpen={menuOpen} onToggleMenu={() => setMenuOpen((open) => !open)} />
      <div className="body">
        {asDrawer && shell.drawerOpen && (
          <div className="drawer-scrim" data-testid="drawer-scrim" onPointerDown={() => setDrawerOpen(false)} />
        )}
        <div
          className="sidebar-column"
          data-testid="sidebar-column"
          inert={!sidebarShown}
          style={{ "--sidebar-current": `${shell.sidebarWidth}px` } as CSSProperties}
        >
          <Sidebar />
        </div>
        <main className="panel" data-testid="main-panel">
          {!asDrawer && sidebarShown && <SidebarResizer width={shell.sidebarWidth} />}
          {view === "settings" ? (
            <SettingsView />
          ) : taskId === null ? (
            <EmptyState />
          ) : (
            <>
              <GitBar taskId={taskId} />
              <ConversationView taskId={taskId} />
              <Composer taskId={taskId} />
            </>
          )}
        </main>
      </div>
      {menuOpen && (
        <AppMenu
          onClose={() => setMenuOpen(false)}
          actions={{
            newTask,
            toggleSidebar,
            openPalette: () => setPaletteOpen(true),
            openSettings: () => showView("settings"),
            openHelp: () => void window.studio.openExternal(helpUrl),
            openAbout: () => setAboutOpen(true),
            quit: () => void window.studio.quitApp(),
          }}
        />
      )}
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      <DropOverlay />
      <ReviewHost />
      <GitDialogHost />
      <DialogLayer taskId={taskId} />
      <CommandPalette />
      <OmpSetupView />
    </div>
  );
}
