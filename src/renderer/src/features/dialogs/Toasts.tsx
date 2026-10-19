// 右下角 toast 列表。不抢焦点；错误用 role=alert，其余 role=status。
// 消失（点关闭 / 到时间 / 被挤掉）时先放退出动画：已移出 store 的 toast 在这里留一份"幽灵"，放完再卸载。
import { useLayoutEffect, useRef, useState } from "react";
import { useT } from "../../i18n/use-t.ts";
import { Close } from "../../icons.tsx";
import { usePresence } from "../../ui/presence.ts";
import { dismissToast, useToasts, type Toast } from "./toast-store.ts";
import "./dialogs.css";

function ToastCard({ toast, open, onGone }: { toast: Toast; open: boolean; onGone(id: number): void }) {
  const t = useT();
  const presence = usePresence(open);
  const gone = !presence.mounted;
  const id = toast.id;
  useLayoutEffect(() => {
    if (gone) onGone(id);
  }, [gone, id, onGone]);
  if (gone) return null;
  return (
    <div
      className="toast"
      data-level={toast.level}
      role={toast.level === "error" ? "alert" : "status"}
      {...presence.exitProps}
    >
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
      <button
        type="button"
        className="toast-close"
        aria-label={t("toast.dismiss")}
        onClick={() => dismissToast(toast.id)}
      >
        <Close size={14} />
      </button>
    </div>
  );
}

export function Toasts() {
  const t = useT();
  const live = useToasts();
  const [ghosts, setGhosts] = useState<readonly Toast[]>([]);
  // store 里刚消失的 toast 转成幽灵：渲染期间直接派生状态，React 会在提交前重渲，卡片不会被卸载重挂。
  const [previous, setPrevious] = useState(live);
  if (previous !== live) {
    setPrevious(live);
    const removed = previous.filter((old) => !live.some((toast) => toast.id === old.id));
    if (removed.length > 0) setGhosts((list) => [...list, ...removed]);
  }
  const forget = useRef((id: number) => setGhosts((list) => list.filter((toast) => toast.id !== id))).current;
  // id 自增，按 id 排序就是原来的先后顺序。
  const shown = [...live, ...ghosts.filter((ghost) => !live.some((toast) => toast.id === ghost.id))].sort(
    (a, b) => a.id - b.id,
  );
  return (
    <section className="toasts" aria-label={t("dialogs.toastRegion")} data-testid="toasts">
      {shown.map((toast) => (
        <ToastCard key={toast.id} toast={toast} open={live.some((item) => item.id === toast.id)} onGone={forget} />
      ))}
    </section>
  );
}
