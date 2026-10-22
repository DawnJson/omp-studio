// 应用布局（spec §3.1–3.3）：40px 通栏任务条 + 侧栏 + 四角圆的主区“纸面”；窄窗口侧栏变抽屉。
// 各功能入口的导出名和 props 是约定（props 只有 id，数据从 store hook 取）。
import { reportError } from "../ui/errors.ts";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { TaskId } from "../../../shared/ipc.ts";
import { useVisibleTaskIds } from "../features/sidebar/visible-order-store.ts";
import { Composer } from "../features/composer/index.ts";
import { BtwPanel } from "../features/btw/index.ts";
import { SessionTreePanel } from "../features/conversation/index.ts";
import { TspView } from "../features/tsp/index.ts";
import { GitDialogHost } from "../features/git/index.ts";
import { SessionInfoHost } from "../features/session-info/index.ts";
import { NoticeLayer } from "../features/dialogs/index.ts";
import { DropOverlay, EmptyState, startDraft } from "../features/empty/index.ts";
import { OmpSetupView } from "../features/omp-setup/index.ts";
import { ReviewHost } from "../features/review/index.ts";
import { FilePreviewPane, toggleFilesPanel, usePreviewPanel } from "../features/file-preview/index.ts";
import { AgentsPanel, closeAgentsPanel, useAgentsPanel } from "../features/agents/index.ts";
import { CommandPalette } from "../features/palette/index.ts";
import {
  TerminalPanel,
  toggleTerminalFocus,
  useDraftTerminalCleanup,
  useDraftTerminalKey,
  useTerminalOpen,
} from "../features/terminal/index.ts";
import { SettingsView } from "../features/settings/index.ts";
import { onStudioCommand } from "../features/palette/studio-command.ts";
import { jumpToWaitingTask, Sidebar } from "../features/sidebar/index.ts";
import { addProjectAsDraft } from "../features/sidebar/sidebar-actions.ts";
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
import { setDrawerOpen, setSidebarCollapsed, useShellUi } from "./shell-store.ts";
import { SidebarResizer } from "./SidebarResizer.tsx";
import { TopBar } from "./TopBar.tsx";
import { useNavigation } from "./use-navigation.ts";
import { usePresence } from "../ui/presence.ts";
import { useShortcuts } from "./use-shortcuts.ts";
import { useCopyOnSelect } from "./use-copy-on-select.ts";

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
  const draftKey = useDraftTerminalKey();
  const terminalKey = taskId ?? draftKey;
  const terminalOpen = useTerminalOpen(terminalKey);
  const panel = usePreviewPanel();
  const agentsPanel = useAgentsPanel();
  // 子代理面板和文件面板共用右栏：文件面板一打开就收起子代理面板（反过来由 openAgentsPanel 关文件面板）。
  useEffect(() => {
    if (panel !== null) closeAgentsPanel(false);
  }, [panel]);
  useDraftTerminalCleanup(draftKey);
  const shell = useShellUi();
  const narrow = useNarrow();
  const navigation = useNavigation();
  const [aboutOpen, setAboutOpen] = useState(false);

  const theme = settings?.theme ?? null;
  const shownTheme = useRef<typeof theme>(null);
  useEffect(() => {
    if (theme === null) return;
    const root = document.documentElement;
    const apply = () => {
      if (theme === "system") delete root.dataset["theme"];
      else root.dataset["theme"] = theme;
    };
    const previous = shownTheme.current;
    shownTheme.current = theme;
    // 用户切换主题时整窗交叉淡入（View Transitions，时长见 app.css）；启动时第一次套用不动画。
    if (previous === null || previous === theme) apply();
    else document.startViewTransition(apply);
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const sidebarShown = narrow ? shell.drawerOpen : !shell.sidebarCollapsed;
  const drawerScrim = usePresence(narrow && shell.drawerOpen, "fade");

  // 选了任务或变宽之后，抽屉自动收起。
  useEffect(() => setDrawerOpen(false), [taskId, narrow]);

  const tasks = useTasks();
  // 草稿发出第一条消息后建出任务：输入框在原位接着用，不重放换页的淡入（否则从透明闪一下）。
  // 记的是"从草稿来的那个任务"，之后同一任务的重渲染保持不变，换到别的任务才清掉。
  const previousTaskId = useRef(taskId);
  const fromDraftTaskId = useRef<typeof taskId>(null);
  if (previousTaskId.current !== taskId) {
    fromDraftTaskId.current = previousTaskId.current === null ? taskId : null;
    previousTaskId.current = taskId;
  }
  const fromDraft = taskId !== null && fromDraftTaskId.current === taskId;
  // Ctrl 1…9 和任务循环切换跟着侧栏眼前画出来的任务顺序（合并列表里展开着的行）。
  const order = useVisibleTaskIds();
  const openTask = (id: TaskId | undefined) => {
    if (id !== undefined) selectTask(id).catch((error: unknown) => reportError(t, error));
  };

  // spec §5.3：启动、切换任务后焦点进输入框；正在别的输入控件（命令面板等）里时不抢。
  // 这是选中任务后聚焦输入框的唯一一处（Composer 自己不再聚焦）；在提交后、绘制前执行（layout effect），不用 rAF，
  // 所以点任务后焦点位置是确定的；草稿发出第一句话换成任务的输入框时，中间也不会有一帧没有焦点（焦点框闪一下）。
  useLayoutEffect(() => {
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

  // 命令面板的"切换侧栏"以事件发来；用 ref 取最新的 toggleSidebar。/rename 要在侧栏里就地改名，收起时先展开。
  const toggleSidebarRef = useRef(toggleSidebar);
  toggleSidebarRef.current = toggleSidebar;
  const sidebarShownRef = useRef(sidebarShown);
  sidebarShownRef.current = sidebarShown;
  useEffect(
    () =>
      onStudioCommand((command) => {
        if (command === "toggleSidebar" || (command === "rename" && !sidebarShownRef.current))
          toggleSidebarRef.current();
      }),
    [],
  );
  const reportErrorRef = useRef((error: unknown) => reportError(t, error));
  reportErrorRef.current = (error: unknown) => reportError(t, error);
  // 点系统通知：主进程聚焦窗口并发 focusTask，切到对应任务。
  useEffect(
    () => window.studio.onFocusTask((id) => selectTask(id).catch((error: unknown) => reportErrorRef.current(error))),
    [],
  );

  useCopyOnSelect(settings?.copyOnSelect ?? true, t);

  useShortcuts({
    newTask,
    newTaskInCurrentProject: () => startDraft(tasks.find((task) => task.id === taskId)?.projectId ?? null),
    jumpToWaiting: () => void jumpToWaitingTask(taskId, t),
    focusComposer: () => focusComposer(true),
    nthTask: (n) => openTask(order[n - 1]),
    cycleTask: (delta) => {
      if (order.length === 0) return;
      const at = order.findIndex((id) => id === taskId);
      openTask(order[at === -1 ? (delta === 1 ? 0 : order.length - 1) : (at + delta + order.length) % order.length]);
    },
    cycleRegion: focusRegion,
    togglePalette: () => setPaletteOpen(!paletteOpenRef.current),
    focusSidebarSearch: () => {
      if (!sidebarShown) toggleSidebar();
      // 侧栏收起时容器是 inert：等展开提交后再聚焦。
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const input = document.querySelector<HTMLInputElement>("[data-testid=sidebar-search]");
          input?.focus();
          input?.select();
        }),
      );
    },
    openFolder: () => void addProjectAsDraft(t),
    openSettings: () => showView("settings"),
    toggleSidebar,
    goBack: navigation.goBack,
    goForward: navigation.goForward,
    openReview: () => {
      if (taskId !== null && view === "conversation") openReview(taskId);
    },
    toggleTerminalFocus: () => {
      if (view === "conversation") toggleTerminalFocus(terminalKey);
    },
    toggleFilesPanel: () => {
      if (view === "conversation") toggleFilesPanel(terminalKey);
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
      data-drawer={narrow}
    >
      <TopBar
        aboutOpen={aboutOpen}
        onOpenAbout={() => setAboutOpen(true)}
        sidebarShown={sidebarShown}
        onToggleSidebar={toggleSidebar}
      />
      <div className="body">
        {drawerScrim.mounted && (
          <div
            className="drawer-scrim"
            data-testid="drawer-scrim"
            {...drawerScrim.exitProps}
            onPointerDown={() => setDrawerOpen(false)}
          />
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
          {!narrow && sidebarShown && <SidebarResizer width={shell.sidebarWidth} />}
          {view === "settings" ? (
            <SettingsView />
          ) : taskId === null ? (
            <>
              <EmptyState />
              <TerminalPanel key={`terminal:${draftKey}`} terminalKey={draftKey} open={terminalOpen} />
            </>
          ) : (
            <>
              {/* 过程区是 omp 的节点（TspView），输入框是 studio 的 Composer。两个兄弟的 key 必须不同：同一个 key 会让 React 切任务时留下上一个任务的 TspView。 */}
              <TspView key={`tsp:${taskId}`} taskId={taskId} />
              <SessionTreePanel key={`tree:${taskId}`} taskId={taskId} />
              <BtwPanel key={`btw:${taskId}`} taskId={taskId} />
              <Composer key={`composer:${taskId}`} taskId={taskId} fromDraft={fromDraft} />
              <TerminalPanel key={`terminal:${taskId}`} terminalKey={taskId} open={terminalOpen} />
            </>
          )}
        </main>
        {view === "conversation" && panel?.key === terminalKey && (
          <FilePreviewPane key={panel.key} panelKey={panel.key} page={panel.page} path={panel.path} />
        )}
        {view === "conversation" && taskId !== null && agentsPanel?.taskId === taskId && (
          <AgentsPanel key={taskId} taskId={taskId} selected={agentsPanel.selected} />
        )}
      </div>
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <DropOverlay />
      <ReviewHost />
      <GitDialogHost />
      <SessionInfoHost />
      <NoticeLayer />
      <CommandPalette />
      <OmpSetupView />
    </div>
  );
}
