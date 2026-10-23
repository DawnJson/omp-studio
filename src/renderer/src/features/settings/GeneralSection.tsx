// 设置 → 通用：外观（两两一行：语言、主题；减少动效、选中即复制）；通知与回顾（omp 的 ask / completion / error 通知、空闲回顾 + studio 的完成提示音）；
// 任务运行中发消息的方式（studio 的 Enter + omp 的插话/稍后处理方式，两两一行）；快捷键（只读，三列；studio 的键，加转发给 omp 的键）。格子排法见 settings.css 的 .st-cells。
import { Fragment, useEffect } from "react";
import type { LocalePreference, ThemePreference } from "../../../../shared/ipc.ts";
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import { chordKeys } from "../../../../shared/tsp/omp-keybindings.ts";
import { useT } from "../../i18n/use-t.ts";
import { useSettings } from "../../store/index.ts";
import { Badge, Row, SectionHead, Segmented, Switch } from "../../ui/controls.tsx";
import { ConfigRow } from "./ConfigRow.tsx";
import { systemReducesMotion } from "./motion-preference.ts";
import { refreshOmpKeybindings, useOmpKeybindings } from "./omp-keybindings-store.ts";
import { useCommonConfigItems } from "./OmpConfigPane.tsx";

/** 通知和回顾：omp 自己的设置（和终端共用），放在"通知与回顾"一节，不混进"任务运行中"。 */
const notifyKeys: ReadonlySet<string> = new Set([
  "ask.notify",
  "completion.notify",
  "error.notify",
  "recap.enabled",
  "recap.idleSeconds",
]);

/** 转发给 omp 的键的作用文字（omp 动作 ID → i18n）；键位本身来自主进程（默认键位 + 用户 keybindings.yml）。 */
const ompActionLabels: Readonly<Record<string, MessageKey>> = {
  "app.thinking.cycle": "shortcut.ompThinkingCycle",
  "app.thinking.toggle": "shortcut.ompThinkingToggle",
  "app.model.cycleForward": "shortcut.ompModelForward",
  "app.model.cycleBackward": "shortcut.ompModelBackward",
  "app.model.selectTemporary": "shortcut.ompModelTemporary",
  "app.plan.toggle": "shortcut.ompPlanToggle",
  "app.history.search": "shortcut.ompHistorySearch",
  "app.retry": "shortcut.ompRetry",
  "app.message.dequeue": "shortcut.ompDequeue",
};

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
  const behavior = useCommonConfigItems("behavior");
  const notifyItems = behavior.filter((item) => notifyKeys.has(item.key));
  const whileRunning = behavior.filter((item) => !notifyKeys.has(item.key));
  const ompKeybindings = useOmpKeybindings();
  useEffect(() => void refreshOmpKeybindings(), []);

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
      <div className="st-cells" data-cols="2">
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
      <SectionHead title={t("settings.notifications")} />
      <div className="st-cells" data-cols="2" data-testid="notify-settings">
        {notifyItems.map((item) => (
          <ConfigRow key={item.key} item={item} />
        ))}
        <Row label={t("settings.soundOnDone")} info={t("settings.soundOnDone.desc")}>
          {(labelId) => (
            <Switch
              checked={settings?.soundOnDone ?? false}
              labelledBy={labelId}
              onChange={(next) => void window.studio.setSoundOnDone(next)}
              testId="setting-sound-on-done"
            />
          )}
        </Row>
      </div>
      <SectionHead title={t("settings.whileRunning")} />
      <div className="st-cells" data-cols="2">
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
              <span title={t(shortcut.label)}>{t(shortcut.label)}</span>
              {shortcut.keys.map((key) => (
                <kbd key={key} className="kbd">
                  {key}
                </kbd>
              ))}
            </div>
          ))}
        </div>
        <SectionHead
          title={t("settings.shortcuts.omp")}
          count={ompKeybindings.length}
          note={t("settings.shortcuts.omp.desc")}
        />
        <div className="st-kb-grid" data-testid="omp-shortcuts">
          {ompKeybindings.map((binding) => (
            <div key={binding.action} className="st-kb-row" data-testid={`omp-shortcut-${binding.action}`}>
              <span title={t(ompActionLabels[binding.action] ?? "shortcut.ompThinkingCycle")}>
                {t(ompActionLabels[binding.action] ?? "shortcut.ompThinkingCycle")}
              </span>
              {binding.chords.map((chord, index) => (
                <Fragment key={chord}>
                  {index > 0 && <span className="st-kb-or">/</span>}
                  {chordKeys(chord).map((key) => (
                    <kbd key={key} className="kbd">
                      {key}
                    </kbd>
                  ))}
                </Fragment>
              ))}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
