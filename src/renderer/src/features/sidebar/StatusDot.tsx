// 状态点（spec §4.1、direction-3.0 §3.2）：16×16 槽位里放 8px 的点，形状 + 颜色双信号。从没跑过和被停止的不画，但槽位保留让标题对齐。
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
      <span className="sb-dot-mark" />
    </span>
  );
}
