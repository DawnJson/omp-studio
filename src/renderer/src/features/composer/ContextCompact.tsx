// 上下文构成浮层里"压缩"一栏（任务里才有）：omp 的自动压缩触发点、压缩摘要的状态（预生成中 / 已备好）、"立即压缩"（/compact）和
// "交接"（/handoff）两个按钮。数据是 TaskState.contextCompaction（omp 输入框卡片上上下文 meter 里的 marks 和标题，shared/tsp/context-compaction.ts）：
// omp 没给的（自动压缩关着、没开摘要预生成、摘要没在生成）就不显示那一行，不编。两个按钮走 runTaskCommand（主进程拼 `/compact` / `/handoff`，
// 等 omp 写出压缩分隔或错误行）；任务不空闲时（omp 在跑一轮、等你确认）omp 会拒绝，按钮置灰。
import { useState } from "react";
import type { TaskState } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Button } from "../../ui/controls.tsx";
import { reportOmpError } from "../../ui/errors.ts";
import { pushToast } from "../dialogs/toast-store.ts";

type Kind = "compact" | "handoff";

export function ContextCompact({ task }: { task: TaskState }) {
  const t = useT();
  const [busy, setBusy] = useState<Kind | null>(null);
  const info = task.contextCompaction;
  const idle = task.status === "idle";
  const run = (kind: Kind) => {
    setBusy(kind);
    window.studio
      .runTaskCommand(task.id, { kind })
      .then(
        () => pushToast({ message: t(kind === "compact" ? "board.compactDone" : "board.handoffDone") }),
        (error: unknown) => reportOmpError(t, error),
      )
      .finally(() => setBusy(null));
  };
  return (
    <div className="ctx-compact" data-testid="context-compaction">
      {info !== null && (
        <p className="ctx-compact-line" data-testid="context-auto-at">
          {t("board.ctxAutoAt", { p: Math.round(info.autoAtPercent) })}
        </p>
      )}
      {info?.summary != null && (
        <p className="ctx-compact-line" data-testid="context-summary" data-state={info.summary}>
          {t("board.ctxSummary", {
            state: t(info.summary === "running" ? "board.ctxSummaryRunning" : "board.ctxSummaryReady"),
          })}
        </p>
      )}
      <div className="ctx-compact-actions">
        <Button
          size="sm"
          testId="context-compact"
          title={idle ? undefined : t("board.compactNeedIdle")}
          loading={busy === "compact"}
          disabled={!idle || busy !== null}
          onClick={() => run("compact")}
        >
          {t("board.compactNow")}
        </Button>
        <Button
          size="sm"
          testId="context-handoff"
          title={idle ? t("board.handoffTip") : t("board.compactNeedIdle")}
          loading={busy === "handoff"}
          disabled={!idle || busy !== null}
          onClick={() => run("handoff")}
        >
          {t("board.handoff")}
        </Button>
      </div>
    </div>
  );
}
