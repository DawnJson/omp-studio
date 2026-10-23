// `list.virtual` 的窗口状态：找最近的滚动祖先（list 自己带 max 时就是 list 的滚动区），读它的滚动位置和可见高度，
// 量真实行高，给出要画的下标范围；`scrollToIndex` 把还没画出来的行滚进视野。
import { useCallback, useLayoutEffect, useState, type RefObject } from "react";
import { listWindow, scrollDelta, VIRTUAL_ROW_ESTIMATE } from "./list-virtual.ts";

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node !== null; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll" || overflow === "overlay") return node;
  }
  return null;
}

function viewRect(parent: HTMLElement | null): { top: number; bottom: number } {
  if (parent) {
    const rect = parent.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  }
  return { top: 0, bottom: window.innerHeight };
}

export interface VirtualList {
  /** 要画的子项下标 [from, to)。 */
  range: [number, number];
  rowHeight: number;
  scrollToIndex(index: number, where: "start" | "end" | "nearest"): void;
}

/**
 * `body` 是包着实际画出来那些行的元素（上下用 padding 撑出没画的行）；行高从它的子元素量。
 * 滚动位置按行高取整后才进状态，滚动时不是每个像素都重画。
 */
export function useVirtualList(body: RefObject<HTMLElement | null>, count: number, enabled: boolean): VirtualList {
  const [rowHeight, setRowHeight] = useState(VIRTUAL_ROW_ESTIMATE);
  const [offset, setOffset] = useState(0);
  const [viewport, setViewport] = useState(600);

  useLayoutEffect(() => {
    const el = body.current;
    if (!enabled || !el) return;
    const parent = scrollParent(el);
    const target: HTMLElement | Window = parent ?? window;
    const measure = (): void => {
      const view = viewRect(parent);
      setOffset(Math.max(0, view.top - el.getBoundingClientRect().top));
      setViewport(Math.max(1, view.bottom - view.top));
    };
    measure();
    target.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(parent ?? document.documentElement);
    return () => {
      target.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [body, enabled]);

  const quantized = Math.floor(offset / rowHeight) * rowHeight;
  const range: [number, number] = enabled ? listWindow(count, rowHeight, quantized, viewport) : [0, count];
  const [from, to] = range;

  // 画出来的行变了就量真实行高（含行距）：偏差超过 1px 才更新，避免来回抖。
  useLayoutEffect(() => {
    const container = body.current;
    if (!enabled || !container) return;
    const first = container.firstElementChild as HTMLElement | null;
    const last = container.lastElementChild as HTMLElement | null;
    const n = container.childElementCount;
    if (!first || !last || n === 0) return;
    const pitch = n === 1 ? first.offsetHeight : (last.offsetTop + last.offsetHeight - first.offsetTop) / n;
    if (pitch > 0 && Math.abs(pitch - rowHeight) > 1) setRowHeight(Math.round(pitch));
  }, [body, enabled, from, to, rowHeight]);

  const scrollToIndex = useCallback(
    (index: number, where: "start" | "end" | "nearest") => {
      const el = body.current;
      if (!el) return;
      const parent = scrollParent(el);
      const view = viewRect(parent);
      // body 的上方 padding 就是没画出来的那些行：第 index 行相对 body 顶是 index * 行高。
      const rowTop = el.getBoundingClientRect().top + index * rowHeight;
      const delta = scrollDelta(rowTop, rowTop + rowHeight, view.top, view.bottom, where);
      if (delta === 0) return;
      if (parent) parent.scrollTop += delta;
      else window.scrollBy(0, delta);
    },
    [body, rowHeight],
  );

  return { range, rowHeight, scrollToIndex };
}
