// 任务池单例和它的 Electron 接线：userData 路径、测试用 omp 注入、事件出口、退出时关子进程。
// 其余任务运行时代码（task-pool/runner/registry）不 import electron，单元测试直接实例化。
import os from "node:os";
import path from "node:path";
import { app, Notification } from "electron";
import { resolveLocale } from "../settings/settings-store.ts";
import { getMainWindow } from "../window/main-window.ts";
import { registerShutdownHook } from "../window/shutdown.ts";
import { GateNotifier, retainNotification } from "./gate-notifier.ts";
import { emitEvent } from "../ipc/events.ts";
import { appHandlers } from "../ipc/app-handlers.ts";
import { buildOmpLaunch, setTestOmpOverride } from "../omp/launch.ts";
import { parseTestOmpOverride } from "../omp/launch-args.ts";
import { assignToAppJob } from "../platform/win32/job-object.ts";
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

// 项目路径在创建 worktree 时已确认是仓库根（createWorktree），移除时直接用它。
// setup 脚本只运行用户确认过（项目 + 内容哈希）的那份；这里是主进程侧的强制检查，不依赖渲染进程。
const worktreeOps: WorktreeOps = {
  create: async (project) => {
    const created = await createWorktree(project.path, {
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
    projectName: (task) => registry.findProject(task.projectId)?.name ?? "",
    show: (content, onClick) => {
      const notification = new Notification(content);
      retainNotification(heldNotifications, notification);
      notification.on("click", onClick);
      notification.show();
    },
    // 点通知：聚焦窗口，渲染进程收到 focusTask 后切到该任务。
    onClick: (id) => {
      const window = getMainWindow();
      if (!window) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      emitEvent("focusTask", id);
    },
  });
  const taskPool = new TaskPool({
    registry,
    getSettings: () => appHandlers.getSettings(),
    buildLaunch: (record, project) =>
      buildOmpLaunch({
        // worktree 任务以 worktree 根为 cwd（没有 RPC 能改 cwd，只能在 spawn 时定）。
        cwd: record.worktreePath ?? project.path,
        model: record.model,
        thinkingLevel: record.thinkingLevel,
        // 项目目录就是用户主目录时 omp 会自动换到临时目录（cli-reference.md --allow-home）。
        allowHome: pathKey(record.worktreePath ?? project.path) === pathKey(os.homedir()),
      }),
    worktrees: worktreeOps,
    assignJob: assignToAppJob,
    events: {
      state: (state) => {
        emitEvent("taskState", state);
        void notifier.onState(state);
      },
      transcript: (batch) => emitEvent("transcript", batch),
      notice: (notice) => emitEvent("taskNotice", notice),
      taskRemoved: (id) => emitEvent("taskRemoved", id),
      slashCommands: (taskId, commands) => emitEvent("slashCommands", { taskId, commands }),
      subagents: (taskId, lanes) => emitEvent("subagents", { taskId, lanes }),
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
