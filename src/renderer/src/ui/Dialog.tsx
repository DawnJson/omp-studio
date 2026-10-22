// 对话框（spec §4.23 Dialog）：唯一的外壳。sm 400 / md 520 / lg 720；标题 + 可选一句说明，右上 ×；正文竖排字段；
// 页脚按钮右对齐、取消在前确认在后，附带选项放页脚左侧（footStart）。不叠对话框。
// 选择器类对话框（模型选择）用 head 换掉标题行：顶上是搜索框，标题只作读屏名，没有 ×（Esc、点遮罩关）。
// 行为：Esc 关闭（消耗掉，不触发"停止任务"），Tab 在对话框内循环，打开时焦点进 `[data-autofocus]`（没有就进 ×），
// 关闭时焦点回到打开前的元素；点遮罩关闭。关闭时先放退出动画再卸载，放完调 onExited。
// 焦点掉到 body 时（按下的按钮转成 loading 被禁用、获得焦点的元素被卸载），按键不再经过对话框：
// 窗口捕获阶段兜底，Esc 照样关最上面的对话框，Tab 把焦点拉回对话框。
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/use-t.ts";
import { Close } from "../icons.tsx";
import { Button } from "./controls.tsx";
import { usePresence } from "./presence.ts";
import { useTitleBarDim } from "./title-bar-dim.ts";

const focusableSelector =
  "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])";

/** 打开着的对话框，最后一个在最上面。 */
const openStack: object[] = [];

/** 有对话框开着（页面级的单键快捷键据此让路；焦点掉到 body 时也算）。 */
export function isDialogOpen(): boolean {
  return openStack.length > 0;
}

export interface DialogProps {
  open: boolean;
  onClose(): void;
  title: string;
  /** 标题下一句说明。 */
  desc?: ReactNode | undefined;
  size?: "sm" | "md" | "lg" | undefined;
  /** 标题行下面的标签条（Tabs）。 */
  tabs?: ReactNode | undefined;
  children?: ReactNode | undefined;
  /** 页脚右侧的按钮：取消在前、确认在后。 */
  footer?: ReactNode | undefined;
  /** 页脚左侧的附带选项（如"暂存全部改动"勾选框）。 */
  footStart?: ReactNode | undefined;
  /** 破坏性确认用 alertdialog。 */
  role?: "dialog" | "alertdialog" | undefined;
  /** 退出动画放完、卸载之后调用。 */
  onExited?: (() => void) | undefined;
  testId?: string | undefined;
  /** 外壳上追加的类名（只放尺寸 / 布局，不改控件样式）。 */
  className?: string | undefined;
  /** 标题行右侧、× 之前的图标按钮（如用量对话框的 ↻）。 */
  headAction?: ReactNode | undefined;
  /** 换掉标题行（标题只作读屏名，不显示 ×）：搜索框当顶栏的选择器类对话框用。 */
  head?: ReactNode | undefined;
}

export function Dialog({
  open,
  onClose,
  title,
  desc,
  size = "md",
  tabs,
  children,
  footer,
  footStart,
  role = "dialog",
  onExited,
  testId,
  className,
  headAction,
  head,
}: DialogProps) {
  const t = useT();
  const presence = usePresence(open);
  useTitleBarDim(open);
  const titleId = useId();
  const descId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  const mounted = presence.mounted;
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const wasMounted = useRef(false);

  useEffect(() => {
    if (!mounted) {
      if (wasMounted.current) onExitedRef.current?.();
      wasMounted.current = false;
      return;
    }
    wasMounted.current = true;
    openerRef.current = document.activeElement;
    const target =
      ref.current?.querySelector<HTMLElement>("[data-autofocus]") ??
      ref.current?.querySelector<HTMLElement>("[data-dialog-close]");
    target?.focus();
    // 只在挂载时抢一次焦点。
  }, [mounted]);
  // 开始退出动画就还焦点，不等卸载。
  useEffect(() => {
    if (open) return;
    const opener = openerRef.current;
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const entry = {};
    openStack.push(entry);
    const onLostFocusKey = (event: globalThis.KeyboardEvent) => {
      if (openStack.at(-1) !== entry) return;
      const active = document.activeElement;
      if (active !== null && active !== document.body) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      } else if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        ref.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
      }
    };
    window.addEventListener("keydown", onLostFocusKey, true);
    return () => {
      window.removeEventListener("keydown", onLostFocusKey, true);
      openStack.splice(openStack.indexOf(entry), 1);
    };
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
        className={className ? `ui-dialog ${className}` : "ui-dialog"}
        data-size={size === "md" ? undefined : size}
        role={role}
        aria-modal="true"
        aria-labelledby={head === undefined ? titleId : undefined}
        aria-label={head === undefined ? undefined : title}
        aria-describedby={desc === undefined ? undefined : descId}
        data-testid={testId}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        {...presence.exitProps}
      >
        {head ?? (
          <header className="ui-dialog-head">
            <div>
              <h2 id={titleId} className="ui-dialog-title">
                {title}
              </h2>
              {desc !== undefined && (
                <p id={descId} className="ui-dialog-desc">
                  {desc}
                </p>
              )}
            </div>
            {headAction}
            <button
              type="button"
              className="ui-icon-btn"
              data-dialog-close=""
              aria-label={t("common.close")}
              title={t("common.close")}
              onClick={onClose}
              data-testid={testId === undefined ? undefined : `${testId}-close`}
            >
              <Close />
            </button>
          </header>
        )}
        {tabs}
        {children !== undefined && <div className="ui-dialog-body">{children}</div>}
        {(footer !== undefined || footStart !== undefined) && (
          <footer className="ui-dialog-foot">
            {footStart !== undefined && <span className="ui-foot-start">{footStart}</span>}
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * 确认框：sm 宽的同一外壳。挂上就是打开；点按钮 / Esc / × 后先放退出动画，放完才调 onConfirm / onCancel（调用方据此卸载）。
 * 打开时焦点在"取消"；danger 时确认键用 danger-solid（破坏性操作）。
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onCancel,
  testId,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string | undefined;
  danger?: boolean | undefined;
  onConfirm(): void;
  onCancel(): void;
  testId?: string | undefined;
}) {
  const t = useT();
  const [decision, setDecision] = useState<"confirm" | "cancel" | null>(null);
  const decide = (next: "confirm" | "cancel") => {
    if (decision === null) setDecision(next);
  };
  return (
    <Dialog
      open={decision === null}
      onClose={() => decide("cancel")}
      onExited={() => (decision === "confirm" ? onConfirm() : onCancel())}
      title={title}
      desc={body}
      size="sm"
      role={danger ? "alertdialog" : "dialog"}
      testId={testId}
      footer={
        <>
          <Button data-autofocus="" onClick={() => decide("cancel")} testId={testId && `${testId}-cancel`}>
            {cancelLabel ?? t("common.cancel")}
          </Button>
          <Button
            variant={danger ? "danger-solid" : "primary"}
            onClick={() => decide("confirm")}
            testId={testId && `${testId}-confirm`}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
