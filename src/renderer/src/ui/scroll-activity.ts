// 滚动活动标记：全局滚动条（scrollbars.css）只在滚动时显示。scroll 事件不冒泡，所以在 document 上用捕获阶段统一监听，
// 给正在滚动的元素挂 data-scrolling，停 SCROLL_LINGER_MS 后摘掉。组件不需要任何代码。
const SCROLL_LINGER_MS = 800;

const timers = new WeakMap<Element, number>();

function scrollingElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Document) return target.documentElement;
  return null;
}

/** 装一次，整个窗口生命周期有效。 */
export function installScrollActivity(): void {
  document.addEventListener(
    "scroll",
    (event) => {
      const element = scrollingElement(event.target);
      if (!element) return;
      // 已经挂着就只续期，不重复写属性（写属性会触发样式重算）。
      if (!element.hasAttribute("data-scrolling")) element.setAttribute("data-scrolling", "");
      const pending = timers.get(element);
      if (pending !== undefined) window.clearTimeout(pending);
      timers.set(
        element,
        window.setTimeout(() => {
          element.removeAttribute("data-scrolling");
          timers.delete(element);
        }, SCROLL_LINGER_MS),
      );
    },
    { capture: true, passive: true },
  );
}
