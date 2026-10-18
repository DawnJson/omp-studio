// 主进程入口。最小外壳：单实例、userData 测试覆盖、注册 IPC、打开主窗口。
// 外壳切片补窗口状态、CSP；任务运行时切片在 before-quit 里关子进程。
import { app, BrowserWindow, Menu } from "electron";
import { registerIpcHandlers } from "./ipc/register.ts";
import { createMainWindow, getMainWindow } from "./window/main-window.ts";

// 测试隔离（AGENTS.md）：只在未打包时生效。
if (!app.isPackaged && process.env["STUDIO_USER_DATA"]) {
  app.setPath("userData", process.env["STUDIO_USER_DATA"]);
}

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

  void app.whenReady().then(() => {
    // 无系统菜单栏：顶栏的 ≡ 按钮弹出应用菜单（spec §3.1）。
    Menu.setApplicationMenu(null);
    registerIpcHandlers();
    createMainWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });
}
