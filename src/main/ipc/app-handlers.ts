// 应用和设置：读写走 settings-store（userData/settings.json）；外壳状态走 window-state。
import { app, shell } from "electron";
import { editCommands, historyOrders, limits, type AppInfo, type HandlerGroup } from "../../shared/ipc.ts";
import { exportDiagnostics } from "../log/diagnostics.ts";
import { openLogsFolder } from "../log/instance.ts";
import { getSettings, resolveLocale, updateSettings } from "../settings/settings-store.ts";
import { getShellState, setShellState, sidebarWidthRange } from "../window/window-state.ts";
import { getMainWindow, setTitleBarDimmed } from "../window/main-window.ts";
import { chatsDir } from "../tasks/chats-dir.ts";
import { studioReleaseNotes, whatsNewForThisLaunch } from "../whats-new.ts";
import {
  parseBoolean,
  parseExternalUrl,
  parseInteger,
  parseLocalePreference,
  parseOneOf,
  parseRecord,
  parseThemePreference,
} from "./validate.ts";

function platform(): AppInfo["platform"] {
  return process.platform === "win32" || process.platform === "darwin" ? process.platform : "linux";
}

export const appHandlers: HandlerGroup<
  | "getAppInfo"
  | "getSettings"
  | "setLocale"
  | "setTheme"
  | "openExternal"
  | "openLogsFolder"
  | "exportDiagnostics"
  | "getShellState"
  | "setShellState"
  | "setTitleBarDimmed"
  | "editField"
> = {
  getAppInfo: async () => ({
    version: app.getVersion(),
    platform: platform(),
    locale: resolveLocale(),
    isPackaged: app.isPackaged,
    chatsDir: chatsDir(),
    whatsNew: whatsNewForThisLaunch(),
    releaseNotes: studioReleaseNotes(app.getVersion()),
    runtime: { electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node },
  }),
  getSettings: async () => getSettings(),
  setLocale: async (value) => updateSettings({ locale: parseLocalePreference(value) }),
  setTheme: async (value) => updateSettings({ theme: parseThemePreference(value) }),
  openExternal: async (value) => shell.openExternal(parseExternalUrl(value)),
  openLogsFolder: () => openLogsFolder(),
  exportDiagnostics: () => exportDiagnostics(),
  getShellState: async () => getShellState(),
  setShellState: async (value) => {
    const record = parseRecord(value, "shellState");
    setShellState({
      ...(record["sidebarWidth"] !== undefined && {
        sidebarWidth: parseInteger(record["sidebarWidth"], "sidebarWidth", ...sidebarWidthRange),
      }),
      ...(record["sidebarCollapsed"] !== undefined && {
        sidebarCollapsed: parseBoolean(record["sidebarCollapsed"], "sidebarCollapsed"),
      }),
      ...(record["terminalHeight"] !== undefined && {
        terminalHeight: parseInteger(record["terminalHeight"], "terminalHeight", ...limits.terminalHeightRange),
      }),
      ...(record["historyOrder"] !== undefined && {
        historyOrder: parseOneOf(record["historyOrder"], "historyOrder", historyOrders),
      }),
    });
  },
  setTitleBarDimmed: async (value) => setTitleBarDimmed(parseBoolean(value, "dimmed")),
  // 作用于主窗口里当前获得焦点的输入框，和系统编辑菜单的同名命令一样；粘贴由 Chromium 自己读剪贴板、发 paste 事件。
  editField: async (value) => {
    getMainWindow()?.webContents[parseOneOf(value, "command", editCommands)]();
  },
};
