// 应用和设置。设置目前只在内存里；外壳切片换成 userData/settings.json 的 settings-store，并同步 nativeTheme 和语言。
import { app, shell } from "electron";
import type { AppInfo, HandlerGroup, Locale, StudioSettings } from "../../shared/ipc.ts";
import { emitEvent } from "./events.ts";
import {
  parseApprovalMode,
  parseExternalUrl,
  parseLocalePreference,
  parseMaxLiveProcesses,
  parseModelKey,
  parseThemePreference,
  parseThinkingLevel,
} from "./validate.ts";

let settings: StudioSettings = {
  locale: "system",
  theme: "system",
  defaultModel: null,
  defaultThinkingLevel: null,
  defaultApprovalMode: null,
  maxLiveProcesses: 6,
};

function update(patch: Partial<StudioSettings>): void {
  settings = { ...settings, ...patch };
  emitEvent("settings", settings);
}

function resolveLocale(): Locale {
  if (settings.locale !== "system") return settings.locale;
  return app.getLocale().toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

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
> = {
  getAppInfo: async () => ({ version: app.getVersion(), platform: platform(), locale: resolveLocale(), isPackaged: app.isPackaged }),
  getSettings: async () => settings,
  setLocale: async (value) => update({ locale: parseLocalePreference(value) }),
  setTheme: async (value) => update({ theme: parseThemePreference(value) }),
  setDefaultModel: async (value) => update({ defaultModel: value === null ? null : parseModelKey(value) }),
  setDefaultThinkingLevel: async (value) => update({ defaultThinkingLevel: value === null ? null : parseThinkingLevel(value) }),
  setDefaultApprovalMode: async (value) => update({ defaultApprovalMode: value === null ? null : parseApprovalMode(value) }),
  setMaxLiveProcesses: async (value) => update({ maxLiveProcesses: parseMaxLiveProcesses(value) }),
  openExternal: async (value) => shell.openExternal(parseExternalUrl(value)),
};
