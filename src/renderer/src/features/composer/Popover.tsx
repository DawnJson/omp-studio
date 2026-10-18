// 自胶囊上方弹出的浮层。点外面、Esc 关闭（Esc 消耗掉，不会再触发"停止"）；关闭后焦点回到触发器。
import { useEffect, useRef, type ReactNode } from "react";

interface PopoverProps {
  open: boolean;
  onClose(): void;
  children: ReactNode;
  width?: number | undefined;
  align?: "start" | "end";
  label: string;
}

export function Popover({ open, onClose, children, width, align = "start", label }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement;
    const onPointerDown = (event: PointerEvent) => {
      const anchor = ref.current?.parentElement;
      if (event.target instanceof Node && anchor && !anchor.contains(event.target)) onClose();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      if (trigger instanceof HTMLElement && trigger.isConnected && (document.activeElement === document.body || ref.current?.contains(document.activeElement))) trigger.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      className="pop"
      role="dialog"
      aria-label={label}
      data-align={align}
      style={width ? { width } : undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {children}
    </div>
  );
}
