// 发送 / 停止按钮（spec 4.14 状态表）：运行中输入非空时并排显示"停止"和"发送"，发送键右边一个小下拉：
// "插话"（steer，发送键本身的动作）/ "等这一轮结束再发"（follow-up = omp 的 `/queue`）。
import { useState } from "react";
import { useT } from "../../i18n/use-t.ts";
import { localizeKeys } from "../../app/platform-keys.ts";
import { ArrowUp, ChevronDown } from "../../icons.tsx";
import { anchorBelow, Menu, type MenuAnchor } from "../../ui/Menu.tsx";

interface SendStopProps {
  running: boolean;
  stopping: boolean;
  hasContent: boolean;
  disabled: boolean;
  /** Enter 和 Ctrl+Enter 的含义对调了（设置里的"运行中按 Enter"），只影响发送键的悬停提示。 */
  swapped?: boolean;
  onSend(): void;
  /** 运行中"等这一轮结束再发"；不给就没有发送方式下拉（草稿页永远不在运行中）。 */
  onSendLater?: () => void;
  onStop(): void;
}

export function SendStop({
  running,
  stopping,
  hasContent,
  disabled,
  swapped = false,
  onSend,
  onSendLater,
  onStop,
}: SendStopProps) {
  const t = useT();
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
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
      title={
        running
          ? `${t("composer.send")} · ${localizeKeys(t(swapped ? "composer.sendKeysSwapped" : "composer.sendKeys"))}`
          : t("composer.send")
      }
      data-testid="send-button"
      onClick={onSend}
    >
      <ArrowUp size={16} />
    </button>
  );
  if (running && !hasContent) return stop;
  if (!running) return send;
  return (
    <>
      {stop}
      {send}
      {onSendLater !== undefined && (
        <button
          type="button"
          className="send-more"
          disabled={disabled}
          aria-label={t("composer.sendMode")}
          title={t("composer.sendMode")}
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          data-testid="send-mode"
          onClick={(event) => setMenu(anchorBelow(event.currentTarget))}
        >
          <ChevronDown size={12} />
        </button>
      )}
      {menu !== null && onSendLater !== undefined && (
        <Menu
          anchor={menu}
          label={t("composer.sendMode")}
          testId="send-mode-menu"
          onClose={() => setMenu(null)}
          items={[
            {
              id: "steer",
              label: t("composer.sendSteer"),
              note: t("composer.sendSteerNote"),
              testId: "send-mode-steer",
              onSelect: onSend,
            },
            {
              id: "later",
              label: t("composer.sendLater"),
              testId: "send-mode-later",
              onSelect: onSendLater,
            },
          ]}
        />
      )}
    </>
  );
}
