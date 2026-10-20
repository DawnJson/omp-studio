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
