// 用户的 `!命令`：和模型的 bash 工具调用同一张卡片（BashCard）。运行期间显示命令 + 状态脚里的"运行中"和停止按钮；
// Esc 由输入框统一处理（Composer：有命令在跑先中止命令，否则停止任务）。
import type { TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { reportError } from "../../ui/errors.ts";
import { BashCard, type BashState } from "./BashCard.tsx";
import type { Extra } from "./model.ts";
import { useShellRun } from "./shell-run-store.ts";
import { useNow } from "./use-now.ts";

type ShellExtra = Extract<Extra, { kind: "shell" }>;

export function ShellBlock({ extra }: { extra: ShellExtra }) {
  const t = useT();
  const output = extra.output.replace(/\r?\n$/, "");
  const lines = output === "" ? [] : output.split(/\r?\n/);
  const state: BashState = extra.cancelled
    ? { kind: "failed", label: t("tool.bash.cancelled"), elapsedMs: null }
    : extra.exitCode !== null && extra.exitCode !== 0
      ? { kind: "failed", label: t("tool.bash.exit", { code: extra.exitCode }), elapsedMs: null }
      : { kind: "done", elapsedMs: null };
  return (
    <BashCard
      command={extra.command}
      lines={lines}
      state={state}
      note={extra.truncated ? t("tool.bash.truncated") : null}
      testId="shell-block"
    />
  );
}

/** 正在跑的那条：命令 + 状态脚（实时秒数）和停止按钮。输出要等跑完才有（omp 的 bash 命令只在结束时应答）。 */
export function ShellRunning({ taskId }: { taskId: TaskId }) {
  const t = useT();
  const run = useShellRun(taskId);
  const now = useNow(run !== null);

  const stop = () => {
    window.studio.abortBash(taskId).catch((error: unknown) => reportError(t, error));
  };

  if (!run) return null;
  return (
    <BashCard
      command={run.command}
      lines={[]}
      state={{ kind: "running", elapsedMs: now - run.startedAt }}
      testId="shell-running"
      action={
        <button type="button" className="bash-stop" onClick={stop}>
          {t("conversation.shell.stop")}
        </button>
      }
    />
  );
}
