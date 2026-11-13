// 不显示的 <input>：picker / prefs 的搜索框是 omp 自己的（query 由 omp 回），这边只负责收键盘和输入法，
// 写进伪终端：打字的文字只由 beforeinput 送（keydown 不发，见 keys.ts 的 isTextKey），其余按键编码后写；
// 输入法提交的文字、粘贴也写进去。字符永远不留在 input 里。
import { useEffect, useRef } from "react";
import { encodeKey, encodePaste, isComposingKey, isTextKey } from "../keys.ts";
import type { TspContext } from "../node-props.ts";
import { keyOwner, likeOf } from "./key-event.ts";

interface TerminalInputProps {
  ctx: TspContext;
  /** 挂载时拿焦点（模态的 picker / prefs）。 */
  autoFocus?: boolean;
  label: string;
}

export function TerminalInput({ ctx, autoFocus = false, label }: TerminalInputProps) {
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);

  useEffect(() => {
    if (autoFocus) input.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  // 插入文字的唯一出口（打字、Windows 表情面板、听写、输入法英文模式）。
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const onBeforeInput = (e: InputEvent) => {
      if (composing.current || e.isComposing) return;
      e.preventDefault();
      const data = e.data ?? "";
      if (data.length > 0 && !e.inputType.startsWith("delete")) ctx.keys(data);
    };
    el.addEventListener("beforeinput", onBeforeInput);
    return () => el.removeEventListener("beforeinput", onBeforeInput);
  }, [ctx]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const like = likeOf(e.nativeEvent);
    if (isComposingKey(like)) return;
    if ((e.ctrlKey && e.key.toLowerCase() === "v" && !e.altKey) || (e.shiftKey && e.key === "Insert")) return;
    // 输入法英文模式下 keydown 是字母，preventDefault 拦不住输入法再送一遍文字：打字只走 beforeinput。
    if (isTextKey(like)) return;
    const data = encodeKey(like);
    if (data === null) return;
    e.preventDefault();
    ctx.keys(data);
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    ctx.keys(text.length > 0 ? encodePaste(text) : "\x16");
  };

  return (
    <input
      ref={input}
      className="tspi-hidden-input"
      aria-label={label}
      spellCheck={false}
      autoComplete="off"
      {...keyOwner(onKeyDown)}
      onPaste={onPaste}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={(e) => {
        composing.current = false;
        if (e.data.length > 0) ctx.keys(e.data);
        const el = e.currentTarget;
        setTimeout(() => {
          el.value = "";
        }, 0);
      }}
    />
  );
}
