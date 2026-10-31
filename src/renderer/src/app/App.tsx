// 应用布局（spec §3.1–3.3）：40px 通栏任务条 + 侧栏 + 四角圆的主区“纸面”；窄窗口侧栏变抽屉。
// 各功能入口的导出名和 props 是约定（props 只有 id，数据从 store hook 取）。
import { reportError } from "../ui/errors.ts";
import {
  Activity,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { backdropFilePattern, type TaskId } from "../../../shared/ipc.ts";
import { resolveTheme, themes } from "../../../shared/themes.ts";
import { getVisibleTaskIds } from "../features/sidebar/visible-order-store.ts";
import { Composer } from "../features/composer/index.ts";
import { BtwPanel } from "../features/btw/index.ts";
import { SessionTreePanel } from "../features/conversation/index.ts";
import { releaseTspDocument, TspView } from "../features/tsp/index.ts";
import { NoticeLayer } from "../features/dialogs/index.ts";
import { DropOverlay, EmptyState, startDraft } from "../features/empty/index.ts";
import { toggleFilesPanel, usePreviewPanel } from "../features/file-preview/index.ts";
import { closeAgentsPanel, useAgentsPanel } from "../features/agents/index.ts";
import { closeBrowserPanel, openBrowserPanel, toggleBrowserPanel, useBrowserPanel } from "../features/browser/index.ts";
import {
  TerminalPanel,
  toggleTerminalFocus,
  useDraftTerminalCleanup,
  useDraftTerminalKey,
  useTerminalOpen,
} from "../features/terminal/index.ts";
import {
  AgentsPanel,
  BrowserPanel,
  CommandPalette,
  FilePreviewPane,
  GitDialogHost,
  OmpSetupView,
  preloadFrequentViews,
  ReviewHost,
  SessionInfoHost,
  SettingsNav,
  SettingsView,
} from "./lazy-views.tsx";
import { onStudioCommand } from "../features/palette/studio-command.ts";
import { jumpToWaitingTask, Sidebar } from "../features/sidebar/index.ts";
import { addProjectAsDraft } from "../features/sidebar/sidebar-actions.ts";
import { useLocale, useT } from "../i18n/use-t.ts";
import { openReview } from "../store/review-store.ts";
import {
  getTask,
  selectTask,
  setPaletteOpen,
  showView,
  useAppInfo,
  useExistingTaskIds,
  useMainView,
  usePaletteOpen,
  useSelectedTaskId,
  useSettings,
  useSettingsSettled,
} from "../store/index.ts";
import { AboutDialog } from "./AboutDialog.tsx";
import { setDrawerOpen, setSidebarCollapsed, useShellValue } from "./shell-store.ts";
import { SidebarResizer } from "./SidebarResizer.tsx";
import { TopBar } from "./TopBar.tsx";
import { useNavigation } from "./use-navigation.ts";
import { useDialogSlot, usePresence } from "../ui/presence.ts";
import { useShortcuts } from "./use-shortcuts.ts";
import { useCopyOnSelect } from "./use-copy-on-select.ts";
import { restartSession } from "./restart-session.ts";
import { TooltipLayer } from "../ui/Tooltip.tsx";
import { EditMenu } from "./EditMenu.tsx";

/** spec §3.3：窄于 1000px 侧栏改成覆盖式抽屉。 */
const narrowQuery = "(max-width: 999px)";
/** 留着不卸载的对话区个数（同时跑四五个任务来回切的常见情形）。 */
const KEPT_VIEWS = 5;
/** 藏着的对话区这么久没再看就卸载（DOM 和文档镜像一起放掉），切回来重新拉快照、重画。 */
const KEPT_IDLE_MS = 10 * 60 * 1000;
/** 启动时等 first-contentful-paint 的上限：Windows 上 FCP 在导航后约 500ms 内就到，Linux 打包版有时一直不来。 */
const firstFrameFallbackMs = 1000;

function useMediaQuery(media: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia(media);
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    },
    () => window.matchMedia(media).matches,
  );
}

const composerSelector = "[data-composer-input]";

/** 当前任务的对话滚动区：最近看过的任务的对话区藏着也在 DOM 里，取显示着的那个。 */
function visibleLog(): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>('[role="log"]')].find(
      (element) => element.getClientRects().length > 0,
    ) ?? null
  );
}

function focusComposer(scrollToEnd: boolean): void {
  const field = document.querySelector<HTMLTextAreaElement>(composerSelector);
  field?.focus({ preventScroll: true });
  // 光标放在草稿末尾。
  field?.setSelectionRange(field.value.length, field.value.length);
  const log = visibleLog();
  if (scrollToEnd && log) log.scrollTop = log.scrollHeight;
}

/** F6 的三个区域：侧栏（当前的一个 Tab 停靠点，没有就取第一个按钮）→ 对话区 → 输入框。 */
function focusRegion(delta: 1 | -1): void {
  const regions = [
    document.querySelector<HTMLElement>('nav.sb [tabindex="0"], nav.sb button'),
    visibleLog(),
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
  const browserPanel = useBrowserPanel();
  // 子代理、浏览器、文件三个面板共用右栏，同时只开一个：文件面板一打开就收起另外两个，子代理面板打开时收起浏览器
  // （openAgentsPanel 关文件面板，openBrowserPanel 关另外两个）。
  useEffect(() => {
    if (panel === null) return;
    closeAgentsPanel(false);
    closeBrowserPanel(false);
  }, [panel]);
  useEffect(() => {
    if (agentsPanel !== null) closeBrowserPanel(false);
  }, [agentsPanel]);
  // omp 连上了当前任务的浏览器（AI 开始用它）：打开面板，不抢焦点。
  useEffect(
    () =>
      window.studio.onBrowserConnected((id) => {
        if (id === taskId && view === "conversation") openBrowserPanel(id, false);
      }),
    [taskId, view],
  );
  useDraftTerminalCleanup(draftKey);
  const sidebarWidth = useShellValue("sidebarWidth");
  const sidebarCollapsed = useShellValue("sidebarCollapsed");
  const drawerOpen = useShellValue("drawerOpen");
  const sidebarColumn = useRef<HTMLDivElement>(null);
  const narrow = useMediaQuery(narrowQuery);
  // 跟随系统时实际用 light / dark（都没有插图）；用来判断"主题插图"这次画不画。
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const navigation = useNavigation();
  const about = useDialogSlot();
  const openAbout = about.open;
  const aboutKey = about.slot?.key ?? null;

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
    // 系统三键不是网页画的：网页换完 data-theme 告诉主进程，三键跟着换（main-window.ts 的 setTitleBarTheme）。
    const report = (crossfade: boolean) => void window.studio.setTitleBarTheme(theme, crossfade);
    // 用户切换主题时整窗交叉淡入（View Transitions，时长见 app.css），淡入开始时三键用同样的时长和曲线一起淡入；
    // 启动时第一次套用不动画。淡入被跳过（窗口隐藏着、紧接着又换了主题）时 ready 失败，页面在 apply 后直接换，三键也直接换。
    if (previous === null || previous === theme) {
      apply();
      report(false);
      return;
    }
    const transition = document.startViewTransition(apply);
    void transition.ready.then(
      async () => {
        // ready 时伪元素刚建好，淡入下一帧才开始（实测 ready 比动画的开始时刻早约 25ms，先报告三键就领先网页一截）。
        // 这一帧里淡入被跳过（窗口隐藏、又起了一次 View Transition）时动画取消、它的 ready 失败：页面已是新主题，三键直接换。
        const fade = document
          .getAnimations()
          .find(
            (animation) => (animation.effect as KeyframeEffect | null)?.pseudoElement === "::view-transition-new(root)",
          );
        const started =
          fade === undefined ||
          (await fade.ready.then(
            () => true,
            () => false,
          ));
        report(started);
      },
      () => void transition.updateCallbackDone.then(() => report(false)),
    );
  }, [theme]);
  // 设置读到（或读失败）、主题套上，并且页面第一次有内容的一帧已经真的显示出来（first-contentful-paint，按上屏时间记），
  // 才告诉主进程淡入窗口。只等 React 提交不够：窗口刚显示时绘制面还没准备好，提交后要再过约 250ms 内容才上屏，
  // 先淡入的会是一块空底色（2026-10-26 截屏实测；FCP 的时刻和截屏里内容出现的时刻一致）。
  // Chromium 有时一直不记 FCP：Linux 打包版实测只有 first-paint，窗口永远透明（2026-10-26，docs/architecture/linux.md）。
  // 所以设置读到后最多等 firstFrameFallbackMs，FCP 还没来也照样淡入。
  // 设置在 FCP 之后才到时，主题变化要再画一帧：两次 rAF，第二次时那一帧已经画出。主进程只认第一次，开发时 StrictMode 多调一次无妨。
  const settingsSettled = useSettingsSettled();
  useEffect(() => {
    if (!settingsSettled) return;
    let reported = false;
    const report = () => {
      if (reported) return;
      reported = true;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          void window.studio.windowReady();
          // 窗口淡入之后空闲时载入命令面板、设置、终端（lazy-views.tsx）；其余按需加载的视图第一次打开时才载入。
          requestIdleCallback(() => void preloadFrequentViews());
        }),
      );
    };
    const observer = new PerformanceObserver((list) => {
      if (list.getEntriesByName("first-contentful-paint").length > 0) report();
    });
    observer.observe({ type: "paint", buffered: true });
    const fallback = setTimeout(report, firstFrameFallbackMs);
    return () => {
      observer.disconnect();
      clearTimeout(fallback);
    };
  }, [settingsSettled]);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  // CSS 按平台分支用（顶栏给系统三键让位的位置不同，见 app.css）。AppInfo 载入前按 win32，和 TerminalPanel、platform-keys 一致。
  const platform = appInfo?.platform ?? "win32";
  useEffect(() => {
    document.documentElement.dataset["platform"] = platform;
  }, [platform]);
  // Windows 11 毛玻璃（docs/architecture/themes.md「毛玻璃」）：主进程给窗口铺了 Acrylic，顶栏、侧栏改画半透明（app.css）。
  const glass = settings?.glass === true && appInfo?.glassSupported === true;
  useEffect(() => {
    document.documentElement.toggleAttribute("data-glass", glass);
  }, [glass]);
  // 主区背景图（docs/architecture/themes.md「主区背景图」）：图和纱画在 .panel 自己的 background 上（app.css），
  // 当前主题没有插图、自选图片的文件名不合规时都不画（不挂 data-backdrop）。
  const customBackdrop = settings?.customBackdrop ?? null;
  const backdrop =
    settings?.backdrop === "theme" && themes[resolveTheme(settings.theme, systemDark)].art
      ? "theme"
      : settings?.backdrop === "custom" && customBackdrop !== null && backdropFilePattern.test(customBackdrop)
        ? "custom"
        : undefined;

  const sidebarShown = narrow ? drawerOpen : !sidebarCollapsed;
  const drawerScrim = usePresence(narrow && drawerOpen, "fade");

  // 选了任务或变宽之后，抽屉自动收起。
  useEffect(() => setDrawerOpen(false), [taskId, narrow]);

  // 草稿发出第一条消息后建出任务：输入框在原位接着用，不重放换页的淡入（否则从透明闪一下）。
  // 记的是"从草稿来的那个任务"，之后同一任务的重渲染保持不变，换到别的任务才清掉。
  const previousTaskId = useRef(taskId);
  const fromDraftTaskId = useRef<typeof taskId>(null);
  if (previousTaskId.current !== taskId) {
    fromDraftTaskId.current = previousTaskId.current === null ? taskId : null;
    previousTaskId.current = taskId;
  }
  const fromDraft = taskId !== null && fromDraftTaskId.current === taskId;
  // 最近看过的几个任务的对话区不卸载，切走时用 React 的 Activity 藏起来（effect 和订阅撤掉，状态和 DOM 留着）：
  // 切回来不用把整段对话重新画一遍（30 轮的对话约 250ms → 110ms）。最近用过的在前；画的时候按 id 排，切任务不挪 DOM。
  const recent = useRef<TaskId[]>([]);
  if (taskId !== null && recent.current[0] !== taskId)
    recent.current = [taskId, ...recent.current.filter((id) => id !== taskId)].slice(0, KEPT_VIEWS);
  // 藏起来的对话区 KEPT_IDLE_MS 没再看就从 recent 里拿掉：切走时起表，切回来取消。
  const idleTimers = useRef(new Map<TaskId, ReturnType<typeof setTimeout>>());
  const [, setEvictions] = useState(0);
  useEffect(() => {
    if (taskId === null) return;
    const timers = idleTimers.current;
    clearTimeout(timers.get(taskId));
    timers.delete(taskId);
    return () => {
      timers.set(
        taskId,
        setTimeout(() => {
          timers.delete(taskId);
          recent.current = recent.current.filter((id) => id !== taskId);
          setEvictions((count) => count + 1);
        }, KEPT_IDLE_MS),
      );
    };
  }, [taskId]);
  // 只订阅"这几个 id 里哪些还在"（不订阅整张任务表：任务状态事件很密，App 一重渲染整个外壳都跟着渲染）。
  const kept = useExistingTaskIds([...recent.current].sort());
  // 离开 recent 的对话区（挤出去、藏太久）放掉文档镜像（主进程也就不再推它的批次）；折叠等界面状态留着。
  // 被移除的任务还在 recent 里、只是不在 kept 里了：tsp-store 自己丢，主进程自己注销。
  const previousKept = useRef(kept);
  useEffect(() => {
    for (const id of previousKept.current) if (!recent.current.includes(id)) releaseTspDocument(id);
    previousKept.current = kept;
  }, [kept]);
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
    if (narrow) setDrawerOpen(!drawerOpen);
    else setSidebarCollapsed(!sidebarCollapsed);
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
        else if (command === "about") openAbout(true);
      }),
    [openAbout],
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
    newTaskInCurrentProject: () => startDraft((taskId === null ? null : getTask(taskId))?.projectId ?? null),
    jumpToWaiting: () => void jumpToWaitingTask(taskId, t),
    focusComposer: () => focusComposer(true),
    // Ctrl 1…9 和任务循环切换跟着侧栏眼前画出来的任务顺序（合并列表里展开着的行），按键时才读。
    nthTask: (n) => openTask(getVisibleTaskIds()[n - 1]),
    cycleTask: (delta) => {
      const order = getVisibleTaskIds();
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
    toggleBrowserPanel: () => {
      if (taskId !== null && view === "conversation") toggleBrowserPanel(taskId);
    },
    restartSession: () => {
      const current = taskId === null ? null : getTask(taskId);
      if (current !== null && view === "conversation") void restartSession(t, current);
    },
    closeDrawer: () => {
      if (!narrow || !drawerOpen) return false;
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
      <TopBar sidebarShown={sidebarShown} onToggleSidebar={toggleSidebar} />
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
          ref={sidebarColumn}
          className="sidebar-column"
          data-testid="sidebar-column"
          inert={!sidebarShown}
          style={{ "--sidebar-current": `${sidebarWidth}px` } as CSSProperties}
        >
          {/* 进设置时侧栏位置换成设置导航；窄窗口的抽屉里仍是会话列表，设置导航改成内容顶上的下拉 */}
          {view === "settings" && !narrow ? <SettingsNav /> : <Sidebar />}
        </div>
        <main
          className="panel"
          data-testid="main-panel"
          data-backdrop={backdrop}
          data-backdrop-strength={backdrop && settings?.backdropStrength}
          style={
            backdrop === "custom"
              ? ({ "--bd-image": `url("app://studio/@backdrop/${customBackdrop}")` } as CSSProperties)
              : undefined
          }
        >
          {!narrow && sidebarShown && <SidebarResizer width={sidebarWidth} column={sidebarColumn} />}
          {/* 过程区是 omp 的节点（TspView），输入框是 studio 的 Composer。最近看过的任务的 TspView 都在这里，只有当前任务的显示；
              进设置、回空状态时也留着。key 带前缀，和下面同一任务 id 的兄弟区分开。
              进设置时当前任务的过程区不藏进 Activity（parked）：长对话从 display:none 回来要把上万个节点重算样式、重挂所有 effect，
              返回那一帧卡 100ms 以上。 */}
          {kept.map((id) => (
            <Activity key={`tsp:${id}`} mode={id === taskId ? "visible" : "hidden"}>
              <TspView taskId={id} parked={view !== "conversation"} />
            </Activity>
          ))}
          {view === "settings" ? (
            <SettingsView compactNav={narrow || !sidebarShown} />
          ) : taskId === null ? (
            <>
              <EmptyState />
              <TerminalPanel key={`terminal:${draftKey}`} terminalKey={draftKey} open={terminalOpen} />
            </>
          ) : (
            <>
              <SessionTreePanel key={`tree:${taskId}`} taskId={taskId} />
              <BtwPanel key={`btw:${taskId}`} taskId={taskId} />
              <Composer key={`composer:${taskId}`} taskId={taskId} fromDraft={fromDraft} />
              <TerminalPanel key={`terminal:${taskId}`} terminalKey={taskId} open={terminalOpen} />
            </>
          )}
        </main>
        {/* 右栏三个面板是兄弟，key 都要带前缀：同一个任务 id 当 key 时，从子代理面板换到文件面板的那一帧两者都在，React 会把文件面板画成两份。 */}
        {view === "conversation" && panel?.key === terminalKey && (
          <FilePreviewPane key={`files:${panel.key}`} panelKey={panel.key} page={panel.page} path={panel.path} />
        )}
        {view === "conversation" && taskId !== null && agentsPanel?.taskId === taskId && (
          <AgentsPanel key={`agents:${taskId}`} taskId={taskId} selected={agentsPanel.selected} />
        )}
        {view === "conversation" && taskId !== null && browserPanel === taskId && (
          <BrowserPanel key={`browser:${taskId}`} taskId={taskId} />
        )}
      </div>
      {aboutKey !== null && <AboutDialog key={aboutKey} onExited={() => about.closed(aboutKey)} />}
      <DropOverlay />
      <EditMenu />
      <ReviewHost />
      <GitDialogHost />
      <SessionInfoHost />
      <NoticeLayer />
      <CommandPalette />
      <OmpSetupView />
      <TooltipLayer />
    </div>
  );
}
