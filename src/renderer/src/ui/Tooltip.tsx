// 悬停提示（spec §4.23 Tooltip）：全应用的 title 属性都用这一个自绘提示显示，不再出 Windows 原生的提示框。
// 做法：指针移到带 title 的元素上，先把 title 从元素和它所有的祖先上拿掉、暂存起来（原生提示就不会出；只拿元素自己的，浏览器会拿外层的 title 出原生提示），500ms 后在元素下方画提示
// （下方放不下画在上方）；刚收起一个提示时移到下一个元素立即出。键盘聚焦（input-modality 的 keyboardFocused）时立即出，title 留在元素上
// （原生提示不跟键盘出，读屏照常读到它）。按下、按键、滚动、窗口失焦时只收起提示，title 仍拿着，直到指针移到别的元素或离开窗口才放回：
// 放回时指针还停在元素上的话，指针一动浏览器就拿 title 出 Windows 原生提示（2026-11-10 仓库所有者："有的时候还会显示 win 原本的样式"）。
// 悬停期间 React 改了 title（如"上次刷新于…"）：读出新文字、再拿掉。
// 文字末尾的快捷键（"打开评审 (Ctrl Shift D)"；mac 上是 "(⌘⇧D)"，调用方用 platform-keys 的 withShortcut 生成）拆出来画成 Kbd。
// 元素或它的祖先带 `data-tip-side` 时改放法：`top` 先画在上方（上方放不下再到下方；浏览器面板头部下面是原生页面，画在下方会被盖住），
// `left` 画在左边、竖直居中（左边放不下退回默认；对话线的刻度贴着滚动区右缘，画在下方会盖住滚动条）。
// 带 `data-tip-overflow` 的单行文字（省略号截断的名称、元信息）：只在被截断、显示不全时把全文当提示画出来；放得下时不出，
// 免得把看得见的字再写一遍（2026-10-30 仓库所有者定）。它里面或外面离指针更近的 title 优先。
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { keyboardFocused } from "./input-modality.ts";
import { usePresence, type ExitProps } from "./presence.ts";

const SHOW_DELAY_MS = 500;
/** 一个提示收起后这段时间内指到下一个元素，直接显示（spec："已有一个显示时 0ms"）。 */
const WARM_MS = 400;
const GAP_PX = 6;
const EDGE_PX = 8;
/** iframe 的 title 是给读屏的框架名，不是提示。 */
const TITLED = "[title]:not(iframe)";
const TIPPED = `${TITLED}, [data-tip-overflow]`;
const SHORTCUT = /^([\s\S]*?)\s*[(（]((?:(?:Ctrl|Alt|Shift|Esc|Enter|Tab|F\d+)\b|[⌘⇧⌥⌃])[^()（）]*)[)）]$/;

type TipSide = "top" | "left" | null;

interface Tip {
  text: string;
  anchor: DOMRect;
  /** `data-tip-side` 指定的放法；null = 默认（下方，放不下到上方）。 */
  side: TipSide;
}

const tipSide = (el: HTMLElement): TipSide => {
  const side = el.closest("[data-tip-side]")?.getAttribute("data-tip-side");
  return side === "top" || side === "left" ? side : null;
};

const tipFor = (el: HTMLElement, text: string): Tip => ({
  text,
  anchor: el.getBoundingClientRect(),
  side: tipSide(el),
});

/** 指针下离它最近的提示：带 title 的元素，或带 data-tip-overflow 且文字被截断的元素（没截断就接着往外找）。 */
function tipSource(node: Element): { el: HTMLElement; text: string; titled: boolean } | null {
  for (
    let el = node.closest<HTMLElement>(TIPPED);
    el !== null;
    el = el.parentElement?.closest<HTMLElement>(TIPPED) ?? null
  ) {
    if (el.matches(TITLED)) return { el, text: el.getAttribute("title") ?? "", titled: true };
    if (el.scrollWidth > el.clientWidth) return { el, text: el.textContent ?? "", titled: false };
  }
  return null;
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
    /** 指针下的提示来源；指针在它里面移动不重新开始。 */
    let hovered: HTMLElement | null = null;
    /** 指针悬停期间拿掉的 title（来源自己的和所有祖先的）：只拿自己的，浏览器会拿离指针最近的祖先的 title 出原生提示
     * （回答下面那行用量带 title，指到复制 / 分叉图标时出过 Windows 样式的提示，2026-11-09 仓库所有者）。
     * 指针移到别的元素、离开窗口时才放回；提示收起（按下、按键、滚动、失焦）不放回。 */
    let stripped: [HTMLElement, string][] = [];
    /** 正在等或正在显示的提示。 */
    let target: HTMLElement | null = null;
    let text = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let shown = false;
    let warmUntil = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const el = record.target as HTMLElement;
        const next = el.getAttribute("title");
        if (next === null) continue;
        el.removeAttribute("title");
        // 悬停期间 React 把 title 写回来了（文字变了）：记下新文字，放回时用；正显示的是它的提示就换成新文字。
        const entry = stripped.find(([up]) => up === el);
        if (entry !== undefined) entry[1] = next;
        if (el !== target) continue;
        text = next;
        if (shown) setTip(tipFor(el, text));
      }
    });

    /** 元素的提示文字：title 被拿掉了的从暂存里取。 */
    const titleOf = (el: HTMLElement) => stripped.find(([up]) => up === el)?.[1] ?? el.getAttribute("title") ?? "";

    const closeTip = () => {
      clearTimeout(timer);
      if (shown) warmUntil = performance.now() + WARM_MS;
      shown = false;
      target = null;
      setTip(null);
    };
    const restore = () => {
      observer.disconnect();
      for (const [el, title] of stripped) if (!el.hasAttribute("title")) el.setAttribute("title", title);
      stripped = [];
      hovered = null;
    };
    const strip = (el: HTMLElement | null | undefined) => {
      for (let up = el; up; up = up.parentElement?.closest<HTMLElement>(TITLED)) {
        stripped.push([up, up.getAttribute("title") ?? ""]);
        up.removeAttribute("title");
        observer.observe(up, { attributes: true, attributeFilter: ["title"] });
      }
    };

    const show = (el: HTMLElement) => {
      if (target !== el || !el.isConnected) return;
      shown = true;
      setTip(tipFor(el, text));
    };

    const onOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const node = event.target instanceof Element ? event.target : null;
      if (node === null) return;
      if (hovered?.contains(node)) return;
      // 先放回拿掉的 title：从图标移到带 title 的外层（它的 title 正被拿掉）时要能找到它。
      closeTip();
      restore();
      const source = tipSource(node);
      if (source === null) return;
      hovered = source.el;
      strip(source.titled ? source.el : source.el.parentElement?.closest<HTMLElement>(TITLED));
      if (source.text.trim() === "") return;
      target = source.el;
      text = source.text;
      if (performance.now() < warmUntil) show(source.el);
      else timer = setTimeout(() => show(source.el), SHOW_DELAY_MS);
    };
    const onFocus = (event: FocusEvent) => {
      const el = event.target instanceof HTMLElement ? event.target : null;
      if (el === null || !keyboardFocused(el)) return;
      const tipText = titleOf(el);
      if (tipText.trim() === "" || !(el.matches(TITLED) || stripped.some(([up]) => up === el))) return;
      closeTip();
      target = el;
      text = tipText;
      show(el);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (event.target === target) closeTip();
    };
    const onLeave = () => {
      closeTip();
      restore();
    };

    const doc = document.documentElement;
    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("focusin", onFocus, true);
    document.addEventListener("focusout", onFocusOut, true);
    document.addEventListener("pointerdown", closeTip, true);
    document.addEventListener("keydown", closeTip, true);
    document.addEventListener("wheel", closeTip, { capture: true, passive: true });
    document.addEventListener("scroll", closeTip, true);
    doc.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", closeTip);
    return () => {
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("focusin", onFocus, true);
      document.removeEventListener("focusout", onFocusOut, true);
      document.removeEventListener("pointerdown", closeTip, true);
      document.removeEventListener("keydown", closeTip, true);
      document.removeEventListener("wheel", closeTip, true);
      document.removeEventListener("scroll", closeTip, true);
      doc.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", closeTip);
      onLeave();
    };
  }, []);

  // 收起时淡出（出现时淡入；2026-11-11 仓库所有者：开有动画关没有的情况要杜绝）。淡出期间沿用最后一个提示；
  // 淡出没放完就指到下一个元素时直接换成新的提示。
  const presence = usePresence(tip !== null, "fade");
  const shown = useRef(tip);
  if (tip !== null) shown.current = tip;
  const last = tip ?? shown.current;
  return presence.mounted && last !== null
    ? createPortal(<TooltipBubble tip={last} exitProps={presence.exitProps} />, document.body)
    : null;
}

function TooltipBubble({ tip, exitProps }: { tip: Tip; exitProps: ExitProps }) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const { body, key } = splitShortcut(tip.text);

  // 先不可见地画出来量尺寸，再定位：默认在元素下方居中，下方放不下放上方（`top` 时反过来），左右夹在窗口内；
  // `left` 放在元素左边、竖直居中、上下夹在窗口内，左边放不下时按默认放。
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const { width, height } = el.getBoundingClientRect();
    const a = tip.anchor;
    const beside = a.left - GAP_PX - width;
    if (tip.side === "left" && beside >= EDGE_PX) {
      const middle = a.top + a.height / 2 - height / 2;
      setStyle({ top: Math.min(Math.max(EDGE_PX, middle), window.innerHeight - EDGE_PX - height), left: beside });
      return;
    }
    const below = a.bottom + GAP_PX;
    const over = a.top - GAP_PX - height;
    const fitsBelow = below + height + EDGE_PX <= window.innerHeight;
    const putOver = tip.side === "top" ? over >= EDGE_PX || !fitsBelow : !fitsBelow;
    const top = putOver ? Math.max(EDGE_PX, over) : below;
    const centered = a.left + a.width / 2 - width / 2;
    const left = Math.min(Math.max(EDGE_PX, centered), window.innerWidth - EDGE_PX - width);
    setStyle({ top, left });
  }, [tip]);

  return (
    <div ref={ref} className="ui-tooltip" role="tooltip" data-testid="tooltip" style={style} {...exitProps}>
      <span className="ui-tooltip-text">{body}</span>
      {key !== null && <kbd className="ui-kbd">{key}</kbd>}
    </div>
  );
}
