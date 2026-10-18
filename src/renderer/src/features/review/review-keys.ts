// 评审里的单字符快捷键（j/k 文件、n/p 改动块、v 切换对比方式）和 Esc。
// 只在焦点不在输入控件、没有对话框/命令面板盖在上面、没有被别处处理过（defaultPrevented）时生效；带 Ctrl/Alt/Meta 的组合键不管。
import { useEffect, useRef } from "react";
import { usePaletteOpen } from "../../store/index.ts";

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** handler 返回 true 表示处理了这个键（会 preventDefault）。 */
export function useReviewKeys(handler: (key: string) => boolean): void {
  const latest = useRef(handler);
  latest.current = handler;
  const paletteOpen = usePaletteOpen();
  const paletteRef = useRef(paletteOpen);
  paletteRef.current = paletteOpen;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
      if (paletteRef.current || isEditable(event.target)) return;
      if (event.target instanceof Element && event.target.closest(".st-scrim") !== null) return;
      if (latest.current(event.key)) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
