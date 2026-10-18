// 主进程入口：单实例、userData 测试覆盖、设置、会话安全、注册 IPC、打开主窗口、退出流程。
import { app, BrowserWindow, Menu } from "electron";
import { registerIpcHandlers } from "./ipc/register.ts";
import { loadSettings } from "./settings/settings-store.ts";
import { installAppProtocol, registerAppScheme } from "./window/app-protocol.ts";
import { createMainWindow, getMainWindow } from "./window/main-window.ts";
import { installSessionSecurity } from "./window/security.ts";
import { installShutdown } from "./window/shutdown.ts";

// 测试隔离（AGENTS.md）：只在未打包时生效。
if (!app.isPackaged && process.env["STUDIO_USER_DATA"]) {
  app.setPath("userData", process.env["STUDIO_USER_DATA"]);
}

registerAppScheme();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = getMainWindow();
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  app.on("window-all-closed", () => app.quit());
  installShutdown();

  void app.whenReady().then(() => {
    // 无系统菜单栏：顶栏的 ≡ 按钮弹出应用菜单（spec §3.1）。
    Menu.setApplicationMenu(null);
    installAppProtocol();
    installSessionSecurity();
    loadSettings();
    registerIpcHandlers();
    createMainWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });
}
