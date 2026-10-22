// Bash 卡片（Tern 的样子）：上 = 命令；中 = 输出只留最后 10 行（同 omp 的 bash 卡片），上面一行"N 行更早的输出"可展开；下 = 状态脚（完成 / 运行中 / 失败）。
import { useState } from "react";
import { useT } from "../../i18n/use-t.ts";
import { Check, ChevronRight, Close } from "../../icons.tsx";
import { Clamp } from "./Clamp.tsx";
import { formatElapsed } from "./tool-view.ts";

/** 折叠时输出只显示最后这么多行（omp 的 bash 卡片也是最后 10 行，`fixtures/tsp/approval.jsonl`）。 */
const BASH_TAIL_LINES = 10;

export type BashState =
  | { kind: "running" }
  | { kind: "done"; elapsedMs: number | null }
  | { kind: "failed"; label: string; elapsedMs: number | null };

export function BashCard({
  command,
  lines,
  state,
}: {
  command: string | null;
  lines: readonly string[];
  state: BashState;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const earlier = Math.max(0, lines.length - BASH_TAIL_LINES);
  const shown = expanded || earlier === 0 ? lines : lines.slice(-BASH_TAIL_LINES);
  const elapsed = state.kind !== "running" && state.elapsedMs !== null ? formatElapsed(state.elapsedMs) : null;
  return (
    <div className="bash-card" data-status={state.kind}>
      {command !== null && (
        <div className="bash-cmd">
          <Clamp lines={6} lineHeight="var(--lh-code-sm)">
            <code className="bash-code">{command}</code>
          </Clamp>
        </div>
      )}
      {(lines.length > 0 || state.kind !== "running") && (
        <div className="bash-out">
          {earlier > 0 && (
            <button
              type="button"
              className="bash-earlier"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {t("tool.bash.earlier", { count: earlier })}
              <ChevronRight size={12} className="bash-earlier-chevron" data-open={expanded || undefined} />
            </button>
          )}
          {lines.length > 0 ? (
            <pre
              className="bash-pre"
              data-fade={(earlier > 0 && !expanded) || undefined}
              data-all={expanded || undefined}
            >
              {shown.join("\n")}
            </pre>
          ) : (
            <p className="bash-empty">{t("tool.output.empty")}</p>
          )}
        </div>
      )}
      <div className="bash-foot" data-status={state.kind}>
        {state.kind === "running" ? (
          <span className="step-spin" aria-hidden="true" />
        ) : state.kind === "done" ? (
          <Check size={12} />
        ) : (
          <Close size={12} />
        )}
        <span className="bash-state">
          {state.kind === "running"
            ? t("tool.bash.running")
            : state.kind === "done"
              ? t("tool.bash.done")
              : state.label}
        </span>
        {elapsed !== null && <span className="bash-time">{elapsed}</span>}
      </div>
    </div>
  );
}
