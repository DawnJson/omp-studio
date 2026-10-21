// 终端管理器单例和它的 Electron 接线：任务目录取自任务池、node-pty 按需加载、事件出口、退出时结束所有终端。
// node-pty 是原生模块，放在第一次真正起终端时才加载：它加载失败只影响终端，不影响应用启动。
import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { parseDraftKey, type TaskId, type TerminalKey } from "../../shared/ipc.ts";
import { emitEvent } from "../ipc/events.ts";
import { log } from "../log/log.ts";
import { managedOmpBin } from "../omp-manager/index.ts";
import { withPtyLock } from "../platform/pty-lock.ts";
import { assignToOwnJob } from "../platform/win32/job-object.ts";
import { chatsDir } from "../tasks/chats-dir.ts";
import { getTaskPool } from "../tasks/runtime.ts";
import type { TaskPool } from "../tasks/task-pool.ts";
import { registerShutdownHook } from "../window/shutdown.ts";
import { setActiveTerminalManager } from "./active.ts";
import { buildTerminalEnv, resolveShell } from "./shell.ts";
import { TerminalManager } from "./terminal-manager.ts";

/** 在 PATH 里找可执行文件（不看当前目录：Windows 的 CreateProcess 会先找当前目录，不能让项目里的 pwsh.exe 抢先）。 */
function which(command: string): string | null {
  const dirs = (process.env["PATH"] ?? process.env["Path"] ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, command);
    try {
      accessSync(candidate, constants.F_OK);
      return candidate;
    } catch {
      // 这个目录里没有，找下一个。
    }
  }
  return null;
}

/** Windows：结束 shell 和它起的所有进程（node-pty 的 kill 只关 shell）。用绝对路径：不带路径时 Windows 会先在当前目录里找。 */
function killProcessTree(pid: number): Promise<void> {
  if (process.platform !== "win32") return Promise.resolve();
  const killer = path.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "taskkill.exe");
  const done = Promise.withResolvers<void>();
  // shell 已经自己退出时命令会失败，忽略即可。
  execFile(killer, ["/T", "/F", "/PID", String(pid)], { windowsHide: true, timeout: 5000 }, () => done.resolve());
  return done.promise;
}

let manager: TerminalManager | null = null;

/** 任务的有效目录；草稿的项目目录，无项目的草稿用 chats 目录（和 ensureChatsProject 一样现建）。 */
async function terminalCwd(pool: TaskPool, key: TerminalKey): Promise<string> {
  const draft = parseDraftKey(key);
  if (draft === undefined) return pool.taskCwd(key as TaskId);
  if (draft.projectId === null) {
    const dir = chatsDir();
    await mkdir(dir, { recursive: true });
    return dir;
  }
  const project = pool.listProjects().find((candidate) => candidate.id === draft.projectId);
  if (!project) throw new Error(`unknown project ${draft.projectId}`);
  return project.path;
}

function createManager(pool: TaskPool): TerminalManager {
  return new TerminalManager({
    terminalCwd: (key) => terminalCwd(pool, key),
    directoryExists: (dir) =>
      stat(dir).then(
        (info) => info.isDirectory(),
        () => false,
      ),
    resolveShell: () => resolveShell({ platform: process.platform, env: process.env, which }),
    buildEnv: () => buildTerminalEnv(process.env, managedOmpBin()),
    async spawn(shell, options) {
      // 原生模块按需加载（见文件头），静态 import 做不到。
      const nodePty = await import("node-pty");
      // useConpty 不传：用 node-pty 的默认（Windows 10 1809+ 走 ConPTY）。spawn 和别的 pty 的结束排队（platform/pty-lock.ts）。
      const pty = await withPtyLock(async () =>
        nodePty.spawn(shell.file, shell.args, {
          name: "xterm-256color",
          cols: options.cols,
          rows: options.rows,
          cwd: options.cwd,
          env: options.env,
        }),
      );
      log.info("terminal spawned", { shell: shell.name });
      return pty;
    },
    killTree: killProcessTree,
    assignJob: assignToOwnJob,
    emitData: (key, data) => emitEvent("terminalData", { key, data }),
    emitExit: (key, exitCode) => emitEvent("terminalExit", { key, exitCode }),
    onError: (message, error) => log.warn(message, error),
  });
}

export async function getTerminalManager(): Promise<TerminalManager> {
  if (manager) return manager;
  const created = createManager(await getTaskPool());
  // 并发的第一次调用：先到先得，后到的丢掉自己建的（它还没有任何终端）。
  if (manager) return manager;
  manager = created;
  setActiveTerminalManager(created);
  // 退出路径：before-quit → finishShutdown → 这里；主进程被强杀时由应用 Job Object 兜底。
  registerShutdownHook(() => created.closeAll());
  return created;
}
