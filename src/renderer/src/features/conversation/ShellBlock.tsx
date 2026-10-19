// 用户的 `!命令`：命令行、退出状态、输出（超过几行折叠，可展开）。运行期间显示一行"正在运行"和停止按钮；
// Esc 由输入框统一处理（Composer：有命令在跑先中止命令，否则停止任务）。
import { useState } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { reportError } from "../../ui/errors.ts";
import type { Extra } from "./model.ts";
import { useShellRun } from "./shell-run-store.ts";

/** 输出超过这么多行时默认折叠。 */
const COLLAPSED_LINES = 12;

type ShellExtra = Extract<Extra, { kind: "shell" }>;

export function ShellBlock({ extra }: { extra: ShellExtra }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const output = extra.output.replace(/\r?\n$/, "");
  const lines = output === "" ? [] : output.split(/\r?\n/);
  const folded = lines.length > COLLAPSED_LINES && !expanded;
  const shown = folded ? lines.slice(-COLLAPSED_LINES) : lines;
  const failed = extra.cancelled || (extra.exitCode !== null && extra.exitCode !== 0);
  return (
    <div className="shell-block" data-failed={failed || undefined} data-testid="shell-block">
      <div className="shell-head">
        <code className="shell-command">
          <span aria-hidden="true">$ </span>
          {extra.command}
        </code>
        <span className="shell-status">
          {extra.cancelled
            ? t("conversation.shell.cancelled")
            : extra.exitCode !== null && extra.exitCode !== 0
              ? t("conversation.shell.exit", { code: extra.exitCode })
              : null}
        </span>
      </div>
      <pre className="shell-output">{lines.length === 0 ? t("conversation.shell.noOutput") : shown.join("\n")}</pre>
      {(lines.length > COLLAPSED_LINES || extra.truncated) && (
        <div className="shell-foot">
          {extra.truncated && <span className="shell-note">{t("conversation.shell.truncated")}</span>}
          {lines.length > COLLAPSED_LINES && (
            <button
              type="button"
              className="shell-toggle"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? t("conversation.shell.collapse") : t("conversation.shell.showAll", { count: lines.length })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** 正在跑的那条：只显示命令和停止按钮。输出要等跑完才有（omp 的 bash 命令只在结束时应答）。 */
export function ShellRunning({ taskId }: { taskId: TaskId }) {
  const t = useT();
  const run = useShellRun(taskId);

  const stop = () => {
    window.studio.abortBash(taskId).catch((error: unknown) => reportError(t, error));
  };

  if (!run) return null;
  return (
    <div className="shell-block" data-running data-testid="shell-running">
      <div className="shell-head">
        <code className="shell-command">
          <span aria-hidden="true">$ </span>
          {run.command}
        </code>
        <span className="shell-status">{t("conversation.shell.running")}</span>
        <button type="button" className="shell-toggle" onClick={stop}>
          {t("conversation.shell.stop")}
        </button>
      </div>
    </div>
  );
}
