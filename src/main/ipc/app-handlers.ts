// 应用和设置：读写走 settings-store（userData/settings.json）；外壳状态走 window-state。
import { app, shell } from "electron";
import { limits, type AppInfo, type HandlerGroup } from "../../shared/ipc.ts";
import { exportDiagnostics } from "../log/diagnostics.ts";
import { openLogsFolder } from "../log/instance.ts";
import { getSettings, resolveLocale, updateSettings } from "../settings/settings-store.ts";
import { getShellState, parseCollapsedProjects, setShellState, sidebarWidthRange } from "../window/window-state.ts";
import { setTitleBarDimmed } from "../window/main-window.ts";
import { chatsDir } from "../tasks/chats-dir.ts";
import { whatsNewForThisLaunch } from "../whats-new.ts";
import {
  parseBoolean,
  parseExternalUrl,
  parseInteger,
  parseLocalePreference,
  parseMaxLiveProcesses,
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
  | "setMaxLiveProcesses"
  | "openExternal"
  | "quitApp"
  | "openLogsFolder"
  | "exportDiagnostics"
  | "getShellState"
  | "setShellState"
  | "setTitleBarDimmed"
> = {
  getAppInfo: async () => ({
    version: app.getVersion(),
    platform: platform(),
    locale: resolveLocale(),
    isPackaged: app.isPackaged,
    chatsDir: chatsDir(),
    whatsNew: whatsNewForThisLaunch(),
  }),
  getSettings: async () => getSettings(),
  setLocale: async (value) => updateSettings({ locale: parseLocalePreference(value) }),
  setTheme: async (value) => updateSettings({ theme: parseThemePreference(value) }),
  setMaxLiveProcesses: async (value) => updateSettings({ maxLiveProcesses: parseMaxLiveProcesses(value) }),
  openExternal: async (value) => shell.openExternal(parseExternalUrl(value)),
  quitApp: async () => app.quit(),
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
      ...(record["collapsedProjects"] !== undefined && {
        collapsedProjects: parseCollapsedProjects(record["collapsedProjects"]),
      }),
    });
  },
  setTitleBarDimmed: async (value) => setTitleBarDimmed(parseBoolean(value, "dimmed")),
};
