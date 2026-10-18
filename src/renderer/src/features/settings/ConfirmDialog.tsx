// 确认对话框（spec §4.23 Dialog）：打开时焦点在"取消"，Tab 在两个按钮间循环，Esc 取消，关闭后焦点回到触发它的元素。
import { useEffect, useRef, type KeyboardEvent } from "react";
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

  useEffect(() => {
    const trigger = document.activeElement;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      if (trigger instanceof HTMLElement) trigger.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onCancel();
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
    <div className="st-scrim" onKeyDown={onKeyDown}>
      <div ref={dialog} className="st-dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <p>{body}</p>
        <div className="st-dialog-actions">
          <Button onClick={onCancel}>{cancelLabel}</Button>
          <Button variant="primary" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
