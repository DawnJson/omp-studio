// 设置 → 通用：外观（语言、主题、减少动效、通知、选中即复制）；任务运行中发消息的方式（studio 的 Enter + omp 的插话/稍后处理方式）；
// 快捷键（只读，两列）。
import type { LocalePreference, ThemePreference } from "../../../../shared/ipc.ts";
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import { useT } from "../../i18n/use-t.ts";
import { useSettings } from "../../store/index.ts";
import { Badge, Row, SectionHead, Segmented, Switch } from "../../ui/controls.tsx";
import { ConfigRow } from "./ConfigRow.tsx";
import { systemReducesMotion } from "./motion-preference.ts";
import { useCommonConfigItems } from "./OmpConfigPane.tsx";

/** 只读的快捷键表（spec §5.1 的主要几条）；键名本身不翻译。 */
const shortcuts: { label: MessageKey; keys: string[] }[] = [
  { label: "shortcut.palette", keys: ["Ctrl", "K"] },
  { label: "shortcut.newTask", keys: ["Ctrl", "N"] },
  { label: "shortcut.focusSearch", keys: ["Ctrl", "F"] },
  { label: "shortcut.openFolder", keys: ["Ctrl", "Shift", "O"] },
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
  { label: "shortcut.toggleFiles", keys: ["Ctrl", "Shift", "E"] },
  { label: "shortcut.reviewFiles", keys: ["J / K"] },
  { label: "shortcut.reviewHunks", keys: ["N / P"] },
  { label: "shortcut.reviewLayout", keys: ["V"] },
];

export function GeneralSection() {
  const t = useT();
  const settings = useSettings();
  const systemMotion = systemReducesMotion();
  // omp 的插话 / 稍后消息处理方式（"对话行为"组的常用项），和 Enter 的行为放在一起。
  const whileRunning = useCommonConfigItems("behavior");

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

  return (
    <>
      <SectionHead title={t("settings.appearance")} />
      <div className="ui-rows st-rows">
        <Row label={t("settings.language")}>
          {(labelId) => (
            <Segmented<LocalePreference>
              size="sm"
              value={settings?.locale ?? "system"}
              options={localeOptions}
              labelledBy={labelId}
              onChange={(next) => void window.studio.setLocale(next)}
              testId="setting-language"
            />
          )}
        </Row>
        <Row label={t("settings.theme")}>
          {(labelId) => (
            <Segmented<ThemePreference>
              size="sm"
              value={settings?.theme ?? "system"}
              options={themeOptions}
              labelledBy={labelId}
              onChange={(next) => void window.studio.setTheme(next)}
              testId="setting-theme"
            />
          )}
        </Row>
        <Row label={t("settings.motion")} info={t("settings.motion.desc")}>
          {(labelId) => (
            <>
              <Switch
                checked={(settings?.reduceMotion ?? false) || systemMotion}
                disabled={systemMotion}
                labelledBy={labelId}
                onChange={(next) => void window.studio.setReduceMotion(next)}
                testId="setting-motion"
              />
              {systemMotion && <Badge>{t("settings.motion.system")}</Badge>}
            </>
          )}
        </Row>
        <Row label={t("settings.notifyWaiting")} info={t("settings.notifyWaiting.desc")}>
          {(labelId) => (
            <Switch
              checked={settings?.notifyOnGate ?? true}
              labelledBy={labelId}
              onChange={(next) => void window.studio.setNotifyOnGate(next)}
              testId="setting-notify"
            />
          )}
        </Row>
        <Row label={t("settings.copyOnSelect")} info={t("settings.copyOnSelect.desc")}>
          {(labelId) => (
            <Switch
              checked={settings?.copyOnSelect ?? true}
              labelledBy={labelId}
              onChange={(next) => void window.studio.setCopyOnSelect(next)}
              testId="setting-copy-on-select"
            />
          )}
        </Row>
      </div>
      <SectionHead title={t("settings.whileRunning")} />
      <div className="ui-rows st-rows">
        <Row label={t("settings.enterBehavior")} info={t("settings.enterBehavior.desc")}>
          {(labelId) => (
            <Segmented<"steer" | "followUp">
              size="sm"
              value={settings?.enterWhileRunning ?? "steer"}
              options={enterOptions}
              labelledBy={labelId}
              onChange={(next) => void window.studio.setEnterWhileRunning(next)}
              testId="setting-enter"
            />
          )}
        </Row>
        {whileRunning.map((item) => (
          <ConfigRow key={item.key} item={item} />
        ))}
      </div>
      <section id="settings-shortcuts" tabIndex={-1} className="st-section">
        <SectionHead title={t("settings.shortcuts")} count={shortcuts.length} />
        <div className="st-kb-grid">
          {shortcuts.map((shortcut) => (
            <div key={shortcut.label} className="st-kb-row">
              <span>{t(shortcut.label)}</span>
              {shortcut.keys.map((key) => (
                <kbd key={key} className="kbd">
                  {key}
                </kbd>
              ))}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
