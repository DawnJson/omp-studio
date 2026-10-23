// 评审里的单字符快捷键（j/k 文件、n/p 改动块、v/f/w 显示选项）和 Esc。
// 只在焦点不在输入控件、没有对话框/命令面板盖在上面、没有被别处处理过（defaultPrevented）时生效；带 Ctrl/Alt/Meta 的组合键不管。
import { useEffect, useRef } from "react";
import { usePaletteOpen } from "../../store/index.ts";
import { isDialogOpen } from "../../ui/Dialog.tsx";

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/**
 * handler 返回 true 表示处理了这个键（会 preventDefault）；event 给需要看 Shift 的处理者（Shift+↑↓ 扩展行选择）。
 * `inner`：嵌在评审里面的视图（文件 diff）在捕获阶段先拿到键，处理了（如 Esc 清行选择）外层就不再处理（Esc 关评审）；
 * 不靠监听器注册顺序：文件视图换文件重挂载后注册得比外层晚。
 */
export function useReviewKeys(handler: (key: string, event: KeyboardEvent) => boolean, inner = false): void {
  const latest = useRef(handler);
  latest.current = handler;
  const paletteOpen = usePaletteOpen();
  const paletteRef = useRef(paletteOpen);
  paletteRef.current = paletteOpen;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
      if (paletteRef.current || isDialogOpen() || isEditable(event.target)) return;
      if (latest.current(event.key, event)) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown, { capture: inner });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: inner });
  }, [inner]);
}
