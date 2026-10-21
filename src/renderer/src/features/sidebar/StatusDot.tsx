// 状态图标（spec §4.1）：16×16 槽位里放 14px 的图标，形状 + 颜色双信号——进行中是转动的弧，需要介入是琥珀圆底 !，
// 已完成是圆圈里一个对勾，失败是红圆底 ×。从没跑过和被停止的不画，但槽位保留让标题对齐。
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { TaskState } from "../../../../shared/ipc.ts";
import { dotKind, type DotKind } from "../../../../shared/ui/sidebar-model.ts";

type Kind = Exclude<DotKind, "none">;

function Glyph({ kind }: { kind: Kind }) {
  switch (kind) {
    case "running":
      return (
        <>
          <circle className="sb-dot-track" cx="8" cy="8" r="6" />
          <circle className="sb-dot-arc" cx="8" cy="8" r="6" pathLength="100" />
        </>
      );
    case "waiting":
      return (
        <>
          <circle className="sb-dot-fill" cx="8" cy="8" r="7" />
          <rect className="sb-dot-ink" x="7.1" y="3.6" width="1.8" height="5.4" rx="0.9" />
          <circle className="sb-dot-ink" cx="8" cy="11.6" r="1.05" />
        </>
      );
    case "done":
      return (
        <>
          <circle className="sb-dot-ring" cx="8" cy="8" r="6.25" />
          <path className="sb-dot-stroke" d="M5.3 8.2 7.2 10.1 10.8 6.3" />
        </>
      );
    case "error":
      return (
        <>
          <circle className="sb-dot-fill" cx="8" cy="8" r="7" />
          <path className="sb-dot-ink-stroke" d="M5.8 5.8 10.2 10.2M10.2 5.8 5.8 10.2" />
        </>
      );
  }
}

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
      <svg className="sb-dot-mark" viewBox="0 0 16 16" aria-hidden="true">
        <Glyph kind={kind} />
      </svg>
    </span>
  );
}
