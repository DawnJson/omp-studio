// 发送键左边的"优化提示词"（✦，不带箭头）：28×28 图标按钮。
// - 点击：直接按当前风格与上下文一键优化（优化中 ✦ 形变成 ×，再点 = 停止）。
// - 悬停停顿（240ms）/ 右键 / 键盘 ↑：向上浮出风格与上下文面板（Popover），点内置风格即保存并立即优化，
//   点「自定义要求」展开紧凑输入栏；非默认风格或开启 Git 文件时按钮右上角亮一个小圆点（同会话开关规范）。
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import {
  PROMPT_ENHANCE_CUSTOM_MAX_CHARS,
  PROMPT_ENHANCE_STYLES,
  type PromptEnhanceStyle,
} from "../../../../shared/prompt-enhance.ts";
import { withShortcut } from "../../app/platform-keys.ts";
import { useT } from "../../i18n/use-t.ts";
import { Check } from "../../icons.tsx";
import { IconButton, Switch } from "../../ui/controls.tsx";
import { MorphIcon } from "../../ui/MorphIcon.tsx";
import { CLOSE_GLYPH, SPARKLE_GLYPH } from "../../ui/morph-glyphs.ts";
import { Popover } from "../../ui/Popover.tsx";
import type { PromptEnhance } from "./use-prompt-enhance.ts";

const HOVER_OPEN_MS = 240;
const HOVER_CLOSE_MS = 180;

const STYLE_LABELS: Record<PromptEnhanceStyle, { label: MessageKey; tip: MessageKey }> = {
  polish: { label: "composer.enhance.style.polish", tip: "composer.enhance.style.polishTip" },
  spec: { label: "composer.enhance.style.spec", tip: "composer.enhance.style.specTip" },
  debug: { label: "composer.enhance.style.debug", tip: "composer.enhance.style.debugTip" },
  concise: { label: "composer.enhance.style.concise", tip: "composer.enhance.style.conciseTip" },
  custom: { label: "composer.enhance.style.custom", tip: "composer.enhance.style.customTip" },
};

export function EnhanceButton({
  enhance,
  disabled,
  isTask,
}: {
  enhance: PromptEnhance;
  disabled: boolean;
  isTask: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState(enhance.settings.customInstruction);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customRef = useRef<HTMLTextAreaElement>(null);
  const editingCustom = useRef(false);
  const focusCustom = useRef(false);

  // 同步外部（另一窗口/设置事件）更新的自定义文案。
  useEffect(() => {
    if (!editingCustom.current) setCustomDraft(enhance.settings.customInstruction);
  }, [enhance.settings.customInstruction]);

  // 刚切到 custom（异步经 IPC 更新 settings）挂载完输入框后立刻聚焦。
  useEffect(() => {
    if (open && enhance.settings.style === "custom" && focusCustom.current) {
      focusCustom.current = false;
      customRef.current?.focus();
    }
  }, [open, enhance.settings.style]);

  const clearTimers = () => {
    if (openTimer.current !== null) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  useEffect(() => clearTimers, []);

  // 开始优化时立刻收起浮层。
  useEffect(() => {
    if (enhance.busy) {
      clearTimers();
      setOpen(false);
    }
  }, [enhance.busy]);

  const commitCustom = (value: string) => {
    const trimmed = value.slice(0, PROMPT_ENHANCE_CUSTOM_MAX_CHARS);
    if (trimmed !== enhance.settings.customInstruction) enhance.updateSettings({ customInstruction: trimmed });
  };

  const closePopover = () => {
    clearTimers();
    commitCustom(customDraft);
    setOpen(false);
  };

  const onEnter = () => {
    if (enhance.busy || disabled) return;
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (open || openTimer.current !== null) return;
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      setOpen(true);
    }, HOVER_OPEN_MS);
  };

  const onLeave = () => {
    if (openTimer.current !== null) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    // 正在浮层里输入自定义要求时不因鼠标移开而关掉。
    if (!open || editingCustom.current) return;
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      closePopover();
    }, HOVER_CLOSE_MS);
  };

  const onButtonClick = () => {
    clearTimers();
    if (open) closePopover();
    enhance.toggle();
  };

  const onAnchorContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (enhance.busy || disabled) return;
    event.preventDefault();
    clearTimers();
    if (open) closePopover();
    else setOpen(true);
  };

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (enhance.busy || disabled) return;
    if (event.key === "ArrowUp" || (event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
      event.preventDefault();
      clearTimers();
      setOpen(true);
    }
  };

  const pickStyle = (style: PromptEnhanceStyle) => {
    enhance.updateSettings({ style });
    if (style === "custom") {
      // 选自定义要求时留在浮层里并聚焦输入框，写完按 Enter 或点 ✦ 触发。
      if (enhance.settings.style === "custom") customRef.current?.focus();
      else focusCustom.current = true;
      return;
    }
    closePopover();
    if (!disabled && enhance.ready) enhance.start({ style });
  };

  const { settings } = enhance;
  const differs = settings.style !== "polish" || settings.includeGit;
  const label = enhance.busy ? t("composer.enhance.stop") : t("composer.enhance");
  const tip = enhance.busy
    ? withShortcut(t("composer.enhance.stop"), "Esc")
    : withShortcut(`${t("composer.enhance")} · ${t(STYLE_LABELS[settings.style].label)}`, "Alt E");

  return (
    <div
      className="ui-popover-anchor enhance-anchor"
      data-testid="enhance-anchor"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onContextMenu={onAnchorContextMenu}
    >
      <IconButton
        label={label}
        tip={open ? "" : tip}
        className="enhance-btn"
        testId="enhance-button"
        data-busy={enhance.busy ? "" : undefined}
        data-differs={differs && !enhance.busy ? "" : undefined}
        aria-busy={enhance.busy || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!enhance.busy && (disabled || !enhance.ready)}
        onClick={onButtonClick}
        onKeyDown={onButtonKeyDown}
      >
        <MorphIcon glyph={enhance.busy ? CLOSE_GLYPH : SPARKLE_GLYPH} />
      </IconButton>
      <Popover open={open} onClose={closePopover} label={t("composer.enhance.menu")} align="end" width={264}>
        <div className="enhance-menu" data-testid="enhance-menu">
          <div className="enhance-styles" role="radiogroup" aria-label={t("composer.enhance.menu")}>
            {PROMPT_ENHANCE_STYLES.map((style) => {
              const selected = settings.style === style;
              return (
                <button
                  key={style}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className="enhance-style-row"
                  data-testid={`enhance-style-${style}`}
                  title={t(STYLE_LABELS[style].tip)}
                  onClick={() => pickStyle(style)}
                >
                  <span>{t(STYLE_LABELS[style].label)}</span>
                  <span className="enhance-style-check" aria-hidden="true">
                    {selected && <Check size={14} />}
                  </span>
                </button>
              );
            })}
          </div>
          {settings.style === "custom" && (
            <div className="enhance-custom">
              <textarea
                ref={customRef}
                className="enhance-custom-input"
                data-testid="enhance-custom-input"
                rows={2}
                maxLength={PROMPT_ENHANCE_CUSTOM_MAX_CHARS}
                value={customDraft}
                placeholder={t("composer.enhance.customPlaceholder")}
                aria-label={t("composer.enhance.style.custom")}
                onFocus={() => {
                  editingCustom.current = true;
                  if (closeTimer.current !== null) {
                    clearTimeout(closeTimer.current);
                    closeTimer.current = null;
                  }
                }}
                onBlur={() => {
                  editingCustom.current = false;
                  commitCustom(customDraft);
                }}
                onChange={(event) => setCustomDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    const next = event.currentTarget.value.slice(0, PROMPT_ENHANCE_CUSTOM_MAX_CHARS);
                    editingCustom.current = false;
                    commitCustom(next);
                    setOpen(false);
                    if (!disabled && enhance.ready) enhance.start({ style: "custom", customInstruction: next });
                  }
                }}
              />
            </div>
          )}
          <div className="enhance-divider" role="separator" />
          <div
            className="enhance-toggle-row"
            data-disabled={!isTask || undefined}
            title={t("composer.enhance.context.historyTip")}
          >
            <span id="enhance-ctx-history" className="enhance-toggle-label">
              {t("composer.enhance.context.history")}
            </span>
            <Switch
              checked={isTask && settings.includeHistory}
              disabled={!isTask}
              labelledBy="enhance-ctx-history"
              testId="enhance-ctx-history"
              onChange={(next) => enhance.updateSettings({ includeHistory: next })}
            />
          </div>
          <div className="enhance-toggle-row" title={t("composer.enhance.context.gitTip")}>
            <span id="enhance-ctx-git" className="enhance-toggle-label">
              {t("composer.enhance.context.git")}
            </span>
            <Switch
              checked={settings.includeGit}
              labelledBy="enhance-ctx-git"
              testId="enhance-ctx-git"
              onChange={(next) => enhance.updateSettings({ includeGit: next })}
            />
          </div>
        </div>
      </Popover>
    </div>
  );
}
