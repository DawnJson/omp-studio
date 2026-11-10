// 发送 / 停止按钮（spec 4.14 状态表）：运行中只有"停止"，插话 / 稍后发用 Enter / Ctrl+Enter，键位写在停止键的悬停提示里
// （2026-10-25 仓库所有者：运行中不要再并排一个发送键和发送方式下拉）；不在运行就是发送键。
// 两种状态是同一个按钮、同一个图标元素：↑ 和 ■ 之间按弹簧形变（ui/MorphIcon.tsx）。
import { useT } from "../../i18n/use-t.ts";
import { localizeKeys } from "../../app/platform-keys.ts";
import { MorphIcon } from "../../ui/MorphIcon.tsx";
import { ARROW_UP_GLYPH, STOP_GLYPH } from "../../ui/morph-glyphs.ts";

interface SendStopProps {
  running: boolean;
  stopping: boolean;
  hasContent: boolean;
  disabled: boolean;
  /** Enter 和 Ctrl+Enter 的含义对调了（设置里的"运行中按 Enter"），只影响停止键的悬停提示。 */
  swapped?: boolean;
  onSend(): void;
  onStop(): void;
}

export function SendStop({ running, stopping, hasContent, disabled, swapped = false, onSend, onStop }: SendStopProps) {
  const t = useT();
  const label = running ? (stopping ? t("composer.stopping") : t("composer.stop")) : t("composer.send");
  return (
    <button
      type="button"
      className="send"
      data-kind={running ? "stop" : "send"}
      disabled={running ? stopping : disabled || !hasContent}
      aria-label={label}
      title={
        running && !stopping
          ? `${label} · ${localizeKeys(t(swapped ? "composer.sendKeysSwapped" : "composer.sendKeys"))}`
          : label
      }
      data-testid={running ? "stop-button" : "send-button"}
      onClick={running ? onStop : onSend}
    >
      <MorphIcon glyph={running ? STOP_GLYPH : ARROW_UP_GLYPH} />
    </button>
  );
}
