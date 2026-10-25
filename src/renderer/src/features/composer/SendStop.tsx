// 发送 / 停止按钮（spec 4.14 状态表）：运行中只有"停止"，插话 / 稍后发用 Enter / Ctrl+Enter，键位写在停止键的悬停提示里
// （2026-10-25 仓库所有者：运行中不要再并排一个发送键和发送方式下拉）；不在运行就是发送键。
import { useT } from "../../i18n/use-t.ts";
import { localizeKeys } from "../../app/platform-keys.ts";
import { ArrowUp } from "../../icons.tsx";

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
  if (running)
    return (
      <button
        type="button"
        className="send"
        data-kind="stop"
        disabled={stopping}
        aria-label={stopping ? t("composer.stopping") : t("composer.stop")}
        title={
          stopping
            ? t("composer.stopping")
            : `${t("composer.stop")} · ${localizeKeys(t(swapped ? "composer.sendKeysSwapped" : "composer.sendKeys"))}`
        }
        data-testid="stop-button"
        onClick={onStop}
      >
        <span className="send-square" aria-hidden="true" />
      </button>
    );
  return (
    <button
      type="button"
      className="send"
      data-kind="send"
      disabled={disabled || !hasContent}
      aria-label={t("composer.send")}
      title={t("composer.send")}
      data-testid="send-button"
      onClick={onSend}
    >
      <ArrowUp size={16} />
    </button>
  );
}
