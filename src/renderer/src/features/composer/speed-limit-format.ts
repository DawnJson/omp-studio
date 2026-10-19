// fast / slow 指示、超限横幅、输出速度的纯文本逻辑（不碰 React，单元测试直接用）。
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import type { TaskState } from "../../../../shared/ipc.ts";
import type { SlowModeScope, UsageLimitState } from "../../../../shared/omp-wire/rpc-wire.generated.ts";

/** 模型胶囊上的小标记：fast 在用（active，不是只开了开关）、slow 开着。 */
export function speedBadges(fast: TaskState["fastMode"], slow: TaskState["slowMode"]): ("fast" | "slow")[] {
  const badges: ("fast" | "slow")[] = [];
  if (fast.active) badges.push("fast");
  if (slow.supported && slow.enabled) badges.push("slow");
  return badges;
}

export const slowScopeKey: Record<SlowModeScope, MessageKey> = {
  global: "model.slow.scope.global",
  session: "model.slow.scope.session",
};

/** 输出速度：≥100 取整，否则一位小数；没有（null、0、负数、非有限）返回 null，界面据此隐藏。 */
export function formatTokensPerSecond(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  const tenths = Math.round(value * 10) / 10;
  return tenths >= 100 ? String(Math.round(tenths)) : tenths.toFixed(1);
}

const two = (n: number) => String(n).padStart(2, "0");

/** 重置时刻（epoch 秒）：今天内只写 `HH:mm`，别的日子前面加 `M-D`。按本机时区。 */
export function formatResetTime(resetsAtSec: number, nowMs: number): string {
  const at = new Date(resetsAtSec * 1000);
  const now = new Date(nowMs);
  const time = `${two(at.getHours())}:${two(at.getMinutes())}`;
  const sameDay =
    at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  return sameDay ? time : `${at.getMonth() + 1}-${at.getDate()} ${time}`;
}

export interface UsageLimitBanner {
  stage: UsageLimitState["stage"];
  /** 横幅主句。 */
  message: MessageKey;
  /** 附句：重置时间、低优先级额度剩余；没有可说的时为空数组。 */
  details: { key: MessageKey; params: Record<string, string | number> }[];
}

/** omp 的 usageLimit 转成横幅内容；没超限（null）返回 null。 */
export function usageLimitBanner(limit: UsageLimitState | null, nowMs: number): UsageLimitBanner | null {
  if (limit === null) return null;
  const details: UsageLimitBanner["details"] = [];
  if (limit.resetsAtSec !== undefined)
    details.push({ key: "composer.limit.resets", params: { time: formatResetTime(limit.resetsAtSec, nowMs) } });
  if (limit.stage === "low_priority") {
    if (limit.allowanceLeftPercent !== undefined)
      details.push({
        key: "composer.limit.left",
        params: { p: Math.round(Math.min(100, Math.max(0, limit.allowanceLeftPercent))) },
      });
    return { stage: limit.stage, message: "composer.limit.lowPriority", details };
  }
  return {
    stage: limit.stage,
    message: limit.extraUsage ? "composer.limit.wrapUpExtra" : "composer.limit.wrapUp",
    details,
  };
}
