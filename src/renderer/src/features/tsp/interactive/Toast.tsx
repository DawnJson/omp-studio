// `toast`：节点本身不画东西，通知用 studio toast 的气泡外观画在主区面板上沿正中（portal 进 dialogs/Toasts.tsx 的叠放区，
// 排在 studio 自己的 toast 下面），整个窗口同一时刻一条。
// 首次出现、以及 text / sub / tone / ttl 变了时重新显示；节点移除时收掉还在显示的。
import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { TspToastProps } from "../../../../../shared/tsp/tsp.generated.ts";
import { useT } from "../../../i18n/use-t.ts";
import { useToastHost } from "../../dialogs/toast-host.ts";
import type { NodeProps } from "../node-props.ts";
import { hideToast, showToast, toastTone, useToast } from "./toast-store.ts";

const reducedMotion = () =>
  document.documentElement.dataset["motion"] === "reduced" ||
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Toast({ node, ctx }: NodeProps) {
  const t = useT();
  const p = node.p as unknown as TspToastProps & { tone?: unknown };
  const owner = `${ctx.taskId}\u0000${ctx.sf}\u0000${node.id}`;
  const tone = toastTone(p.tone);
  const text = p.text ?? "";
  const sub = p.sub !== undefined && p.sub !== "" ? (p.sub.split("\n")[0] ?? "").slice(0, 120) : undefined;
  const ttl = typeof p.ttl === "number" ? p.ttl : undefined;

  useEffect(() => {
    showToast(owner, { text, sub, tone, ttl }, reducedMotion());
  }, [owner, text, sub, tone, ttl]);
  useEffect(() => () => hideToast(owner), [owner]);

  const shown = useToast();
  const host = useToastHost();
  if (shown === null || shown.owner !== owner || host === null)
    return <span className="tspi-toast-node" data-id={node.id} aria-hidden="true" />;
  return (
    <>
      <span className="tspi-toast-node" data-id={node.id} aria-hidden="true" />
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
