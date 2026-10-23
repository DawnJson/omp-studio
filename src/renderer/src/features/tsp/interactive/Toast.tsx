// `toast`：节点本身不画东西，通知用 studio toast 的气泡外观画在主区面板上沿正中（portal 进 dialogs/Toasts.tsx 的叠放区，
// 排在 studio 自己的 toast 下面），整个窗口同一时刻一条。
// 首次出现、以及 text / sub / tone / ttl 变了时重新显示；节点移除时收掉还在显示的。
// 例外：omp 的状态行（role omp.toast.status，切模型等）终端里是对话里一行暗字，不是弹层：它由对话区留成一行
// （shared/tsp/status-notes.ts、TspView 的 MainFlow），这里不再弹。
import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { TspToastProps } from "../../../../../shared/tsp/tsp.generated.ts";
import { useT } from "../../../i18n/use-t.ts";
import { useToastHost } from "../../dialogs/toast-host.ts";
import { nodeDomProps } from "../node-dom.ts";
import type { NodeProps } from "../node-props.ts";
import { hideToast, showToast, toastTone, useToast } from "./toast-store.ts";
import { STATUS_TOAST_ROLE } from "../../../../../shared/tsp/status-notes.ts";

const reducedMotion = () =>
  document.documentElement.dataset["motion"] === "reduced" ||
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Toast(props: NodeProps) {
  const { node, ctx } = props;
  const t = useT();
  const p = node.p as unknown as TspToastProps & { tone?: unknown; role?: unknown };
  const owner = `${ctx.taskId}\u0000${ctx.sf}\u0000${node.id}`;
  const tone = toastTone(p.tone);
  const text = p.text ?? "";
  const sub = p.sub !== undefined && p.sub !== "" ? (p.sub.split("\n")[0] ?? "").slice(0, 120) : undefined;
  const ttl = typeof p.ttl === "number" ? p.ttl : undefined;

  const inline = p.role === STATUS_TOAST_ROLE;
  useEffect(() => {
    if (!inline) showToast(owner, { text, sub, tone, ttl }, reducedMotion());
  }, [inline, owner, text, sub, tone, ttl]);
  useEffect(() => () => hideToast(owner), [owner]);

  const shown = useToast();
  const host = useToastHost();
  const marker = (
    <span {...nodeDomProps(props, "tspi-toast-node", { pointer: false, noTitle: true })} aria-hidden="true" />
  );
  if (shown === null || shown.owner !== owner || host === null) return marker;
  return (
    <>
      {marker}
      {createPortal(
        <div
          className="toast"
          data-level={shown.tone}
          data-closing={shown.leaving ? "pop" : undefined}
          role={shown.tone === "error" ? "alert" : "status"}
          aria-live={shown.tone === "error" ? "assertive" : "polite"}
          title={t("tspi.dismiss")}
          onClick={() => hideToast(owner)}
        >
          <span className="toast-text">{shown.text}</span>
          {shown.sub !== undefined ? <span className="toast-sub">{shown.sub}</span> : null}
        </div>,
        host,
      )}
    </>
  );
}
