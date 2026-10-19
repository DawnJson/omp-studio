// 任务池单例和它的 Electron 接线：userData 路径、测试用 omp 注入、事件出口、退出时关子进程。
// 其余任务运行时代码（task-pool/runner/registry）不 import electron，单元测试直接实例化。
import os from "node:os";
import path from "node:path";
import { app, Notification } from "electron";
import { resolveLocale } from "../settings/settings-store.ts";
import { getMainWindow } from "../window/main-window.ts";
import { showMainWindow } from "../window/show-window.ts";
import { refreshTray } from "../window/tray.ts";
import { registerShutdownHook } from "../window/shutdown.ts";
import { GateNotifier, retainNotification } from "./gate-notifier.ts";
import { t } from "../../shared/i18n/index.ts";
import { forgetExport } from "./export-record.ts";
import { emitEvent } from "../ipc/events.ts";
import { appHandlers } from "../ipc/app-handlers.ts";
import { writeGoalOverlay } from "../omp/goal-overlay.ts";
import { buildOmpLaunch, setTestOmpOverride } from "../omp/launch.ts";
import { parseTestOmpOverride } from "../omp/launch-args.ts";
import { getOmpExecutable } from "../omp-manager/index.ts";
import { assignToAppJob } from "../platform/win32/job-object.ts";
import { closeTaskTerminal } from "../terminal/active.ts";
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
  remove: (project, worktreePath, branch) => removeWorktree(project.path, worktreePath, branch),
};

let pool: Promise<TaskPool> | null = null;
const heldNotifications = new Set<Notification>();

function createPool(): Promise<TaskPool> {
  // 测试注入只在未打包时生效（arch 第 4 节）。
  const registry = new TaskRegistry(path.join(app.getPath("userData"), "tasks.json"));
  const testOmp = process.env["STUDIO_TEST_OMP"];
  if (!app.isPackaged && testOmp) setTestOmpOverride(parseTestOmpOverride(testOmp));
  const notifier = new GateNotifier({
    enabled: async () => (await appHandlers.getSettings()).notifyOnGate,
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
    buildLaunch: async (record, project) => {
      const goalAutoContinue = (await appHandlers.getSettings()).goalAutoContinue;
      return buildOmpLaunch({
        // worktree 任务以 worktree 根为 cwd（没有 RPC 能改 cwd，只能在 spawn 时定）。
        cwd: record.worktreePath ?? project.path,
        model: record.model,
        thinkingLevel: record.thinkingLevel,
        // 项目目录就是用户主目录时 omp 会自动换到临时目录（cli-reference.md --allow-home）。
        allowHome: pathKey(record.worktreePath ?? project.path) === pathKey(os.homedir()),
        // 设置里的“目标自动推进”：用 --config 覆盖带上 goal.continuationModes，只影响这个进程，不写用户的 omp 配置。
        ...(goalAutoContinue && {
          configOverlay: await writeGoalOverlay(path.join(app.getPath("userData"), "omp-overlay")),
        }),
      });
    },
    worktrees: worktreeOps,
    assignJob: assignToAppJob,
    beforeTaskClose: closeTaskTerminal,
    forkTitle: (title) => t(resolveLocale(), "task.forkTitle", { title }),
    events: {
      state: (state) => {
        emitEvent("taskState", state);
        void notifier.onState(state);
        refreshTray(taskPool.listTasks());
      },
      transcript: (batch) => emitEvent("transcript", batch),
      notice: (notice) => emitEvent("taskNotice", notice),
      taskRemoved: (id) => {
        forgetExport(id);
        emitEvent("taskRemoved", id);
        refreshTray(taskPool.listTasks());
      },
      slashCommands: (taskId, commands) => emitEvent("slashCommands", { taskId, commands }),
      subagents: (taskId, lanes) => emitEvent("subagents", { taskId, lanes }),
      btw: (taskId, event) => emitEvent("btw", { taskId, event }),
    },
  });
  // 退出路径只有 Shell 的 before-quit 一条（arch 2.4）；主进程被强杀时由 Job Object 兜底。
  registerShutdownHook(() => taskPool.shutdown());
  return taskPool.init().then(() => taskPool);
}

/** 任务池单例；第一次调用时载入 tasks.json。要在 app ready 之后调用（userData 路径由 index.ts 在 ready 前设定）。 */
export function getTaskPool(): Promise<TaskPool> {
  pool ??= createPool();
  return pool;
}
