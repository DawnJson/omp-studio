// 状态点（spec §4.1）：16×16 槽位，形状 + 颜色双信号。空闲和已读完成不画，但槽位保留让标题对齐。
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { TaskState } from "../../../../shared/ipc.ts";
import { dotKind } from "../../../../shared/ui/sidebar-model.ts";

export function StatusDot({ task, t }: { task: TaskState; t: TFunction }) {
  const kind = dotKind(task);
  if (kind === "none") return <span key="none" className="sb-dot" aria-hidden="true" />;

  const label =
    kind === "running"
      ? task.runningSubagents > 0
        ? t("status.runningAgents", { count: task.runningSubagents })
        : t("status.running")
      : kind === "waiting"
        ? t("status.waiting")
        : kind === "done"
          ? t("status.done")
          : t("status.error");

  return (
    <span key={kind} className={`sb-dot sb-dot-${kind}`} role="img" aria-label={label}>
      {kind === "done" && (
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m2.5 6.25 2.25 2.25 4.75-5" />
        </svg>
      )}
      {kind === "error" && (
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="6" cy="6" r="5" />
          <path d="M6 3.5v3M6 8.5v.01" />
        </svg>
      )}
    </span>
  );
}
