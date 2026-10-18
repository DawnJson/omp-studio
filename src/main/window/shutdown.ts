// 退出流程：before-quit 拦一次，等所有注册的 hook 结束（关 omp 子进程等）再真正退出（arch.md §2.4）。
// 关闭过程中的重复退出请求（菜单"退出"后又点 ×）一律被拦下，等同一个 promise，不会提前放行去硬杀子进程。
// 安装更新时也要先跑完这套流程：electron-updater 的 quitAndInstall 自己会触发退出，
// 如果那时 omp 还在跑，Job Object 会把它连同安装过程一起收掉。
import { app } from "electron";

type ShutdownHook = () => Promise<void>;

const hooks: ShutdownHook[] = [];
let shutdown: Promise<void> | null = null;
let finished = false;

export function registerShutdownHook(hook: ShutdownHook): void {
  hooks.push(hook);
}

/** 跑一遍退出 hook（只跑一次）；完成后 finished 为 true，之后的 app.quit() 不会再被拦。 */
export function finishShutdown(): Promise<void> {
  shutdown ??= Promise.allSettled(hooks.map((hook) => hook())).then((results) => {
    for (const result of results) if (result.status === "rejected") console.error("退出 hook 失败", result.reason);
    finished = true;
  });
  return shutdown;
}

export function installShutdown(): void {
  app.on("before-quit", (event) => {
    if (finished) return;
    event.preventDefault();
    void finishShutdown().then(() => app.quit());
  });
}
