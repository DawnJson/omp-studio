import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { KeyEventLike } from "../keys.ts";

/** DOM KeyboardEvent → keys.ts 认的字段。 */
export function likeOf(e: KeyboardEvent): KeyEventLike {
  return {
    key: e.key,
    code: e.code,
    ctrlKey: e.ctrlKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
    isComposing: e.isComposing,
    keyCode: e.keyCode,
    altGraph: e.getModifierState("AltGraph"),
  };
}

/**
 * 把按键写进伪终端的元素（list、提问对话框、编辑框、隐藏输入框）一律用它拿 `data-tspi-keys` 和 onKeyDown（scripts/check.ts 查）。
 * 这些元素会嵌套（提问对话框里有 list，list 里有编辑框），按键从里往外冒：`handler` 只在这一层是离目标最近的 `data-tspi-keys`、
 * 而且还没人 preventDefault 时才跑，同一个键不会里外各写一次（PR #17：提问文本框一次退格删两个字、方向键走两格）。
 * 里面的元素自己处理了的键要 preventDefault（按钮、链接的 Enter 同理），外层就不再转发。`always` 不管归属都先跑。
 */
export function keyOwner<T extends Element>(
  handler: (e: ReactKeyboardEvent<T>) => void,
  always?: (e: ReactKeyboardEvent<T>) => void,
): { "data-tspi-keys": ""; onKeyDown: (e: ReactKeyboardEvent<T>) => void } {
  return {
    "data-tspi-keys": "",
    onKeyDown: (e) => {
      always?.(e);
      if (e.defaultPrevented) return;
      if (!(e.target instanceof Element) || e.target.closest("[data-tspi-keys]") !== e.currentTarget) return;
      handler(e);
    },
  };
}
