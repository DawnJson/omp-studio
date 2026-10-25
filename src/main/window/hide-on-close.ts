// 窗口 ×：只隐藏窗口，主进程、任务和 omp 子进程都留在后台（托盘常驻，仓库所有者 2026-10-18 决定）。
// 窗口隐藏而不销毁：渲染进程的状态（输入草稿、滚动位置、展开状态）原样保留，取回时没有冷启动恢复这一步；
// 代价是一个常驻渲染进程的内存（几十 MB 量级，未实测），换来最简单、不会丢状态的实现。
// 真正的退出（托盘"退出"、应用菜单退出、安装更新、系统注销/关机）会先让 isQuitting() 变成 true，这里就放行 close。
import { app, Notification } from "electron";
import { resolveLocale } from "../settings/settings-store.ts";
import { t } from "../../shared/i18n/index.ts";
import { retainNotification } from "../tasks/gate-notifier.ts";
import { showMainWindow } from "./show-window.ts";
import { finishShutdown, isQuitting } from "./shutdown.ts";
import { markTrayNoticeShown, trayNoticeShown } from "./window-state.ts";

const heldNotices = new Set<Notification>();

/** 第一次关窗口时告诉用户应用还在托盘里，以后不再提示。 */
function announceTray(): void {
  if (trayNoticeShown()) return;
  markTrayNoticeShown();
  if (!Notification.isSupported()) return;
  const locale = resolveLocale();
  const mac = process.platform === "darwin";
  const notification = new Notification({
    title: t(locale, mac ? "notify.tray.stillRunning.titleMac" : "notify.tray.stillRunning.title"),
    body: t(locale, mac ? "notify.tray.stillRunning.bodyMac" : "notify.tray.stillRunning.body"),
  });
  retainNotification(heldNotices, notification);
  notification.on("click", () => showMainWindow());
  notification.show();
}

export function installHideOnClose(): void {
  app.on("browser-window-created", (_event, window) => {
    window.on("close", (event) => {
      if (isQuitting()) return;
      event.preventDefault();
      window.hide();
      announceTray();
    });
    // 注销/关机：之后无法阻止，也等不到异步收尾，尽力跑退出 hook，兜底是 Job Object。
    window.on("session-end", () => {
      void finishShutdown();
    });
  });
}
