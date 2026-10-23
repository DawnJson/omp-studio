// 模式的显示文字（纯逻辑，不碰 React）：工具行胶囊上的标签、循环的限制和条件。
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { TaskMode } from "../../../../shared/ipc.ts";

type LoopMode = Extract<TaskMode, { kind: "loop" }>;

/** omp 的写法：`1h30m`、`2m5s`、`45s`。 */
export function formatLeft(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours}h${minutes > 0 ? `${minutes}m` : ""}`;
  if (minutes > 0) return `${minutes}m${rest > 0 ? `${rest}s` : ""}`;
  return `${rest}s`;
}

/** 循环的限制：`剩 2/5 次` / `剩 3m`；没有限制为 null。 */
export function loopLimitText(t: TFunction, mode: LoopMode): string | null {
  const { limit } = mode;
  if (limit === null) return null;
  return limit.kind === "iterations"
    ? t("modes.loop.count", { remaining: limit.remaining, initial: limit.initial })
    : t("modes.loop.time", { time: formatLeft(limit.secondsLeft) });
}

/** 循环的条件：`直到 bun test 成功`（命令是 omp 截断过的）。 */
export function loopConditionText(t: TFunction, mode: LoopMode): string | null {
  const { condition } = mode;
  if (condition === null) return null;
  return t(condition.until ? "modes.loop.until" : "modes.loop.while", { command: condition.command });
}

/** 工具行胶囊上的文字。 */
export function modeChipLabel(t: TFunction, mode: TaskMode): string {
  switch (mode.kind) {
    case "plan":
      return t(mode.paused ? "modes.name.planPaused" : "modes.name.plan");
    case "prewalk":
      return t("modes.name.prewalk");
    case "vibe":
      return t("modes.name.vibe");
    case "loop": {
      if (mode.state === "paused") return t("modes.name.loopPaused");
      const { limit } = mode;
      if (limit === null) return t("modes.name.loop");
      return limit.kind === "iterations"
        ? t("modes.name.loopCount", { remaining: limit.remaining, initial: limit.initial })
        : t("modes.name.loopTime", { time: formatLeft(limit.secondsLeft) });
    }
  }
}
