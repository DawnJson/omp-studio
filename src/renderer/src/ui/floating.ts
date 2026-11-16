// 浮层（Popover、Menu、输入框上方的斜杠 / @ 文件 / Ctrl+R 菜单）出现、挪动、消失时的通知。
// 气泡（features/dialogs/Toasts.tsx）据此量一次：浮层压到主区上沿的气泡位置时，气泡挪到窗口底部，不盖住浮层。
const listeners = new Set<() => void>();

export function floatingChanged(): void {
  for (const listener of listeners) listener();
}

export function subscribeFloating(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 现在看得见、不在退出动画里的浮层（Menu 用 .ui-menu，其余经 useFitInside 的都带 data-floating）。 */
export function floatingRects(): DOMRect[] {
  return [...document.querySelectorAll<HTMLElement>(".ui-menu, [data-floating]")]
    .filter((el) => !el.hasAttribute("data-closing"))
    .map((el) => el.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
}
