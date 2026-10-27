// 应用里的日志接线：目录在 <userData>/logs（测试时 userData 已被 STUDIO_USER_DATA 换掉，见 index.ts），
// 记下启动信息、未处理的 Promise 拒绝、渲染进程和子进程（GPU 等）意外退出。
import { app, shell } from "electron";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRedactor, log, Logger, setLogger } from "./log.ts";

let logger: Logger | null = null;

export const redactForLog = createRedactor({ home: os.homedir(), user: os.userInfo().username });

function logsDir(): string {
  return path.join(app.getPath("userData"), "logs");
}

export function initLog(): void {
  const current = new Logger({ dir: logsDir(), redact: redactForLog, mirror: !app.isPackaged });
  logger = current;
  setLogger(current);
  // 日志是异步写的：正常退出时 shutdown.ts 等它写完；app.exit() 之类直接结束进程时，在 exit 事件里同步写掉剩下的行。
  process.on("exit", () => current.flushSync());
  log.info(`omp-studio ${app.getVersion()} starting`, {
    electron: process.versions.electron,
    os: `${process.platform} ${os.release()} ${process.arch}`,
    packaged: app.isPackaged,
  });
  process.on("unhandledRejection", (reason) => log.error("unhandled promise rejection", reason));
  app.on("render-process-gone", (_event, _contents, details) => log.error("renderer process gone", details));
  app.on("child-process-gone", (_event, details) => log.error("child process gone", details));
}

/** 日志文件，从新到旧。 */
export function recentLogFiles(): string[] {
  return logger?.files() ?? [];
}

export async function openLogsFolder(): Promise<void> {
  const dir = logsDir();
  await mkdir(dir, { recursive: true });
  const error = await shell.openPath(dir);
  if (error) throw new Error(error);
}
