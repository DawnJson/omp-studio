// 输入框高度的取值范围（纯函数）：下限是输入框自己的最小高度（一行），上限是主区高度的 60%（主区很矮时下限优先）。
const MAX_FIELD_SHARE = 0.6;
/** 键盘调整一步（和终端面板的拖拽条一致）。 */
export const FIELD_KEY_STEP = 16;

export function maxFieldHeight(mainHeight: number, minHeight: number): number {
  return Math.max(minHeight, Math.floor(mainHeight * MAX_FIELD_SHARE));
}

export function clampFieldHeight(height: number, minHeight: number, maxHeight: number): number {
  return Math.round(Math.min(maxHeight, Math.max(minHeight, height)));
}
