// 任务池单例和它的 Electron 接线：userData 路径、测试用 omp 注入、事件出口、退出时关子进程。
// 其余任务运行时代码（task-pool/runner/registry）不 import electron，单元测试直接实例化。
import os from "node:os";
import path from "node:path";
import { app, nativeTheme, Notification, shell } from "electron";
import { getSettings, onSettingsChanged, resolveLocale } from "../settings/settings-store.ts";
import { getMainWindow } from "../window/main-window.ts";
import { showMainWindow } from "../window/show-window.ts";
import { refreshTray } from "../window/tray.ts";
import { refreshTaskbarProgress } from "../window/taskbar-progress.ts";
import { registerShutdownHook } from "../window/shutdown.ts";
import { GateNotifier, retainNotification } from "./gate-notifier.ts";
import { t } from "../../shared/i18n/index.ts";
import { forgetExport } from "./export-record.ts";
import { emitEvent } from "../ipc/events.ts";
import { forgetDraft } from "../ipc/draft-handlers.ts";
import { appHandlers } from "../ipc/app-handlers.ts";
import { buildTspLaunch, setTestOmpOverride } from "../omp/launch.ts";
import { exportSessionHtml } from "../omp/export-session.ts";
import { parseTestOmpOverride } from "../omp/launch-args.ts";
import type { OmpConnection } from "../omp/omp-connection.ts";
import { getOmpExecutable } from "../omp-manager/index.ts";
import { closeTaskTerminal } from "../terminal/active.ts";
import { startupCache } from "../service/startup-cache-instance.ts";
import { log } from "../log/log.ts";
import { listModelOptions, readDefaultModel } from "../service/default-model.ts";
import { readNotifyEnabled, readProjectModelDefaults } from "../ipc/omp-handlers.ts";
import { serviceOmp } from "../service/service-omp.ts";
import { projectOmp } from "../service/project-omp-instance.ts";
import { createWorktree, removeWorktree } from "../git/worktree.ts";
import { SetupConsent } from "../git/setup-consent.ts";
import { TaskPool, type WorktreeOps } from "./task-pool.ts";
import { pathKey, TaskRegistry } from "./task-registry.ts";

let consent: SetupConsent | null = null;
/** setup 脚本的确认记录（userData/setup-consent.json）；要在 app ready 之后调用。 */
export function getSetupConsent(): SetupConsent {
  consent ??= new SetupConsent(path.join(app.getPath("userData"), "setup-consent.json"));
  return consent;
}

/**
 * 创建 worktree 用的 omp。e2e 里任务进程是假 omp（getOmpExecutable 返回的是它），而 worktree 要真 omp 来建：
 * 未打包时 `STUDIO_TEST_WORKTREE_OMP` 指向真实 omp 的路径。
 */
async function worktreeOmpPath(): Promise<string> {
  const override = app.isPackaged ? undefined : process.env["STUDIO_TEST_WORKTREE_OMP"];
  return override ?? (await getOmpExecutable()).path;
}

// 项目路径在创建 worktree 时已确认是仓库根（createWorktree），移除时直接用它。
// setup 脚本只运行用户确认过（项目 + 内容哈希）的那份；这里是主进程侧的强制检查，不依赖渲染进程。
const worktreeOps: WorktreeOps = {
  create: async (project) => {
    const created = await createWorktree(project.path, {
      ompPath: await worktreeOmpPath(),
      approveSetup: (script) => getSetupConsent().isApproved(project.path, script.sha256),
    });
    return { path: created.path, branch: created.branch, base: created.baseBranch };
  },
  // 斜杠菜单在这个 worktree（或其子目录）里起过项目 rpc-ui 的话，它的 cwd 占着目录：先关掉再删。
  remove: async (project, worktreePath, branch) => {
    await projectOmp.closeUnder(worktreePath);
    await removeWorktree(project.path, worktreePath, branch);
  },
};

let pool: Promise<TaskPool> | null = null;
const heldNotifications = new Set<Notification>();

function createPool(): Promise<TaskPool> {
  // 测试注入只在未打包时生效（arch 第 4 节）。
  const registry = new TaskRegistry(path.join(app.getPath("userData"), "tasks.json"));
  const testOmp = process.env["STUDIO_TEST_OMP"];
  if (!app.isPackaged && testOmp) setTestOmpOverride(parseTestOmpOverride(testOmp));
  const notifier = new GateNotifier({
    // 项目目录里跑 `omp config list --json`：项目的 .omp/config.yml 盖过全局，和 omp 自己的行为一致；读不到设置时记 WARN、不发通知。
    notifyEnabled: (task, kind) =>
      readNotifyEnabled(kind, registry.findProject(task.projectId)?.path ?? null).catch((error: unknown) => {
        log.warn("reading omp's notify setting failed", { kind, message: String(error) });
        return false;
      }),
    soundEnabled: async () => (await appHandlers.getSettings()).soundOnDone,
    // Windows 上是系统"默认提示音"（声音设置里可换），不随安装包带音频文件。
    playSound: () => shell.beep(),
    locale: resolveLocale,
    windowFocused: () => getMainWindow()?.isFocused() ?? false,
    windowHidden: () => !(getMainWindow()?.isVisible() ?? false),
    projectName: (task) => registry.findProject(task.projectId)?.name ?? "",
    show: (content, onClick) => {
      const notification = new Notification(content);
      retainNotification(heldNotifications, notification);
      notification.on("click", onClick);
      notification.show();
    },
    // 点通知：显示并聚焦窗口（可能隐藏在托盘），渲染进程收到 focusTask 后切到该任务。
    onClick: (id) => {
      const existed = getMainWindow() !== null;
      const window = showMainWindow();
      if (existed) emitEvent("focusTask", id);
      // 窗口是新建的（旧的被销毁了）：等页面加载完、渲染进程订阅好事件再发。
      else window.webContents.once("did-finish-load", () => setTimeout(() => emitEvent("focusTask", id), 500));
    },
  });
  const taskPool = new TaskPool({
    registry,
    getSettings: () => appHandlers.getSettings(),
    worktrees: worktreeOps,
    beforeTaskClose: closeTaskTerminal,
    forkTitle: (title) => t(resolveLocale(), "task.forkTitle", { title }),
    knownModels: () => startupCache().models(),
    listModels: () => listModelOptions(),
    newTaskDefaults: async (project) => {
      // 缓存优先：草稿页刚读过这个项目的默认值（getModelDefaults 会记进启动缓存），不再多跑一次 `omp config list`。
      const cache = startupCache().snapshot();
      const defaults = cache.modelDefaults?.[project.id] ?? (await readProjectModelDefaults(project.id, project.path));
      const ompDefault = defaults.model !== null ? null : (cache.defaultModel ?? (await readDefaultModel()));
      return { model: defaults.model, thinkingLevel: defaults.thinkingLevel, ompDefault };
    },
    // 任务的命令列表取任务目录里的项目 rpc-ui（项目 skill、自定义命令、扩展命令都在里面）；草稿页（没有目录）用服务进程。
    listSlashCommands: async (cwd) => {
      const request = (connection: OmpConnection) => connection.request("get_available_commands");
      return (await (cwd === null ? serviceOmp.use(request) : projectOmp.use(cwd, request))).commands;
    },
    exportSession: exportSessionHtml,
    tsp: {
      buildLaunch: (record, project) => {
        // worktree 任务以 worktree 根为 cwd（omp 会话绑 cwd，只能在 spawn 时定）；omp 里 `/move` 过的任务从新目录恢复（会话文件已搬过去，OSC 7）。
        const cwd = record.cwd ?? record.worktreePath ?? project.path;
        return buildTspLaunch({
          cwd,
          model: record.model,
          thinkingLevel: record.thinkingLevel,
          // 项目目录就是用户主目录时 omp 会自动换到临时目录（cli-reference.md --allow-home）。
          allowHome: pathKey(cwd) === pathKey(os.homedir()),
          resumeSessionFile: record.sessionFile,
          forkSessionFile: record.forkFrom ?? null,
        });
      },
      session: {
        appVersion: app.getVersion(),
        // hello 回复里的外观；之后的变化由 syncAppearance（下面）发 theme / motion 事件。
        appearance: () => ({ dark: nativeTheme.shouldUseDarkColors, reduceMotion: getSettings().reduceMotion }),
      },
    },
    events: {
      state: (state) => {
        emitEvent("taskState", state);
        void notifier.onState(state);
        const tasks = taskPool.listTasks();
        refreshTray(tasks);
        refreshTaskbarProgress(tasks);
      },
      tspBatch: (batch) => emitEvent("tspBatch", batch),
      notice: (notice) => emitEvent("taskNotice", notice),
      taskRemoved: (id) => {
        forgetExport(id);
        notifier.forget(id);
        void forgetDraft(id).catch((error: unknown) => {
          log.warn(`forget draft of ${id} failed`, { error: error instanceof Error ? error.message : String(error) });
        });
        emitEvent("taskRemoved", id);
        const tasks = taskPool.listTasks();
        refreshTray(tasks);
        refreshTaskbarProgress(tasks);
      },
      btw: (taskId, event) => emitEvent("btw", { taskId, event }),
      composerPrefill: (taskId, draft) => emitEvent("composerPrefill", { taskId, draft }),
    },
  });
  // 项目 rpc-ui 主动推来的命令列表（握手期间加载完技能 / 扩展、`/reload-plugins` 之后）：推给这个目录里的所有任务。
  projectOmp.onCommandsUpdate = (dir, commands) => {
    for (const task of taskPool.listTasks())
      if (pathKey(task.cwd) === pathKey(dir)) emitEvent("slashCommands", { taskId: task.id, commands });
  };
  // 深浅主题（设置或系统）和"减少动效"设置变了，给所有运行中的 TSP 会话发 theme / motion 事件（TspSession.setAppearance 只发有变化的）。
  const syncAppearance = () =>
    taskPool.setAppearance({ dark: nativeTheme.shouldUseDarkColors, reduceMotion: getSettings().reduceMotion });
  nativeTheme.on("updated", syncAppearance);
  onSettingsChanged(syncAppearance);
  // 退出路径只有 Shell 的 before-quit 一条（arch 2.4）；主进程被强杀时由 Job Object 兜底。
  registerShutdownHook(() => taskPool.shutdown());
  return taskPool.init().then(() => taskPool);
}

/** 任务池单例；第一次调用时载入 tasks.json。要在 app ready 之后调用（userData 路径由 index.ts 在 ready 前设定）。 */
export function getTaskPool(): Promise<TaskPool> {
  pool ??= createPool();
  return pool;
}
