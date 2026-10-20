// 不显示的 <input>：picker / prefs 的搜索框是 omp 自己的（query 由 omp 回），这边只负责收键盘和输入法，
// 按键编码后写进伪终端；输入法提交的文字、粘贴也写进去。字符永远不留在 input 里。
import { useEffect, useRef } from "react";
import { encodeKey, encodePaste, isComposingKey } from "../keys.ts";
import type { TspContext } from "../node-props.ts";
import { likeOf } from "./key-event.ts";

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

  // 不经 keydown 的插入（Windows 表情面板、听写）。
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
      data-tspi-keys=""
      aria-label={label}
      spellCheck={false}
      autoComplete="off"
      onKeyDown={onKeyDown}
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
