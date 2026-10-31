// 测试隔离模式（未打包 + STUDIO_USER_DATA，docs/architecture/testing.md「隔离用户数据、不留残留」）下的兜底：启动应用的进程（Playwright 的 worker、
// 一次性脚本）没了，应用就退出。测试进程被强杀、管道被 `| head` 提前关掉时，用例的 finally 不会跑，
// 不退出的话这个 Electron 连同它起的 omp、MCP 子进程会一直挂在后台。
// 正常用户启动的应用不装这个：从资源管理器、开始菜单启动时父进程本来就会先退出。
import { app } from "electron";
import { log } from "../log/log.ts";

const CHECK_MS = 2000;
// app.quit() 要等退出 hook（关 omp / 终端进程树）；其中一个卡住（pty 关闭、persist 等）应用就永远退不掉，
// 而这里的唯一目的就是"不留后台进程"，所以给软退出一个期限，过了直接 app.exit。
const QUIT_GRACE_MS = 15_000;

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
    // 不 unref：退出流程真的结束时进程本来就没了，卡住时靠它收尾。进程树由应用的 Job Object 兜底。
    setTimeout(() => {
      log.warn("quit did not finish in time; forcing exit (test isolation mode)", { graceMs: QUIT_GRACE_MS });
      app.exit(0);
    }, QUIT_GRACE_MS);
  }, CHECK_MS);
  timer.unref();
}
