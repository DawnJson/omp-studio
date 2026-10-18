// 右下角 toast 列表。不抢焦点；错误用 role=alert，其余 role=status。
import { useT } from "../../i18n/use-t.ts";
import { Close } from "../../icons.tsx";
import { dismissToast, useToasts } from "./toast-store.ts";
import "./dialogs.css";

export function Toasts() {
  const t = useT();
  const toasts = useToasts();
  return (
    <section className="toasts" aria-label={t("dialogs.toastRegion")} data-testid="toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast" data-level={toast.level} role={toast.level === "error" ? "alert" : "status"}>
          <span className="toast-text" title={toast.title}>
            {toast.message}
            {toast.count > 1 && <span className="toast-count"> ×{toast.count}</span>}
          </span>
          {toast.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                toast.action?.run();
                dismissToast(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button type="button" className="toast-close" aria-label={t("toast.dismiss")} onClick={() => dismissToast(toast.id)}>
            <Close size={14} />
          </button>
        </div>
      ))}
    </section>
  );
}
