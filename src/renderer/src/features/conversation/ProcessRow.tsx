// 过程（spec 4.11）：运行中像 omp 一样把工具调用直接列在对话里（在做什么、计时在输入框上方的状态行 RunStatus）；
// 结束后折叠成一行"已工作 …"，点开再看工具列表。
import { useState } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import type { SubagentLane } from "../../../../shared/subagents.ts";
import { useT } from "../../i18n/use-t.ts";
import { ChevronRight } from "../../icons.tsx";
import { LanesPanel } from "../lanes/LanesPanel.tsx";
import { formatDuration } from "./format.ts";
import type { Turn } from "./model.ts";
import { ProcessDetails } from "./ProcessDetails.tsx";
import { Reveal } from "../../ui/Reveal.tsx";

export function ProcessRow({
  turn,
  live,
  taskId,
  projectPath,
  lanes,
}: {
  turn: Turn;
  /** 这一轮正在跑（只有最后一轮可能是）。 */
  live: boolean;
  taskId: TaskId;
  projectPath: string | null;
  lanes: readonly SubagentLane[];
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  if (live) {
    // 还没有任何工具调用 / 子代理时不占位：思考中、回复中由输入框上方的状态行说。
    if (turn.steps.length === 0 && lanes.length === 0) return null;
    return (
      <div className="process" data-anchor data-state="live" data-testid="process-live">
        <ProcessDetails
          steps={turn.steps}
          header={
            lanes.length > 0 && <LanesPanel taskId={taskId} turn={turn} lanes={lanes} live projectPath={projectPath} />
          }
        />
      </div>
    );
  }

  const worked = turn.endedAt - turn.startedAt;
  // 不足 1 秒或 0 次工具调用的轮次不显示这一行。
  if (worked < 1000 || turn.toolCalls === 0) return null;
  const parts: string[] = [
    t("process.done", { duration: formatDuration(t, worked) }),
    t("process.toolCalls", { count: turn.toolCalls }),
  ];
  if (turn.subagents > 0) parts.push(t("process.subagents", { count: turn.subagents }));
  return (
    <div className="process" data-anchor data-state="done" data-testid="process-done">
      <button
        type="button"
        className="process-row"
        data-done
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <ChevronRight size={14} className="process-chevron" data-open={expanded || undefined} />
        <span className="process-text">{parts.join(" · ")}</span>
        {turn.failures > 0 && (
          <span className="process-fail">
            {" · "}
            {t("process.failures", { count: turn.failures })}
          </span>
        )}
      </button>
      <Reveal open={expanded}>
        <ProcessDetails
          steps={turn.steps}
          header={
            lanes.length > 0 && (
              <LanesPanel taskId={taskId} turn={turn} lanes={lanes} live={false} projectPath={projectPath} />
            )
          }
        />
      </Reveal>
    </div>
  );
}
