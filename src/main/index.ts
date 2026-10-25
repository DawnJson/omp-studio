// 主进程入口：单实例、userData 测试覆盖、设置、会话安全、注册 IPC、打开主窗口、托盘常驻、退出流程。
import { app, Menu } from "electron";
import { registerIpcHandlers } from "./ipc/register.ts";
import { applyOmpStartupDefaults } from "./ipc/omp-handlers.ts";
import { initLog } from "./log/instance.ts";
import { prewarmToolbarData } from "./service/default-model.ts";
import { log } from "./log/log.ts";
import { fixLoginPath } from "./platform/darwin/login-path.ts";
import { loadSettings } from "./settings/settings-store.ts";
import { startUpdates } from "./update/instance.ts";
import { installAppProtocol, registerAppScheme } from "./window/app-protocol.ts";
import { installHideOnClose } from "./window/hide-on-close.ts";
import { createMainWindow, isAppUrl } from "./window/main-window.ts";
import { installSessionSecurity } from "./window/security.ts";
import { showMainWindow } from "./window/show-window.ts";
import { installShutdown } from "./window/shutdown.ts";
import { quitWhenParentExits } from "./window/orphan-guard.ts";
import { createTray } from "./window/tray.ts";

// 测试隔离（AGENTS.md）：只在未打包时生效。启动它的测试进程没了就跟着退出，不留后台进程。
const testUserData = app.isPackaged ? undefined : process.env["STUDIO_USER_DATA"];
if (testUserData) app.setPath("userData", testUserData);
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
  if (testUserData) quitWhenParentExits();
  installHideOnClose();

  void app.whenReady().then(async () => {
    // Windows 无系统菜单栏：顶栏的 ≡ 按钮弹出应用菜单（spec §3.1）。
    // mac 的 Cmd+C/V/X/A/Z、Cmd+Q/H/M/W 都靠应用菜单里的 role 提供，菜单为空这些键全失效，所以放一个只含系统 role 的最小菜单。
    // Cmd+Q = appMenu 的 quit role → app.quit() → before-quit，被 window/shutdown.ts 接住先跑退出 hook；
    // Cmd+W = fileMenu 的 close role（mac 上 windowMenu 里没有 close）→ 窗口 close 事件，被 hide-on-close.ts 拦成隐藏。
    // 不放 viewMenu：它的 reload / forceReload 会抢走渲染进程的 ⌘R / ⌘⇧R（spec §5.1）。（未在 mac 上实测）
    Menu.setApplicationMenu(
      process.platform === "darwin"
        ? Menu.buildFromTemplate([
            { role: "appMenu" },
            { role: "fileMenu" },
            { role: "editMenu" },
            { role: "windowMenu" },
          ])
        : null,
    );
    installAppProtocol();
    installSessionSecurity(isAppUrl);
    loadSettings();
    // mac 从 Finder 启动时 PATH 只有系统目录：先补上登录 shell 的 PATH，之后起的 omp / git / gh 才找得到。只在 darwin 执行，最多等 3 秒。
    await fixLoginPath();
    registerIpcHandlers();
    createMainWindow();
    createTray();
    startUpdates().catch((error: unknown) => log.error("update service failed to start", error));
    void applyOmpStartupDefaults();
    // 输入框工具行要的默认模型、模型目录：和窗口同时开始读，不等渲染进程来要。
    prewarmToolbarData();
    app.on("activate", () => {
      showMainWindow();
    });
  });
}
