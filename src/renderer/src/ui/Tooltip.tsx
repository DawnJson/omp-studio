// 悬停提示（spec §4.23 Tooltip）：全应用的 title 属性都用这一个自绘提示显示，不再出 Windows 原生的提示框。
// 做法：指针移到带 title 的元素上，先把 title 从元素上拿掉、暂存起来（原生提示就不会出），500ms 后在元素下方画提示
// （下方放不下画在上方）；刚收起一个提示时移到下一个元素立即出。键盘聚焦（:focus-visible）时立即出，title 留在元素上
// （原生提示不跟键盘出，读屏照常读到它）。离开、按下、按键、滚动、窗口失焦时收起，title 放回原处。
// 悬停期间 React 改了 title（如"上次刷新于…"）：读出新文字、再拿掉。
// 文字末尾的快捷键（"打开评审 (Ctrl Shift D)"）拆出来画成 Kbd。
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

const SHOW_DELAY_MS = 500;
/** 一个提示收起后这段时间内指到下一个元素，直接显示（spec："已有一个显示时 0ms"）。 */
const WARM_MS = 400;
const GAP_PX = 6;
const EDGE_PX = 8;
/** iframe 的 title 是给读屏的框架名，不是提示。 */
const TITLED = "[title]:not(iframe)";
const SHORTCUT = /^([\s\S]*?)\s*[(（]((?:Ctrl|Alt|Shift|Esc|Enter|Tab|F\d+)\b[^()（）]*)[)）]$/;

interface Tip {
  text: string;
  anchor: DOMRect;
}

/** 文字和尾随快捷键（没有快捷键时 key 为 null）。 */
export function splitShortcut(text: string): { body: string; key: string | null } {
  const match = SHORTCUT.exec(text.trim());
  if (match === null || match[1]!.trim() === "") return { body: text.trim(), key: null };
  return { body: match[1]!.trim(), key: match[2]!.trim() };
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    let target: HTMLElement | null = null;
    let text = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let shown = false;
    let warmUntil = 0;
    const observer = new MutationObserver(() => {
      // 悬停期间 React 把 title 写回来了（文字变了）：换成新文字，再从元素上拿掉。
      const el = target;
      const next = el?.getAttribute("title");
      if (!el || next === null || next === undefined) return;
      text = next;
      el.removeAttribute("title");
      if (shown) setTip({ text, anchor: el.getBoundingClientRect() });
    });

    const hide = () => {
      clearTimeout(timer);
      observer.disconnect();
      if (shown) warmUntil = performance.now() + WARM_MS;
      shown = false;
      if (target && !target.hasAttribute("title")) target.setAttribute("title", text);
      target = null;
      setTip(null);
    };

    const show = (el: HTMLElement) => {
      if (target !== el || !el.isConnected) return;
      shown = true;
      setTip({ text, anchor: el.getBoundingClientRect() });
    };
    const begin = (el: HTMLElement, viaKeyboard: boolean) => {
      const title = el.getAttribute("title") ?? "";
      hide();
      if (title.trim() === "") return;
      target = el;
      text = title;
      if (viaKeyboard) {
        show(el);
        return;
      }
      el.removeAttribute("title");
      observer.observe(el, { attributes: true, attributeFilter: ["title"] });
      if (performance.now() < warmUntil) show(el);
      else timer = setTimeout(() => show(el), SHOW_DELAY_MS);
    };

    const onOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const node = event.target instanceof Element ? event.target : null;
      if (node === null) return;
      if (target?.contains(node)) return;
      const el = node.closest<HTMLElement>(TITLED);
      if (el === null) {
        if (target !== null) hide();
        return;
      }
      begin(el, false);
    };
    const onFocus = (event: FocusEvent) => {
      const el = event.target instanceof HTMLElement ? event.target : null;
      if (el === null || !el.matches(":focus-visible") || !el.matches(TITLED)) return;
      begin(el, true);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (event.target === target) hide();
    };
    const onLeave = () => {
      if (target !== null) hide();
    };

    const doc = document.documentElement;
    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("focusin", onFocus, true);
    document.addEventListener("focusout", onFocusOut, true);
    document.addEventListener("pointerdown", onLeave, true);
    document.addEventListener("keydown", onLeave, true);
    document.addEventListener("wheel", onLeave, { capture: true, passive: true });
    document.addEventListener("scroll", onLeave, true);
    doc.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    return () => {
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("focusin", onFocus, true);
      document.removeEventListener("focusout", onFocusOut, true);
      document.removeEventListener("pointerdown", onLeave, true);
      document.removeEventListener("keydown", onLeave, true);
      document.removeEventListener("wheel", onLeave, true);
      document.removeEventListener("scroll", onLeave, true);
      doc.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      hide();
    };
  }, []);

  return tip === null ? null : createPortal(<TooltipBubble tip={tip} />, document.body);
}

function TooltipBubble({ tip }: { tip: Tip }) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const { body, key } = splitShortcut(tip.text);

  // 先不可见地画出来量尺寸，再定位：默认在元素下方居中，下方放不下放上方，左右夹在窗口内。
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const { width, height } = el.getBoundingClientRect();
    const a = tip.anchor;
    const below = a.bottom + GAP_PX;
    const top = below + height + EDGE_PX <= window.innerHeight ? below : Math.max(EDGE_PX, a.top - GAP_PX - height);
    const centered = a.left + a.width / 2 - width / 2;
    const left = Math.min(Math.max(EDGE_PX, centered), window.innerWidth - EDGE_PX - width);
    setStyle({ top, left });
  }, [tip]);

  return (
    <div ref={ref} className="ui-tooltip" role="tooltip" data-testid="tooltip" style={style}>
      <span className="ui-tooltip-text">{body}</span>
      {key !== null && <kbd className="ui-kbd">{key}</kbd>}
    </div>
  );
}
