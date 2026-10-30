// 设置 → 通用：外观（主题画廊；格子里背景图、浓度、毛玻璃、语言、字号、减少动效、选中即复制）；通知与回顾（omp 的 ask / completion / error 通知、空闲回顾 + studio 的完成提示音）；
// 任务运行中发消息的方式（studio 的 Enter + omp 的插话/稍后处理方式，两两一行）；空闲任务多久关进程；快捷键（只读，三列；studio 的键，加转发给 omp 的键）。格子排法见 settings.css 的 .st-cells。
import { Fragment, useEffect } from "react";
import {
  defaultFontSize,
  fontSizeSteps,
  type BackdropMode,
  type BackdropStrength,
  type IdleClose,
  type LocalePreference,
} from "../../../../shared/ipc.ts";
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import { chordKeys } from "../../../../shared/tsp/omp-keybindings.ts";
import { useT } from "../../i18n/use-t.ts";
import { shortcutKeys } from "../../app/platform-keys.ts";
import { useAppInfo, useSettings } from "../../store/index.ts";
import { Badge, Button, Row, SectionHead, Segmented, Switch } from "../../ui/controls.tsx";
import { reportError } from "../../ui/errors.ts";
import { Select } from "../../ui/Select.tsx";
import { ConfigRow } from "./ConfigRow.tsx";
import { systemReducesMotion } from "./motion-preference.ts";
import { refreshOmpKeybindings, useOmpKeybindings } from "./omp-keybindings-store.ts";
import { useCommonConfigItems } from "./OmpConfigPane.tsx";
import { ThemeGallery } from "./ThemeGallery.tsx";

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

/** 只读的快捷键表（spec §5.1 的主要几条）；键名本身不翻译，"Ctrl" 写的是应用主修饰键，mac 上显示成 ⌘（shortcutKeys）。 */
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
  { label: "shortcut.toggleBrowser", keys: ["Ctrl", "Shift", "B"] },
  { label: "shortcut.reviewFiles", keys: ["J / K"] },
  { label: "shortcut.reviewHunks", keys: ["N / P"] },
  { label: "shortcut.reviewLayout", keys: ["V"] },
];

export function GeneralSection() {
  const t = useT();
  const settings = useSettings();
  const glassSupported = useAppInfo()?.glassSupported ?? false;
  const systemMotion = systemReducesMotion();
  const guard = (promise: Promise<unknown>) => void promise.catch((error: unknown) => reportError(t, error));
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
  const backdrop = settings?.backdrop ?? "theme";
  const backdropOptions = (["theme", "custom", "none"] as const).map((value) => ({
    value,
    label: t(`settings.backdrop.${value}`),
  }));
  const strengthOptions = (["low", "medium", "high"] as const).map((value) => ({
    value,
    label: t(`settings.backdropStrength.${value}`),
  }));
  const fontSizeOptions = fontSizeSteps.map((size) => ({ value: `${size}` as const, label: `${size}pt` }));
  const enterOptions = [
    { value: "steer", label: t("settings.enterBehavior.steer") },
    { value: "followUp", label: t("settings.enterBehavior.later") },
  ] as const;
  const idleCloseOptions = (["15m", "1h", "4h", "never"] as const).map((value) => ({
    value,
    label: t(`settings.idleClose.${value}`),
  }));

  return (
    <>
      <SectionHead title={t("settings.appearance")} />
      <ThemeGallery value={settings?.theme ?? "system"} />
      <div className="st-cells">
        <Row label={t("settings.backdrop")}>
          {(labelId) => (
            <>
              <Segmented<BackdropMode>
                size="sm"
                value={backdrop}
                options={backdropOptions}
                labelledBy={labelId}
                // 自选图片还没选过：先弹文件对话框（主进程复制好图再切到 custom；取消返回 false，什么都不改）。
                onChange={(next) =>
                  guard(
                    next === "custom" && (settings?.customBackdrop ?? null) === null
                      ? window.studio.chooseBackdropImage()
                      : window.studio.setBackdrop(next),
                  )
                }
                testId="setting-backdrop"
              />
              {backdrop === "custom" && (
                <Button
                  size="sm"
                  onClick={() => guard(window.studio.chooseBackdropImage())}
                  testId="setting-backdrop-choose"
                >
                  {t("settings.backdrop.choose")}
                </Button>
              )}
            </>
          )}
        </Row>
        {backdrop !== "none" && (
          <Row label={t("settings.backdropStrength")}>
            {(labelId) => (
              <Segmented<BackdropStrength>
                size="sm"
                value={settings?.backdropStrength ?? "medium"}
                options={strengthOptions}
                labelledBy={labelId}
                onChange={(next) => guard(window.studio.setBackdropStrength(next))}
                testId="setting-backdrop-strength"
              />
            )}
          </Row>
        )}
        {glassSupported && (
          <Row label={t("settings.glass")}>
            {(labelId) => (
              <Switch
                checked={settings?.glass ?? false}
                labelledBy={labelId}
                onChange={(next) => guard(window.studio.setGlass(next))}
                testId="setting-glass"
              />
            )}
          </Row>
        )}
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
        <Row label={t("settings.fontSize")}>
          {(labelId) => (
            <Select<`${number}`>
              size="sm"
              value={`${settings?.fontSize ?? defaultFontSize}`}
              options={fontSizeOptions}
              labelledBy={labelId}
              onChange={(next) => void window.studio.setFontSize(Number(next))}
              testId="setting-font-size"
            />
          )}
        </Row>
        <Row label={t("settings.motion")}>
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
      <div className="st-cells" data-testid="notify-settings">
        {notifyItems.map((item) => (
          <ConfigRow key={item.key} item={item} />
        ))}
        <Row label={t("settings.soundOnDone")}>
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
      <div className="st-cells">
        <Row label={t("settings.enterBehavior")}>
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
      <SectionHead title={t("settings.idleTasks")} />
      <div className="st-cells">
        <Row label={t("settings.idleClose")} info={t("settings.idleClose.desc")}>
          {(labelId) => (
            <Select<IdleClose>
              size="sm"
              value={settings?.idleClose ?? "1h"}
              options={idleCloseOptions}
              labelledBy={labelId}
              onChange={(next) => void window.studio.setIdleClose(next)}
              testId="setting-idle-close"
            />
          )}
        </Row>
      </div>
      <section id="settings-shortcuts" tabIndex={-1} className="st-section">
        <SectionHead title={t("settings.shortcuts")} />
        <div className="st-kb-grid">
          {shortcuts.map((shortcut) => (
            <div key={shortcut.label} className="st-kb-row">
              <span>{t(shortcut.label)}</span>
              {shortcutKeys(shortcut.keys.join(" ")).map((key) => (
                <kbd key={key} className="kbd">
                  {key}
                </kbd>
              ))}
            </div>
          ))}
        </div>
        <SectionHead title={t("settings.shortcuts.omp")} />
        <div className="st-kb-grid" data-testid="omp-shortcuts">
          {ompKeybindings.map((binding) => (
            <div key={binding.action} className="st-kb-row" data-testid={`omp-shortcut-${binding.action}`}>
              <span>{t(ompActionLabels[binding.action] ?? "shortcut.ompThinkingCycle")}</span>
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
