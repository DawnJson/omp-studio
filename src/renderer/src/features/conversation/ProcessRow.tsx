// 过程行（spec 4.11）：同一个位置三个形态。运行中一行实时状态（intent 原话 + 计时），结束后折叠成"已工作 …"，点开看工具列表。
import { useState } from "react";
import type { TaskStatus } from "../../../../shared/ipc.ts";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import { useT } from "../../i18n/use-t.ts";
import { ChevronRight } from "../../icons.tsx";
import { formatClock, formatDuration } from "./format.ts";
import type { Turn } from "./model.ts";
import { ProcessDetails, toolLabel } from "./ProcessDetails.tsx";
import { useNow } from "./use-now.ts";

interface LiveProps {
  status: TaskStatus;
  /** 进入"等你确认"的时间；null 表示没在等。 */
  waitingSince: number | null;
  /** 压缩 / 重试这类状态行正在进行。 */
  phase: "compacting" | "retrying" | null;
  subagentsRunning: number;
}

function liveText(turn: Turn, live: LiveProps, now: number, t: TFunction): string {
  if (live.status === "needs_you") return t("process.waiting", { duration: formatDuration(t, now - (live.waitingSince ?? now)) });
  if (live.status === "starting") return t("process.starting");
  const running = [...turn.steps].reverse().find((step) => step.kind === "tool" && step.status === "running");
  let text: string;
  if (live.phase === "compacting") text = t("process.compacting");
  else if (live.phase === "retrying") text = t("process.retryingNow");
  else if (running && running.kind === "tool") text = toolLabel(running, t);
  else if (turn.liveKind === "text") text = t("process.replying");
  else text = t("process.thinking");
  return live.subagentsRunning > 0 ? `${text} · ${t("process.subagentsRunning", { count: live.subagentsRunning })}` : text;
}

/** 淡入动画只在"换了一件事"时重放：等待的倒计时文字每秒变，但 key 不变，节点不重挂载。 */
function liveKey(turn: Turn, live: LiveProps): string {
  if (live.status === "needs_you" || live.status === "starting") return live.status;
  const running = [...turn.steps].reverse().find((step) => step.kind === "tool" && step.status === "running");
  return live.phase ?? (running ? running.key : (turn.liveKind ?? "thinking"));
}

export function ProcessRow({ turn, live }: { turn: Turn; live: LiveProps | null }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const now = useNow(live !== null);

  if (live) {
    const waiting = live.status === "needs_you";
    return (
      <div className="process" data-anchor data-state="live" data-testid="process-live">
        <button type="button" className="process-row" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          <span className="process-dot" data-waiting={waiting || undefined} aria-hidden="true" />
          <span className="process-text" key={liveKey(turn, live)}>{liveText(turn, live, now, t)}</span>
          {!waiting && <span className="process-time">{formatClock(now - turn.startedAt)}</span>}
          <ChevronRight size={14} className="process-chevron" data-open={expanded || undefined} />
        </button>
        {expanded && <ProcessDetails steps={turn.steps} />}
      </div>
    );
  }

  const worked = turn.endedAt - turn.startedAt;
  // 不足 1 秒或 0 次工具调用的轮次不显示这一行。
  if (worked < 1000 || turn.toolCalls === 0) return null;
  const parts: string[] = [t("process.done", { duration: formatDuration(t, worked) }), t("process.toolCalls", { count: turn.toolCalls })];
  if (turn.subagents > 0) parts.push(t("process.subagents", { count: turn.subagents }));
  return (
    <div className="process" data-anchor data-state="done" data-testid="process-done">
      <button type="button" className="process-row" data-done aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        <ChevronRight size={14} className="process-chevron" data-open={expanded || undefined} />
        <span className="process-text">{parts.join(" · ")}</span>
        {turn.failures > 0 && <span className="process-fail">{" · "}{t("process.failures", { count: turn.failures })}</span>}
      </button>
      {expanded && <ProcessDetails steps={turn.steps} />}
    </div>
  );
}

export type { LiveProps };
