// 应用和设置：读写走 settings-store（userData/settings.json）；外壳状态走 window-state。
import { app, shell } from "electron";
import {
  editCommands,
  historyOrders,
  limits,
  titleBarFades,
  type AppInfo,
  type HandlerGroup,
} from "../../shared/ipc.ts";
import { exportDiagnostics } from "../log/diagnostics.ts";
import { openLogsFolder } from "../log/instance.ts";
import { getSettings, resolveLocale, updateSettings } from "../settings/settings-store.ts";
import { chooseBackdropImage } from "../settings/backdrop-image.ts";
import { getShellState, setShellState, sidebarWidthRange } from "../window/window-state.ts";
import {
  getMainWindow,
  glassSupported,
  revealOnFirstFrame,
  setTitleBarDimmed,
  setTitleBarTheme,
} from "../window/main-window.ts";
import { chatsDir } from "../tasks/chats-dir.ts";
import { studioReleaseNotes, whatsNewForThisLaunch } from "../whats-new.ts";
import {
  parseBackdropMode,
  parseBackdropStrength,
  parseBoolean,
  parseExternalUrl,
  parseInteger,
  parseLocalePreference,
  parseFontSize,
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
  | "setBackdrop"
  | "setBackdropStrength"
  | "chooseBackdropImage"
  | "setGlass"
  | "setFontSize"
  | "openExternal"
  | "openLogsFolder"
  | "exportDiagnostics"
  | "getShellState"
  | "setShellState"
  | "setTitleBarDimmed"
  | "setTitleBarTheme"
  | "windowReady"
  | "editField"
> = {
  getAppInfo: async () => ({
    version: app.getVersion(),
    platform: platform(),
    locale: resolveLocale(),
    isPackaged: app.isPackaged,
    glassSupported,
    chatsDir: chatsDir(),
    whatsNew: whatsNewForThisLaunch(),
    releaseNotes: studioReleaseNotes(app.getVersion()),
    runtime: { electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node },
  }),
  getSettings: async () => getSettings(),
  setLocale: async (value) => updateSettings({ locale: parseLocalePreference(value) }),
  setTheme: async (value) => updateSettings({ theme: parseThemePreference(value) }),
  setBackdrop: async (value) => {
    const backdrop = parseBackdropMode(value);
    // custom 要先有图：渲染进程没选过图时走 chooseBackdropImage，那里复制好图再切过来。
    if (backdrop === "custom" && getSettings().customBackdrop === null)
      throw new Error("no custom backdrop chosen yet");
    updateSettings({ backdrop });
  },
  setBackdropStrength: async (value) => updateSettings({ backdropStrength: parseBackdropStrength(value) }),
  chooseBackdropImage: () => chooseBackdropImage(getMainWindow()),
  setGlass: async (value) => updateSettings({ glass: parseBoolean(value, "glass") }),
  setFontSize: async (value) => updateSettings({ fontSize: parseFontSize(value) }),
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
  setTitleBarDimmed: async (dimmed, fade) =>
    setTitleBarDimmed(parseBoolean(dimmed, "dimmed"), parseOneOf(fade, "fade", titleBarFades)),
  setTitleBarTheme: async (theme, crossfade) =>
    setTitleBarTheme(parseThemePreference(theme), parseBoolean(crossfade, "crossfade")),
  windowReady: async () => revealOnFirstFrame(),
  // 作用于主窗口里当前获得焦点的输入框，和系统编辑菜单的同名命令一样；粘贴由 Chromium 自己读剪贴板、发 paste 事件。
  editField: async (value) => {
    getMainWindow()?.webContents[parseOneOf(value, "command", editCommands)]();
  },
};
