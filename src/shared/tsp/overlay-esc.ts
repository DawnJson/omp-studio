// omp 的弹窗（`overlay` 节点，/jobs /session /usage /changelog /marketplace …）没有关闭动作（TspOverlayProps 里没有 actions），
// 关它的唯一办法是把 Esc 这个键交给 omp（终端里就是按 Esc）。键盘焦点通常在 studio 的输入框（不在 tsp-view 里），
// 所以渲染进程在 window 上截 Esc；这里是"这一下 Esc 该不该写给 omp"的判定，纯函数，测试直接传普通对象。

/** 触发 Esc 的元素落在哪一类：决定谁来处理这个键。 */
export type EscTarget =
  /** 没有焦点元素（body）。 */
  | "body"
  /** tsp-view 里的普通元素（弹窗的卡片、按钮）。 */
  | "view"
  /** studio 的任务输入框。 */
  | "composer"
  /** tsp-view 里自己把按键写给 omp 的控件（输入框、list）：它们的 keydown 已经发了 Esc，这里再发就是两下。 */
  | "self-routing"
  /** studio 自己的对话框、菜单、别的输入：它们自己处理 Esc。 */
  | "other";

export interface OverlayEscInput {
  key: string;
  defaultPrevented: boolean;
  /** 输入法组合中（Esc 是取消组合，不是关弹窗）。 */
  composing: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  target: EscTarget;
  /** 这个弹窗是它所在 tsp-view 里最上面一个可关闭的弹窗（不含锚在光标 / 节点上的补全菜单）。 */
  isTop: boolean;
  /** 同一个 tsp-view 里有选择器（比弹窗高一层，自己管 Esc）。 */
  pickerOpen: boolean;
}

export function shouldSendOverlayEsc(input: OverlayEscInput): boolean {
  if (input.key !== "Escape" || input.defaultPrevented || input.composing) return false;
  if (input.ctrlKey || input.altKey || input.shiftKey || input.metaKey) return false;
  if (!input.isTop || input.pickerOpen) return false;
  return input.target === "body" || input.target === "view" || input.target === "composer";
}
