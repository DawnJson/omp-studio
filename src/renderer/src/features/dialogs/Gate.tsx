// 门（spec 4.17）：停靠在输入框上方，不模态、不遮罩。这里是外壳：标题、计时、焦点规则、键盘；正文由各 method 的组件提供。
import { reportError } from "../../ui/errors.ts";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import type { DialogRequest, DialogResponse, TaskId } from "../../../../shared/ipc.ts";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import { useT } from "../../i18n/use-t.ts";
import { msSinceLastKey } from "./activity.ts";
import { approvalTool, denyOption, splitTitle } from "./approval-labels.ts";
import { remainingMs } from "./gate-timer.ts";
import { clearAskDraft } from "./ask-draft-store.ts";
import { markAnswered, registerGateControl } from "./gate-bus.ts";
import { GateAsk } from "./GateAsk.tsx";
import { GateConfirm } from "./GateConfirm.tsx";
import { GateSelect } from "./GateSelect.tsx";
import { GateText } from "./GateText.tsx";
import "./dialogs.css";

export interface GateBodyProps<D extends DialogRequest = DialogRequest> {
  dialog: D;
  busy: boolean;
  respond(response: DialogResponse): void;
  /** 正文把"主操作"挂在这里，Ctrl+Enter 调用。 */
  primaryRef: MutableRefObject<(() => void) | null>;
}

function dialogTitle(dialog: DialogRequest, fallback: string, t: TFunction): string {
  if (dialog.kind === "ask") return fallback;
  if (dialog.kind === "select" && dialog.approval) {
    const headline = splitTitle(dialog.title).headline;
    const tool = approvalTool(headline);
    return tool === null ? headline : t("gate.allowToolTitle", { tool });
  }
  return dialog.title;
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function useRemainingMs(timeoutMs: number | undefined, receivedAt: number): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (timeoutMs === undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [timeoutMs]);
  return timeoutMs === undefined ? null : remainingMs(timeoutMs, receivedAt, now);
}

function timeoutOf(dialog: DialogRequest): number | undefined {
  return dialog.kind === "editor" ? undefined : dialog.timeoutMs;
}

export function Gate({ taskId, dialog, pending }: { taskId: TaskId; dialog: DialogRequest; pending: number }) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<(() => void) | null>(null);
  const [openedAt] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [pulse, setPulse] = useState(false);
  const timeoutMs = timeoutOf(dialog);
  // 没有 receivedAt（旧主进程）时退回到第一次渲染的时间。
  const [fallbackAt] = useState(() => Date.now());
  const receivedAt = dialog.receivedAt ?? fallbackAt;
  // 顶边线的起点只算一次：重渲染不能让动画重新开始或抖动。
  const [timerDelayMs] = useState(() => Math.min(timeoutOf(dialog) ?? 0, Date.now() - receivedAt));
  const remaining = useRemainingMs(timeoutMs, receivedAt);

  const respond = useCallback(
    (response: DialogResponse) => {
      setBusy(true);
      markAnswered(dialog.id);
      window.studio.respondDialog(taskId, dialog.id, response).then(
        () => clearAskDraft(dialog.id),
        (error: unknown) => {
          setBusy(false);
          reportError(t, error);
        },
      );
    },
    [taskId, dialog.id, t],
  );

  const cancel = useCallback(() => {
    if (dialog.kind === "confirm") respond({ kind: "confirm", confirmed: false });
    else respond({ kind: "cancel" });
  }, [dialog.kind, respond]);

  // 焦点：打字中或输入框有草稿就不抢，只脉冲一次；否则落到门。关闭后回到出现前的元素。
  useEffect(() => {
    const root = rootRef.current;
    const previous = document.activeElement;
    const active = document.activeElement;
    const composing =
      active instanceof HTMLTextAreaElement && active.hasAttribute("data-composer-input") && active.value !== "";
    if (msSinceLastKey() < 1500 || composing) setPulse(true);
    else root?.focus();
    return () => {
      const current = document.activeElement;
      // root 在 effect 开始时取：卸载时 React 已经把 rootRef.current 清成 null。
      if (current === document.body || root?.contains(current)) {
        const target =
          previous instanceof HTMLElement && previous.isConnected && !root?.contains(previous)
            ? previous
            : document.querySelector<HTMLElement>("[data-composer-input]");
        target?.focus();
      }
    };
  }, []);

  useEffect(() => {
    registerGateControl({
      primary: () => {
        if (Date.now() - openedAt >= 500) primaryRef.current?.();
      },
      deny: async () => {
        markAnswered(dialog.id);
        const deny =
          dialog.kind === "select" && dialog.approval ? denyOption(dialog.options.map((option) => option.label)) : null;
        await window.studio.respondDialog(
          taskId,
          dialog.id,
          deny !== null ? { kind: "value", value: deny } : { kind: "cancel" },
        );
      },
      focus: () => rootRef.current?.focus(),
    });
    return () => registerGateControl(null);
  }, [taskId, dialog, openedAt]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    } else if (event.key === "Enter" && event.ctrlKey) {
      event.preventDefault();
      if (Date.now() - openedAt >= 500) primaryRef.current?.();
    }
  };

  const body: ReactNode =
    dialog.kind === "select" ? (
      <GateSelect dialog={dialog} busy={busy} respond={respond} primaryRef={primaryRef} />
    ) : dialog.kind === "confirm" ? (
      <GateConfirm dialog={dialog} busy={busy} respond={respond} primaryRef={primaryRef} />
    ) : dialog.kind === "ask" ? (
      <GateAsk dialog={dialog} busy={busy} respond={respond} primaryRef={primaryRef} />
    ) : (
      <GateText dialog={dialog} busy={busy} respond={respond} primaryRef={primaryRef} />
    );

  const hint = dialog.kind === "ask" ? "gate.timeoutAsk" : "gate.timeout";
  const seconds = remaining === null ? null : remaining / 1000;
  return (
    <div
      ref={rootRef}
      className="gate"
      role="alertdialog"
      aria-labelledby={`gate-title-${dialog.id}`}
      aria-label={t("gate.aria")}
      tabIndex={-1}
      data-pulse={pulse || undefined}
      data-kind={dialog.kind}
      data-approval={(dialog.kind === "select" && dialog.approval) || undefined}
      data-testid="gate"
      onKeyDown={onKeyDown}
      onAnimationEnd={() => setPulse(false)}
    >
      {timeoutMs !== undefined && (
        <div
          className="gate-timer"
          style={{ animationDuration: `${timeoutMs}ms`, animationDelay: `-${timerDelayMs}ms` }}
        />
      )}
      <header className="gate-head">
        <span className="gate-diamond" aria-hidden="true" />
        <h2 id={`gate-title-${dialog.id}`} className="gate-title">
          {dialogTitle(dialog, t("gate.title.waiting"), t)}
        </h2>
        {pending > 0 && <span className="gate-pending">{t("gate.pending", { n: pending })}</span>}
        {seconds !== null && (
          <span
            className="gate-clock"
            data-urgent={seconds <= 10 || undefined}
            title={t(hint, { s: Math.ceil(seconds) })}
          >
            {formatClock(seconds)}
          </span>
        )}
      </header>
      {body}
    </div>
  );
}
