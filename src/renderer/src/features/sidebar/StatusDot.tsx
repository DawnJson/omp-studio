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
      {kind === "running" && (
        <svg
          className="sb-spin"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="5.25" opacity="0.25" />
          <path d="M7 1.75a5.25 5.25 0 0 1 5.25 5.25" />
        </svg>
      )}
      {kind === "waiting" && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="5.75" />
          <path d="M7 4v3.5M7 10v.01" />
        </svg>
      )}
      {kind === "done" && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m3 7.25 2.75 2.75L11 4.25" />
        </svg>
      )}
      {kind === "error" && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="5.75" />
          <path d="m5 5 4 4M9 5 5 9" />
        </svg>
      )}
    </span>
  );
}
