// 输入框按键 → 动作（spec 4.14 的发送行为表）。纯函数，test/composer-keys.test.ts 覆盖 IME 组合态等边界。

export type EnterAction =
  /** 不拦截：交给浏览器默认行为（换行、输入法确认等）。 */
  | "default"
  | "send"
  | "steer"
  | "followUp"
  /** 有门停靠：拒绝门并把输入发给 omp。 */
  | "denyAndSend"
  /** 有门停靠：Ctrl+Enter = 门的主操作（审批 = 批准）。 */
  | "gatePrimary";

export interface KeyInfo {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  keyCode: number;
}

export interface SendContext {
  running: boolean;
  gate: boolean;
  /** 文字或图片至少有一样。 */
  hasContent: boolean;
  /** 设置里对调 Enter 和 Ctrl+Enter 在运行中的含义。 */
  swapped: boolean;
}

export function decideEnter(key: KeyInfo, ctx: SendContext): EnterAction {
  if (key.key !== "Enter") return "default";
  // 输入法组合态（含 keyCode 229）：Enter 是在确认候选词，一律不发送。
  if (key.isComposing || key.keyCode === 229) return "default";
  if (key.shiftKey || key.altKey) return "default";
  const ctrl = key.ctrlKey || key.metaKey;
  if (ctx.gate) {
    if (!ctrl) return ctx.hasContent ? "denyAndSend" : "default";
    // 审批门上 Ctrl+Enter 一律是"批准"（omp 的 `app.approval.approve`），有没有草稿都一样。
    return "gatePrimary";
  }
  if (!ctx.hasContent) return "default";
  if (!ctx.running) return "send";
  const steerOnEnter = !ctx.swapped;
  return ctrl === steerOnEnter ? "followUp" : "steer";
}
