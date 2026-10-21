// fast / slow 指示、输出速度的纯文本逻辑（不碰 React，单元测试直接用）。
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import type { TaskState } from "../../../../shared/ipc.ts";
import type { SlowModeScope } from "../../../../shared/omp-wire/rpc-wire.generated.ts";

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
