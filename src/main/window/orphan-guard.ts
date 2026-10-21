// 测试隔离模式（未打包 + STUDIO_USER_DATA，AGENTS.md）下的兜底：启动应用的进程（Playwright 的 worker、
// 一次性脚本）没了，应用就退出。测试进程被强杀、管道被 `| head` 提前关掉时，用例的 finally 不会跑，
// 不退出的话这个 Electron 连同它起的 omp、MCP 子进程会一直挂在后台。
// 正常用户启动的应用不装这个：从资源管理器、开始菜单启动时父进程本来就会先退出。
import { app } from "electron";
import { log } from "../log/log.ts";

const CHECK_MS = 2000;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM：进程在，只是没权限发信号。
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function quitWhenParentExits(): void {
  const parent = process.ppid;
  const timer = setInterval(() => {
    if (alive(parent)) return;
    clearInterval(timer);
    log.warn("the launching process exited; quitting (test isolation mode)", { parent });
    // 走正常的退出流程（window/shutdown.ts）：结束 omp、终端等子进程树。
    app.quit();
  }, CHECK_MS);
  timer.unref();
}
