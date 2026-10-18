// 发送 / 停止按钮（spec 4.14 状态表）：运行中输入非空时并排显示"停止"和"发送"。
import { useT } from "../../i18n/use-t.ts";
import { ArrowUp } from "../../icons.tsx";

interface SendStopProps {
  running: boolean;
  stopping: boolean;
  hasContent: boolean;
  disabled: boolean;
  onSend(): void;
  onStop(): void;
}

export function SendStop({ running, stopping, hasContent, disabled, onSend, onStop }: SendStopProps) {
  const t = useT();
  const stop = (
    <button
      type="button"
      className="send"
      data-kind="stop"
      data-outline={hasContent || undefined}
      disabled={stopping}
      aria-label={stopping ? t("composer.stopping") : t("composer.stop")}
      title={stopping ? t("composer.stopping") : t("composer.stop")}
      data-testid="stop-button"
      onClick={onStop}
    >
      <span className="send-square" aria-hidden="true" />
    </button>
  );
  const send = (
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
  if (running && !hasContent) return stop;
  if (running)
    return (
      <>
        {stop}
        {send}
      </>
    );
  return send;
}
