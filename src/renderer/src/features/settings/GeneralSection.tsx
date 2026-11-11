// 设置 -> 通用：外观（主题画廊；背景图、浓度、毛玻璃、语言、字号、减少动效、选中即复制）；桌面宠物（显示、说话、花费）；通知与回顾（omp 的 ask / completion / error 通知、空闲回顾 + studio 的完成提示音）；
// 任务运行中发消息的方式（studio 的 Enter + omp 的插话/稍后处理方式）；空闲任务多久关进程；终端 shell；快捷键（只读；studio 的键，加转发给 omp 的键）。
// 各组共用一套列（Cells.tsx 的 Groups），只占一行的小组并排；格子排法见 settings.css 的 .st-cells。
import { Fragment, useEffect, useState } from "react";
import {
  defaultFontSize,
  fontSizeSteps,
  type BackdropMode,
  type BackdropStrength,
  type IdleClose,
  type LocalePreference,
  type TerminalShellOption,
} from "../../../../shared/ipc.ts";
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import type { PetSpend, VoiceSpend } from "../../../../shared/pet/model.ts";
import { chordKeys } from "../../../../shared/tsp/omp-keybindings.ts";
import { useT } from "../../i18n/use-t.ts";
import { shortcutKeys } from "../../app/platform-keys.ts";
import { useAppInfo, useSettings } from "../../store/index.ts";
import { Badge, Button, Row, SectionHead, Segmented, Switch } from "../../ui/controls.tsx";
import { reportError } from "../../ui/errors.ts";
import { Select } from "../../ui/Select.tsx";
import { formatCount, formatMoney } from "../composer/usage-format.ts";
import { Cells, Group, Groups } from "./Cells.tsx";
import { ConfigRow } from "./ConfigRow.tsx";
import { systemReducesMotion } from "./motion-preference.ts";
import { refreshOmpKeybindings, useOmpKeybindings } from "./omp-keybindings-store.ts";
import { useCommonConfigItems } from "./OmpConfigPane.tsx";
import { ThemeGallery } from "./ThemeGallery.tsx";

/** 宠物调模型的花费：打开设置页时读一次（docs/architecture/pet.md「花费」）；宠物没启动过时 null，不显示。 */
function usePetSpend(): PetSpend | null {
  const [spend, setSpend] = useState<PetSpend | null>(null);
  useEffect(() => {
    let live = true;
    window.studio.getPetSpend().then(
      (next) => live && setSpend(next),
      (error: unknown) => console.error("getPetSpend failed", error),
    );
    return () => {
      live = false;
    };
  }, []);
  return spend;
}

function SpendRow({ label, spend, testId }: { label: string; spend: VoiceSpend; testId: string }) {
  const t = useT();
  return (
    <Row label={label} testId={testId}>
      {() =>
        t("settings.pet.spend", {
          calls: spend.calls,
          tokens: formatCount(spend.tokens),
          cost: formatMoney(spend.cost),
        })
      }
    </Row>
  );
}

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
  { label: "shortcut.prevNextTurn", keys: ["Ctrl", "Shift", "↑ / ↓"] },
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
  const petSpend = usePetSpend();
  const glassSupported = useAppInfo()?.glassSupported ?? false;
  const systemMotion = systemReducesMotion();
  const guard = (promise: Promise<unknown>) => void promise.catch((error: unknown) => reportError(t, error));
  // omp 的插话 / 稍后消息处理方式（"对话行为"组的常用项），和 Enter 的行为放在一起。
  const behavior = useCommonConfigItems("behavior");
  const notifyItems = behavior.filter((item) => notifyKeys.has(item.key));
  const whileRunning = behavior.filter((item) => !notifyKeys.has(item.key));
  const ompKeybindings = useOmpKeybindings();
  useEffect(() => void refreshOmpKeybindings(), []);
  // 本机可选的终端 shell：打开设置页时检测一次（主进程只接受这个列表里的路径）。
  const [shells, setShells] = useState<readonly TerminalShellOption[]>([]);
  useEffect(() => {
    let live = true;
    window.studio
      .listTerminalShells()
      .then((list) => live && setShells(list))
      .catch((error: unknown) => reportError(t, error));
    return () => {
      live = false;
    };
  }, [t]);

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
  const terminalShell = settings?.terminalShell ?? null;
  const shellOptions = [
    { value: "", label: t("settings.terminalShell.auto") },
    ...shells.map((shell) => ({ value: shell.path, label: shell.name })),
    // 文件对话框选的、不在检测列表里的：照样列出来，显示文件名。
    ...(terminalShell !== null && !shells.some((shell) => shell.path === terminalShell)
      ? [{ value: terminalShell, label: terminalShell.split(/[\\/]/).pop() ?? terminalShell }]
      : []),
  ];

  return (
    <Groups>
      <Group packable={false}>
        <SectionHead title={t("settings.appearance")} />
        <ThemeGallery value={settings?.theme ?? "system"} />
        <Cells>
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
          <Row label={t("settings.toolHeadsOnly")}>
            {(labelId) => (
              <Switch
                checked={settings?.toolHeadsOnly ?? false}
                labelledBy={labelId}
                onChange={(next) => void window.studio.setToolHeadsOnly(next)}
                testId="setting-tool-heads-only"
              />
            )}
          </Row>
          <Row label={t("settings.groupToolCalls")}>
            {(labelId) => (
              <Switch
                checked={settings?.groupToolCalls ?? true}
                labelledBy={labelId}
                onChange={(next) => void window.studio.setGroupToolCalls(next)}
                testId="setting-group-tool-calls"
              />
            )}
          </Row>
        </Cells>
      </Group>
      <Group>
        <SectionHead title={t("settings.pet")} />
        <Cells>
          <Row label={t("settings.pet.enabled")}>
            {(labelId) => (
              <Switch
                checked={settings?.petEnabled ?? true}
                labelledBy={labelId}
                onChange={(next) => guard(window.studio.setPetEnabled(next))}
                testId="setting-pet-enabled"
              />
            )}
          </Row>
          <Row label={t("settings.pet.talk")}>
            {(labelId) => (
              <Switch
                checked={settings?.petTalk ?? true}
                labelledBy={labelId}
                onChange={(next) => guard(window.studio.setPetTalk(next))}
                testId="setting-pet-talk"
              />
            )}
          </Row>
          {/* 数组不用 Fragment：Cells 按直接子元素排格子（Children.toArray 会展开数组）。 */}
          {petSpend !== null && [
            <SpendRow
              key="spent-today"
              label={t("settings.pet.spentToday")}
              spend={petSpend.today}
              testId="setting-pet-spent-today"
            />,
            <SpendRow
              key="spent-total"
              label={t("settings.pet.spentTotal")}
              spend={petSpend.total}
              testId="setting-pet-spent-total"
            />,
          ]}
        </Cells>
      </Group>
      <Group>
        <SectionHead title={t("settings.notifications")} />
        <Cells testId="notify-settings">
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
        </Cells>
      </Group>
      <Group>
        <SectionHead title={t("settings.whileRunning")} />
        <Cells>
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
        </Cells>
      </Group>
      <Group>
        <SectionHead title={t("settings.idleTasks")} />
        <Cells>
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
        </Cells>
      </Group>
      <Group>
        <SectionHead title={t("settings.terminal")} />
        <Cells>
          <Row label={t("settings.terminalShell")}>
            {(labelId) => (
              <>
                <Select<string>
                  size="sm"
                  value={terminalShell ?? ""}
                  options={shellOptions}
                  labelledBy={labelId}
                  onChange={(next) => guard(window.studio.setTerminalShell(next === "" ? null : next))}
                  testId="setting-terminal-shell"
                />
                <Button
                  size="sm"
                  onClick={() => guard(window.studio.chooseTerminalShell())}
                  testId="setting-terminal-shell-choose"
                >
                  {t("settings.terminalShell.choose")}
                </Button>
              </>
            )}
          </Row>
        </Cells>
      </Group>
      <Group id="settings-shortcuts" tabIndex={-1} packable={false}>
        <SectionHead title={t("settings.shortcuts")} />
        <Cells className="st-kb-grid">
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
        </Cells>
        <SectionHead title={t("settings.shortcuts.omp")} />
        <Cells className="st-kb-grid" testId="omp-shortcuts">
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
        </Cells>
      </Group>
    </Groups>
  );
}
