// 退出流程：before-quit 拦一次，等所有注册的 hook 结束（关 omp 子进程等）再真正退出（arch.md §2.4）。
// 关闭过程中的重复退出请求（菜单"退出"后又点 ×）一律被拦下，等同一个 promise，不会提前放行去硬杀子进程。
// 安装更新时也要先跑完这套流程：electron-updater 的 quitAndInstall 自己会触发退出，
// 如果那时 omp 还在跑，Job Object 会把它连同安装过程一起收掉。
// 窗口 × 不走这里：它只隐藏窗口（hide-on-close.ts），真正的退出入口只有托盘"退出"、应用菜单退出、
// 安装更新和系统注销/关机，它们都会让 isQuitting() 变成 true，之后窗口才允许真的关掉。
import { app } from "electron";
import { log } from "../log/log.ts";

type ShutdownHook = () => Promise<void>;

const hooks: ShutdownHook[] = [];
let shutdown: Promise<void> | null = null;
let finished = false;
let quitting = false;

export function registerShutdownHook(hook: ShutdownHook): void {
  hooks.push(hook);
}

/** 应用是不是已经在退出（before-quit 或 finishShutdown 开始之后为 true，不会回头）。 */
export function isQuitting(): boolean {
  return quitting;
}

/** 跑一遍退出 hook（只跑一次）；完成后 finished 为 true，之后的 app.quit() 不会再被拦。 */
export function finishShutdown(): Promise<void> {
  quitting = true;
  shutdown ??= Promise.allSettled(hooks.map((hook) => hook())).then((results) => {
    for (const result of results) if (result.status === "rejected") log.error("退出 hook 失败", result.reason);
    finished = true;
  });
  return shutdown;
}

export function installShutdown(): void {
  app.on("before-quit", (event) => {
    quitting = true;
    if (finished) return;
    event.preventDefault();
    void finishShutdown().then(() => app.quit());
  });
}
