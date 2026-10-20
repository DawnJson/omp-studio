// TSP 任务：过程区里的控件（提问/审批的选项列表、模型选择器的输入）拿着键盘，用完被 omp 撤掉时焦点会掉到 <body>。
// 这时把焦点还给 studio 输入框；只在"刚才拿着焦点的那个元素被撤掉"时才还，用户点了别处（焦点本来就在 body）不抢。
import { useEffect, type RefObject } from "react";

const tspSelector = '[data-testid="tsp-view"]';

export function useReclaimFocus(field: RefObject<HTMLTextAreaElement | null>, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let held: Element | null = null;
    const onFocusIn = (event: FocusEvent) => {
      held = event.target instanceof Element && event.target.closest(tspSelector) !== null ? event.target : null;
    };
    const observer = new MutationObserver(() => {
      if (held === null || held.isConnected) return;
      held = null;
      const active = document.activeElement;
      if ((active === null || active === document.body) && document.hasFocus()) {
        field.current?.focus({ preventScroll: true });
      }
    });
    const root = document.querySelector(tspSelector)?.parentElement ?? document.body;
    document.addEventListener("focusin", onFocusIn);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      observer.disconnect();
    };
  }, [field, enabled]);
}
