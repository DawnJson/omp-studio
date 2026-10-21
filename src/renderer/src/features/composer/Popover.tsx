// 自胶囊上方弹出的浮层。点外面、Esc 关闭；关闭后焦点回到触发器（`/todo`、`/jobs` 从输入框打开的，焦点就留在输入框）。
// 同一时刻只开一个：新开的浮层会关掉已开的；Esc 只关最上面（最后打开）的一个，并且被消耗，不会再触发"停止"。
// Esc 在焦点于输入框、胶囊或浮层里时都管；焦点在 aria-modal 对话框或 TSP 过程区（那里的 Esc 是写给 omp 的按键）时不管。
// 关闭时先放退出动画再卸载（presence.ts）。
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { usePresence } from "../../ui/presence.ts";

interface PopoverProps {
  open: boolean;
  onClose(): void;
  children: ReactNode;
  width?: number | undefined;
  align?: "start" | "end";
  label: string;
}

/** 浮层离可见区域（最近的裁剪祖先，一般是主区面板）边缘至少留这么多。 */
const edge = 8;

/** 最近的会裁剪内容的祖先（overflow 不是 visible）；没有就是窗口。 */
function clipRect(el: HTMLElement): DOMRect {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.overflowX !== "visible" || style.overflowY !== "visible") return node.getBoundingClientRect();
  }
  return new DOMRect(0, 0, window.innerWidth, window.innerHeight);
}

/** 浮层贴着触发它的胶囊弹出；放不下时横向挪回可见区域，宽高也不超过它（不会被主区面板裁掉）。 */
function fitInside(el: HTMLElement): void {
  el.style.translate = "";
  const bounds = clipRect(el);
  el.style.maxWidth = `${Math.max(0, bounds.width - 2 * edge)}px`;
  const rect = el.getBoundingClientRect();
  el.style.maxHeight = `min(60vh, ${Math.max(0, Math.floor(rect.bottom - bounds.top - edge))}px)`;
  let dx = 0;
  if (rect.right > bounds.right - edge) dx = bounds.right - edge - rect.right;
  if (rect.left + dx < bounds.left + edge) dx = bounds.left + edge - rect.left;
  if (dx !== 0) el.style.translate = `${Math.round(dx)}px 0`;
}

/** 已打开的浮层，后开的在后面。 */
const openStack: { close(): void }[] = [];

export function Popover({ open, onClose, children, width, align = "start", label }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const presence = usePresence(open);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // 打开时和内容尺寸变化（读取中 -> 有数据）时重新摆放；translate 和进入动画的 transform 互不干扰。
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || el === null) return;
    fitInside(el);
    const observer = new ResizeObserver(() => fitInside(el));
    observer.observe(el);
    window.addEventListener("resize", onResize);
    function onResize() {
      if (el !== null) fitInside(el);
    }
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement;
    const entry = { close: () => onCloseRef.current() };
    // 拷一份再遍历：close 可能同步触发别的浮层清理，从 openStack 里删掉自己。
    for (const other of openStack.slice()) other.close();
    openStack.push(entry);
    // 卸载时 React 先把 ref.current 清成 null 再跑清理函数，所以在这里先取。
    const root = ref.current;
    const onPointerDown = (event: PointerEvent) => {
      const anchor = ref.current?.parentElement;
      if (event.target instanceof Node && anchor && !anchor.contains(event.target)) onCloseRef.current();
    };
    // 捕获阶段：先于输入框的 Esc（停止）处理；只有最上面的浮层响应。
    const onKeyDown = (event: KeyboardEvent) => {
      const anchor = ref.current?.parentElement;
      if (event.key !== "Escape" || !anchor || openStack.at(-1) !== entry) return;
      const active = document.activeElement;
      const away =
        active instanceof Element && active.closest(`[aria-modal="true"], [data-testid="tsp-view"]`) !== null;
      if (away && !anchor.contains(active)) return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      openStack.splice(openStack.indexOf(entry), 1);
      if (
        trigger instanceof HTMLElement &&
        trigger.isConnected &&
        (document.activeElement === document.body || root?.contains(document.activeElement))
      )
        trigger.focus();
    };
  }, [open]);
  if (!presence.mounted) return null;
  return (
    <div
      ref={ref}
      className="pop"
      role="dialog"
      aria-label={label}
      data-align={align}
      style={width ? { width } : undefined}
      {...presence.exitProps}
    >
      {children}
    </div>
  );
}
