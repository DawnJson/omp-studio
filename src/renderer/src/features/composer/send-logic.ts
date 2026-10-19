// 输入框按键 → 动作（spec 4.14 的发送行为表）。纯函数，test/composer-keys.test.ts 覆盖 IME 组合态等边界。

export type EnterAction =
  /** 不拦截：交给浏览器默认行为（换行、输入法确认等）。 */
  | "default"
  | "send"
  | "steer"
  | "followUp"
  /** 有门停靠：拒绝门并把输入发给 omp。 */
  | "denyAndSend"
  /** 有门停靠且草稿为空：Ctrl+Enter = 门的主操作。 */
  | "gatePrimary"
  /** `!命令`：直接执行，不碰门、不进模型队列。 */
  | "shell";

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
  /** 草稿是 `!命令`（以 ! 开头且没有图片）。 */
  shell: boolean;
}

/** `!命令`草稿：去掉首尾空白后以 ! 开头，且没有图片（带图片的一律当普通消息发给模型）。 */
export function isShellDraft(draft: { text: string; images: readonly unknown[] }): boolean {
  return draft.images.length === 0 && draft.text.trim().startsWith("!");
}

/** `!命令` 能不能现在跑：任务正在跑一轮（命令块会把它拦腰截断）或已有命令在跑（每个任务只有一个命令槽）时不能。 */
export function canRunShell(state: { taskRunning: boolean; shellRunning: boolean }): boolean {
  return !state.taskRunning && !state.shellRunning;
}

export function decideEnter(key: KeyInfo, ctx: SendContext): EnterAction {
  if (key.key !== "Enter") return "default";
  // 输入法组合态（含 keyCode 229）：Enter 是在确认候选词，一律不发送。
  if (key.isComposing || key.keyCode === 229) return "default";
  if (key.shiftKey || key.altKey) return "default";
  const ctrl = key.ctrlKey || key.metaKey;
  // `!命令`（无图片）不是发给模型的消息：不拒绝门，也不分插话/稍后，直接走命令路径（actions.ts 里再判断能不能跑）。
  if (ctx.shell && ctx.hasContent) return "shell";
  if (ctx.gate) {
    if (!ctrl) return ctx.hasContent ? "denyAndSend" : "default";
    // 草稿为空：Ctrl+Enter 是门的主操作；有草稿则门不响应，落到下面和没有门时一样的"稍后发送"。
    if (!ctx.hasContent) return "gatePrimary";
  }
  if (!ctx.hasContent) return "default";
  // 门停靠时 omp 必然在跑（等这个门），即使调用方的 running 还没跟上。
  if (!ctx.running && !ctx.gate) return "send";
  const steerOnEnter = !ctx.swapped;
  return ctrl === steerOnEnter ? "followUp" : "steer";
}
