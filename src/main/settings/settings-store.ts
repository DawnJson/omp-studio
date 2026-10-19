// 设置存储：userData/settings.json。启动时读一次，之后以内存为准，每次修改立即原子写盘、推送 settings 事件，
// 并把主题同步给 nativeTheme（渲染进程只靠 prefers-color-scheme 和 <html data-theme>）。
import { app, nativeTheme } from "electron";
import path from "node:path";
import type { Locale, StudioSettings } from "../../shared/ipc.ts";
import { emitEvent } from "../ipc/events.ts";
import {
  parseBoolean,
  parseOneOf,
  parseLocalePreference,
  parseMaxLiveProcesses,
  parseRecord,
  parseThemePreference,
} from "../ipc/validate.ts";
import { readJsonFile, writeJsonFileAtomic } from "./json-file.ts";

const defaults: StudioSettings = {
  locale: "system",
  theme: "system",
  maxLiveProcesses: 6,
  reduceMotion: false,
  enterWhileRunning: "steer",
  notifyOnGate: true,
  goalAutoContinue: true,
  yoloConfirmed: false,
};

let settings: StudioSettings = defaults;

function settingsFile(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

/** 逐字段校验，坏的字段回落到默认值（文件可能被手改，或来自别的版本）。 */
function sanitize(raw: unknown): StudioSettings {
  let record: Record<string, unknown> = {};
  try {
    record = parseRecord(raw, "settings");
  } catch {
    return defaults;
  }
  const field = <T>(parse: (value: unknown) => T, value: unknown, fallback: T): T => {
    try {
      return parse(value);
    } catch {
      return fallback;
    }
  };
  return {
    locale: field(parseLocalePreference, record["locale"], defaults.locale),
    theme: field(parseThemePreference, record["theme"], defaults.theme),
    maxLiveProcesses: field(parseMaxLiveProcesses, record["maxLiveProcesses"], defaults.maxLiveProcesses),
    reduceMotion: field((value) => parseBoolean(value, "reduceMotion"), record["reduceMotion"], defaults.reduceMotion),
    enterWhileRunning: field(
      (value) => parseOneOf(value, "enterWhileRunning", ["steer", "followUp"]),
      record["enterWhileRunning"],
      defaults.enterWhileRunning,
    ),
    notifyOnGate: field((value) => parseBoolean(value, "notifyOnGate"), record["notifyOnGate"], defaults.notifyOnGate),
    goalAutoContinue: field(
      (value) => parseBoolean(value, "goalAutoContinue"),
      record["goalAutoContinue"],
      defaults.goalAutoContinue,
    ),
    yoloConfirmed: field(
      (value) => parseBoolean(value, "yoloConfirmed"),
      record["yoloConfirmed"],
      defaults.yoloConfirmed,
    ),
  };
}

/** 必须在 app.setPath("userData") 之后、创建窗口之前调用：窗口首帧的背景色取决于主题。 */
export function loadSettings(): void {
  settings = sanitize(readJsonFile(settingsFile()));
  nativeTheme.themeSource = settings.theme;
}

export function getSettings(): StudioSettings {
  return settings;
}

export function updateSettings(patch: Partial<StudioSettings>): void {
  settings = { ...settings, ...patch };
  writeJsonFileAtomic(settingsFile(), settings);
  nativeTheme.themeSource = settings.theme;
  emitEvent("settings", settings);
}

export function resolveLocale(): Locale {
  if (settings.locale !== "system") return settings.locale;
  return app.getLocale().toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}
