// 应用和设置：读写走 settings-store（userData/settings.json）；外壳状态走 window-state。
import { app, shell } from "electron";
import type { AppInfo, HandlerGroup } from "../../shared/ipc.ts";
import { exportDiagnostics } from "../log/diagnostics.ts";
import { openLogsFolder } from "../log/instance.ts";
import { getSettings, resolveLocale, updateSettings } from "../settings/settings-store.ts";
import { getShellState, parseCollapsedProjects, setShellState, sidebarWidthRange } from "../window/window-state.ts";
import {
  parseApprovalMode,
  parseBoolean,
  parseExternalUrl,
  parseInteger,
  parseLocalePreference,
  parseMaxLiveProcesses,
  parseModelKey,
  parseRecord,
  parseThemePreference,
  parseThinkingLevel,
} from "./validate.ts";

function platform(): AppInfo["platform"] {
  return process.platform === "win32" || process.platform === "darwin" ? process.platform : "linux";
}

export const appHandlers: HandlerGroup<
  | "getAppInfo"
  | "getSettings"
  | "setLocale"
  | "setTheme"
  | "setDefaultModel"
  | "setDefaultThinkingLevel"
  | "setDefaultApprovalMode"
  | "setMaxLiveProcesses"
  | "openExternal"
  | "quitApp"
  | "openLogsFolder"
  | "exportDiagnostics"
  | "getShellState"
  | "setShellState"
> = {
  getAppInfo: async () => ({
    version: app.getVersion(),
    platform: platform(),
    locale: resolveLocale(),
    isPackaged: app.isPackaged,
  }),
  getSettings: async () => getSettings(),
  setLocale: async (value) => updateSettings({ locale: parseLocalePreference(value) }),
  setTheme: async (value) => updateSettings({ theme: parseThemePreference(value) }),
  setDefaultModel: async (value) => updateSettings({ defaultModel: value === null ? null : parseModelKey(value) }),
  setDefaultThinkingLevel: async (value) =>
    updateSettings({ defaultThinkingLevel: value === null ? null : parseThinkingLevel(value) }),
  setDefaultApprovalMode: async (value) =>
    updateSettings({ defaultApprovalMode: value === null ? null : parseApprovalMode(value) }),
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
      ...(record["collapsedProjects"] !== undefined && {
        collapsedProjects: parseCollapsedProjects(record["collapsedProjects"]),
      }),
    });
  },
};
