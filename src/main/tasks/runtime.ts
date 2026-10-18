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
import { TaskPool } from "./task-pool.ts";
import { pathKey, TaskRegistry } from "./task-registry.ts";

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
        cwd: project.path,
        model: record.model,
        thinkingLevel: record.thinkingLevel,
        // 项目目录就是用户主目录时 omp 会自动换到临时目录（cli-reference.md --allow-home）。
        allowHome: pathKey(project.path) === pathKey(os.homedir()),
      }),
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
