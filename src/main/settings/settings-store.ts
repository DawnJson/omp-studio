// 设置存储：userData/settings.json。启动时读一次，之后以内存为准：每次修改立即生效、推送 settings 事件，
// 并把主题同步给 nativeTheme（渲染进程只靠 prefers-color-scheme 和 <html data-theme>）；写盘在后台串行做（原子写），退出前等它写完。
import { app, nativeTheme } from "electron";
import path from "node:path";
import { defaultFontSize, type Locale, type StudioSettings } from "../../shared/ipc.ts";
import { emitEvent } from "../ipc/events.ts";
import {
  parseBoolean,
  parseFontSize,
  parseIdleClose,
  parseOneOf,
  parseLocalePreference,
  parseMaxLiveProcesses,
  parseRecord,
  parseThemePreference,
} from "../ipc/validate.ts";
import { log } from "../log/log.ts";
import { writeFileAtomic } from "../tasks/atomic-write.ts";
import { registerShutdownHook } from "../window/shutdown.ts";
import { readJsonFile } from "./json-file.ts";

const defaults: StudioSettings = {
  locale: "system",
  theme: "system",
  maxLiveProcesses: 6,
  idleClose: "1h",
  reduceMotion: false,
  enterWhileRunning: "steer",
  soundOnDone: false,
  copyOnSelect: true,
  fontSize: defaultFontSize,
  yoloConfirmed: false,
};

let settings: StudioSettings = defaults;
/** 串行的写盘链：一次只写一个，写的是轮到时的最新设置；排着队的那次没开始写之前再改，不再多排一次。 */
let saving: Promise<void> = Promise.resolve();
let saveQueued = false;

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
    idleClose: field(parseIdleClose, record["idleClose"], defaults.idleClose),
    reduceMotion: field((value) => parseBoolean(value, "reduceMotion"), record["reduceMotion"], defaults.reduceMotion),
    enterWhileRunning: field(
      (value) => parseOneOf(value, "enterWhileRunning", ["steer", "followUp"]),
      record["enterWhileRunning"],
      defaults.enterWhileRunning,
    ),
    soundOnDone: field((value) => parseBoolean(value, "soundOnDone"), record["soundOnDone"], defaults.soundOnDone),
    copyOnSelect: field((value) => parseBoolean(value, "copyOnSelect"), record["copyOnSelect"], defaults.copyOnSelect),
    fontSize: field(parseFontSize, record["fontSize"], defaults.fontSize),
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

const listeners: ((next: StudioSettings) => void)[] = [];

/** 设置变化（每次 updateSettings，内存里的值已经更新）时调用；主进程里要跟着设置动的模块（TSP 会话的 motion 事件等）订阅。 */
export function onSettingsChanged(listener: (next: StudioSettings) => void): void {
  listeners.push(listener);
}

export function offSettingsChanged(listener: (next: StudioSettings) => void): void {
  const index = listeners.indexOf(listener);
  if (index >= 0) listeners.splice(index, 1);
}

export function updateSettings(patch: Partial<StudioSettings>): void {
  settings = { ...settings, ...patch };
  if (!saveQueued) {
    saveQueued = true;
    saving = saving
      .then(() => {
        saveQueued = false;
        return writeFileAtomic(settingsFile(), JSON.stringify(settings, null, 2), String(process.pid));
      })
      .catch((error: unknown) => log.error("saving settings.json failed", error));
  }
  nativeTheme.themeSource = settings.theme;
  emitEvent("settings", settings);
  for (const listener of listeners) listener(settings);
}

// 退出前等设置写完。
registerShutdownHook(() => saving);

export function resolveLocale(): Locale {
  if (settings.locale !== "system") return settings.locale;
  return app.getLocale().toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}
