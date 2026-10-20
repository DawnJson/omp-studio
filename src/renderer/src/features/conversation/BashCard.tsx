// Bash 卡片（Tern 的样子）：上 = 命令；中 = 输出只留最后 8 行，上面一行"N 行更早的输出"可展开；下 = 状态脚（完成 / 运行中 / 失败）。
// 模型自己的 bash 工具调用（ProcessDetails）和用户的 `!命令`（ShellBlock）共用，两处看起来一致。
import { useState, type ReactNode } from "react";
import { useT } from "../../i18n/use-t.ts";
import { Check, ChevronRight, Close } from "../../icons.tsx";
import { Clamp } from "./Clamp.tsx";
import { formatElapsed } from "./tool-view.ts";

/** 折叠时输出只显示最后这么多行。 */
export const BASH_TAIL_LINES = 8;

export type BashState =
  | { kind: "running"; elapsedMs: number | null }
  | { kind: "done"; elapsedMs: number | null }
  | { kind: "failed"; label: string; elapsedMs: number | null };

export function BashCard({
  command,
  lines,
  state,
  testId,
  note,
  action,
}: {
  command: string | null;
  lines: readonly string[];
  state: BashState;
  testId?: string;
  /** 状态脚里的补充说明（如"omp 截断了输出"）。 */
  note?: string | null;
  /** 状态脚右端的按钮（如停止）。 */
  action?: ReactNode;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const earlier = Math.max(0, lines.length - BASH_TAIL_LINES);
  const shown = expanded || earlier === 0 ? lines : lines.slice(-BASH_TAIL_LINES);
  const elapsed = state.elapsedMs !== null ? formatElapsed(state.elapsedMs) : null;
  return (
    <div className="bash-card" data-status={state.kind} data-testid={testId}>
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
          <span className="bash-dot" aria-hidden="true" />
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
        {note ? <span className="bash-note">{note}</span> : null}
        {action !== undefined && <span className="bash-action">{action}</span>}
      </div>
    </div>
  );
}
