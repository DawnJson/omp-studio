// 主进程入口：单实例、userData 测试覆盖、设置、会话安全、注册 IPC、打开主窗口、托盘常驻、退出流程。
import { app, Menu } from "electron";
import { registerIpcHandlers } from "./ipc/register.ts";
import { initLog } from "./log/instance.ts";
import { loadSettings } from "./settings/settings-store.ts";
import { startUpdates } from "./update/instance.ts";
import { installAppProtocol, registerAppScheme } from "./window/app-protocol.ts";
import { installHideOnClose } from "./window/hide-on-close.ts";
import { createMainWindow } from "./window/main-window.ts";
import { installSessionSecurity } from "./window/security.ts";
import { showMainWindow } from "./window/show-window.ts";
import { installShutdown } from "./window/shutdown.ts";
import { createTray } from "./window/tray.ts";

// 测试隔离（AGENTS.md）：只在未打包时生效。
if (!app.isPackaged && process.env["STUDIO_USER_DATA"]) {
  app.setPath("userData", process.env["STUDIO_USER_DATA"]);
}
initLog();

registerAppScheme();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // 再次启动应用：把隐藏在托盘的窗口带回前台。
  app.on("second-instance", () => {
    void app.whenReady().then(showMainWindow);
  });

  // 常驻托盘：窗口 × 只隐藏（hide-on-close.ts），所以最后一个窗口关掉不等于退出。
  // 这里装一个空监听是为了关掉 Electron 的默认行为（无监听时自动退出）；真正的退出只走 app.quit()。
  app.on("window-all-closed", () => {});
  installShutdown();
  installHideOnClose();

  void app.whenReady().then(() => {
    // 无系统菜单栏：顶栏的 ≡ 按钮弹出应用菜单（spec §3.1）。
    Menu.setApplicationMenu(null);
    installAppProtocol();
    installSessionSecurity();
    loadSettings();
    registerIpcHandlers();
    createMainWindow();
    createTray();
    startUpdates();
    app.on("activate", () => {
      showMainWindow();
    });
  });
}
