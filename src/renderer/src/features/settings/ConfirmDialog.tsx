// 确认对话框（spec §4.23 Dialog）：打开时焦点在"取消"，Tab 在两个按钮间循环，Esc 取消，关闭后焦点回到触发它的元素。
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTitleBarDim } from "../../ui/title-bar-dim.ts";
import { usePresence } from "../../ui/presence.ts";
import { Button } from "./controls.tsx";

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm(): void;
  onCancel(): void;
}

export function ConfirmDialog({ title, body, confirmLabel, cancelLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const trigger = useRef<Element | null>(null);
  const restored = useRef(false);
  // 点按钮 / Esc 后先放退出动画，动画放完才把 onConfirm / onCancel 交给调用方（调用方据此卸载）。
  const [decision, setDecision] = useState<"confirm" | "cancel" | null>(null);
  const presence = usePresence(decision === null);
  useTitleBarDim(decision === null);

  const restoreFocus = () => {
    if (restored.current) return;
    restored.current = true;
    if (trigger.current instanceof HTMLElement && trigger.current.isConnected) trigger.current.focus();
  };

  useEffect(() => {
    trigger.current = document.activeElement;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return restoreFocus;
  }, []);

  const decide = (next: "confirm" | "cancel") => {
    if (decision !== null) return;
    setDecision(next);
    restoreFocus();
  };

  useEffect(() => {
    if (decision === null || presence.mounted) return;
    if (decision === "confirm") onConfirm();
    else onCancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decision, presence.mounted]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      decide("cancel");
      return;
    }
    if (event.key !== "Tab") return;
    // 焦点陷阱：只有两个按钮，Tab 在它们之间循环。
    const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <div className="st-scrim" data-closing={presence.closing ? "fade" : undefined} onKeyDown={onKeyDown}>
      <div
        ref={dialog}
        className="st-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        {...presence.exitProps}
      >
        <h2>{title}</h2>
        <p>{body}</p>
        <div className="st-dialog-actions">
          <Button onClick={() => decide("cancel")}>{cancelLabel}</Button>
          <Button variant="primary" onClick={() => decide("confirm")}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
