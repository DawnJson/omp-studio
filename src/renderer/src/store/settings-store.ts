// 设置和应用信息：getSettings / getAppInfo 的结果，加上 settings 事件。
// 语言变化会改变 AppInfo.locale，所以收到 settings 事件时重新取一次 AppInfo。
import type { AppInfo, Locale, StudioSettings } from "../../../shared/ipc.ts";
import { createStore, useStoreValue } from "./create-store.ts";

interface SettingsState {
  settings: StudioSettings | null;
  appInfo: AppInfo | null;
  error: string | null;
}

const settingsStore = createStore<SettingsState>({ settings: null, appInfo: null, error: null });

function reportError(what: string, error: unknown): void {
  console.error(`${what} 失败`, error);
  settingsStore.set({ ...settingsStore.get(), error: error instanceof Error ? error.message : String(error) });
}

function loadAppInfo(): void {
  window.studio.getAppInfo().then(
    (appInfo) => settingsStore.set({ ...settingsStore.get(), appInfo }),
    (error: unknown) => reportError("getAppInfo", error),
  );
}

export function startSettingsStore(): void {
  window.studio.onSettings((settings) => {
    settingsStore.set({ ...settingsStore.get(), settings });
    loadAppInfo();
  });
  window.studio.getSettings().then(
    (settings) => settingsStore.set({ ...settingsStore.get(), settings }),
    (error: unknown) => reportError("getSettings", error),
  );
  loadAppInfo();
}

/** 当前界面语言（非 React 代码用；还没载入时按中文）。 */
export function currentLocale(): Locale {
  return settingsStore.get().appInfo?.locale ?? "zh-CN";
}

export function useSettings(): StudioSettings | null {
  return useStoreValue(settingsStore, (state) => state.settings);
}

/** 设置读到了，或者读失败了（失败时界面要显示出错，不能一直等）。 */
export function useSettingsSettled(): boolean {
  return useStoreValue(settingsStore, (state) => state.settings !== null || state.error !== null);
}

export function useAppInfo(): AppInfo | null {
  return useStoreValue(settingsStore, (state) => state.appInfo);
}

/** 当前平台（非 React 代码用；还没载入时按 win32，与 TerminalPanel 一致）。 */
export function currentPlatform(): AppInfo["platform"] {
  return settingsStore.get().appInfo?.platform ?? "win32";
}
