// 会话信息和分享两个对话框共用的外壳（和 git/GitDialogs 的 Shell 同一套行为）：Esc 关闭（消耗掉，不触发"停止任务"），
// Tab 在对话框内循环，打开时焦点进 `[data-autofocus]`（没有就进关闭按钮），关闭时焦点回到打开前的元素；点遮罩关闭。
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../i18n/use-t.ts";
import { Close } from "../../icons.tsx";
import { usePresence } from "../../ui/presence.ts";
import { useTitleBarDim } from "../../ui/title-bar-dim.ts";
import "./session-info.css";

const focusableSelector = "button:not(:disabled), input:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])";

export function DialogShell({
  title,
  testId,
  wide,
  open,
  onClose,
  children,
  footer,
  tabs,
}: {
  title: string;
  testId: string;
  /** 请求记录页签要宽一些。 */
  wide?: boolean;
  /** 关闭时先放完退出动画再卸载（调用方一直渲染着，靠 open 切换）。 */
  open: boolean;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  /** 标题行下面的页签条。 */
  tabs?: ReactNode;
}) {
  const t = useT();
  const presence = usePresence(open);
  useTitleBarDim(open);
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  const mounted = presence.mounted;

  useEffect(() => {
    if (!mounted) return;
    openerRef.current = document.activeElement;
    const target =
      ref.current?.querySelector<HTMLElement>("[data-autofocus]") ??
      ref.current?.querySelector<HTMLElement>("[data-si-close]");
    target?.focus();
    // 只在挂载时抢一次焦点。
  }, [mounted]);
  // 开始退出动画就还焦点，不等卸载。
  useEffect(() => {
    if (open) return;
    const opener = openerRef.current;
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  }, [open]);

  if (!mounted) return null;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])];
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="scrim" data-closing={presence.closing ? "fade" : undefined} onPointerDown={onClose}>
      <div
        ref={ref}
        className="si-dialog"
        data-wide={wide || undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        {...presence.exitProps}
      >
        <header className="si-head">
          <h2 id={titleId} className="si-title">
            {title}
          </h2>
          <button type="button" className="tool-btn" data-si-close aria-label={t("common.close")} onClick={onClose}>
            <Close size={14} />
          </button>
        </header>
        {tabs}
        <div className="si-body">{children}</div>
        {footer !== undefined && <footer className="si-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
