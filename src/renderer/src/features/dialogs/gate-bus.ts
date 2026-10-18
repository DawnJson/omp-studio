// Composer 和门之间的两个动作：Composer 里 Ctrl+Enter（草稿为空时）= 门的主操作；"拒绝并发送" = 先拒绝门再发消息。
export interface GateControl {
  /** Ctrl+Enter：门的主操作。门出现 500ms 内忽略。 */
  primary(): void;
  /** 拒绝（审批 select 回 Deny，其它回 cancel），返回是否已发出。 */
  deny(): Promise<void>;
  /** 门没有聚焦时把焦点交给它（Ctrl+J）。 */
  focus(): void;
}

let control: GateControl | null = null;

export function registerGateControl(next: GateControl | null): void {
  control = next;
}

export function getGateControl(): GateControl | null {
  return control;
}

// 我们自己答复过的请求：之后它从待答列表里消失是正常的，不是"被取消"。
const answered = new Set<string>();

export function markAnswered(dialogId: string): void {
  answered.add(dialogId);
}

export function wasAnswered(dialogId: string): boolean {
  return answered.has(dialogId);
}
