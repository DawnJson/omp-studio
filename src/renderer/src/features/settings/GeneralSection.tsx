// 设置 → 通用：语言、主题、减少动效、新任务的引擎、快捷键（只读）。
import type { LocalePreference, TaskEngine, ThemePreference } from "../../../../shared/ipc.ts";
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import { useT } from "../../i18n/use-t.ts";
import { useSettings } from "../../store/index.ts";
import { Card, Segmented, SettingRow, Switch } from "./controls.tsx";
import { systemReducesMotion } from "./motion-preference.ts";

/** 只读的快捷键表（spec §5.1 的主要几条）；键名本身不翻译。 */
const shortcuts: { label: MessageKey; keys: string[] }[] = [
  { label: "shortcut.palette", keys: ["Ctrl", "K"] },
  { label: "shortcut.newTask", keys: ["Ctrl", "N"] },
  { label: "shortcut.settings", keys: ["Ctrl", ","] },
  { label: "shortcut.toggleSidebar", keys: ["Ctrl", "B"] },
  { label: "shortcut.focusComposer", keys: ["Ctrl", "L"] },
  { label: "shortcut.toggleTerminal", keys: ["Ctrl", "`"] },
  { label: "shortcut.send", keys: ["Enter"] },
  { label: "shortcut.newline", keys: ["Shift", "Enter"] },
  { label: "shortcut.later", keys: ["Ctrl", "Enter"] },
  { label: "shortcut.stop", keys: ["Esc"] },
  { label: "shortcut.toggleProcess", keys: ["Ctrl", "O"] },
  { label: "shortcut.nthTask", keys: ["Ctrl", "1…9"] },
  { label: "shortcut.prevNext", keys: ["Ctrl", "Shift", "[ / ]"] },
  { label: "shortcut.regions", keys: ["F6"] },
  { label: "shortcut.review", keys: ["Ctrl", "Shift", "D"] },
  { label: "shortcut.reviewFiles", keys: ["J / K"] },
  { label: "shortcut.reviewHunks", keys: ["N / P"] },
  { label: "shortcut.reviewLayout", keys: ["V"] },
];

export function GeneralSection() {
  const t = useT();
  const settings = useSettings();
  const systemMotion = systemReducesMotion();

  const localeOptions = [
    { value: "system", label: t("settings.language.system") },
    { value: "zh-CN", label: t("settings.language.zh") },
    { value: "en", label: t("settings.language.en") },
  ] as const;
  const themeOptions = [
    { value: "system", label: t("settings.theme.system") },
    { value: "light", label: t("settings.theme.light") },
    { value: "dark", label: t("settings.theme.dark") },
  ] as const;
  const enterOptions = [
    { value: "steer", label: t("settings.enterBehavior.steer") },
    { value: "followUp", label: t("settings.enterBehavior.later") },
  ] as const;
  const engineOptions = [
    { value: "tsp", label: t("settings.taskEngine.tsp") },
    { value: "rpc", label: t("settings.taskEngine.rpc") },
  ] as const;

  return (
    <>
      <Card>
        <SettingRow title={t("settings.language")}>
          {(labelId) => (
            <Segmented<LocalePreference>
              value={settings?.locale ?? "system"}
              options={localeOptions}
              labelledBy={labelId}
              onChange={(next) => void window.studio.setLocale(next)}
              testId="setting-language"
            />
          )}
        </SettingRow>
        <SettingRow title={t("settings.theme")}>
          {(labelId) => (
            <Segmented<ThemePreference>
              value={settings?.theme ?? "system"}
              options={themeOptions}
              labelledBy={labelId}
              onChange={(next) => void window.studio.setTheme(next)}
              testId="setting-theme"
            />
          )}
        </SettingRow>
        <SettingRow title={t("settings.motion")} desc={t("settings.motion.desc")}>
          {(labelId) => (
            <Switch
              checked={(settings?.reduceMotion ?? false) || systemMotion}
              disabled={systemMotion}
              labelledBy={labelId}
              onChange={(next) => void window.studio.setReduceMotion(next)}
              testId="setting-motion"
            />
          )}
        </SettingRow>
        <SettingRow title={t("settings.enterBehavior")} desc={t("settings.enterBehavior.desc")}>
          {(labelId) => (
            <Segmented<"steer" | "followUp">
              value={settings?.enterWhileRunning ?? "steer"}
              options={enterOptions}
              labelledBy={labelId}
              onChange={(next) => void window.studio.setEnterWhileRunning(next)}
              testId="setting-enter"
            />
          )}
        </SettingRow>
        <SettingRow title={t("settings.notifyWaiting")} desc={t("settings.notifyWaiting.desc")}>
          {(labelId) => (
            <Switch
              checked={settings?.notifyOnGate ?? true}
              labelledBy={labelId}
              onChange={(next) => void window.studio.setNotifyOnGate(next)}
              testId="setting-notify"
            />
          )}
        </SettingRow>
        <SettingRow title={t("settings.copyOnSelect")} desc={t("settings.copyOnSelect.desc")}>
          {(labelId) => (
            <Switch
              checked={settings?.copyOnSelect ?? true}
              labelledBy={labelId}
              onChange={(next) => void window.studio.setCopyOnSelect(next)}
              testId="setting-copy-on-select"
            />
          )}
        </SettingRow>
        <SettingRow title={t("settings.taskEngine")} desc={t("settings.taskEngine.desc")}>
          {(labelId) => (
            <Segmented<TaskEngine>
              value={settings?.taskEngine ?? "tsp"}
              options={engineOptions}
              labelledBy={labelId}
              onChange={(next) => void window.studio.setTaskEngine(next)}
              testId="setting-task-engine"
            />
          )}
        </SettingRow>
      </Card>
      <h3 id="settings-shortcuts" tabIndex={-1} className="settings-group-title">
        {t("settings.shortcuts")}
      </h3>
      <Card>
        {shortcuts.map((shortcut) => (
          <div key={shortcut.label} className="st-shortcut">
            <span>{t(shortcut.label)}</span>
            <span className="st-kbds">
              {shortcut.keys.map((key) => (
                <kbd key={key} className="kbd">
                  {key}
                </kbd>
              ))}
            </span>
          </div>
        ))}
      </Card>
    </>
  );
}
