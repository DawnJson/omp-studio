// 自绘覆盖式细滚动条（spec 裁决"滚动条"）：原生滚动行为不变（滚轮、键盘、触摸），原生条隐藏；
// 这里画一个覆盖在内容上的细条：hover 容器或滚动时出现，可拖动，点轨道翻页。不占布局宽度，阅读列不会横移。
// 用法：宿主元素 position: relative，里面放滚动容器（scrollbar-width: none）和 <OverlayScrollbar target={ref} />。
import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import "./overlay-scrollbar.css";

const MIN_THUMB = 28;
const HIDE_DELAY_MS = 900;

interface Metrics {
  thumbTop: number;
  thumbHeight: number;
  trackHeight: number;
  scrollable: boolean;
}

const none: Metrics = { thumbTop: 0, thumbHeight: 0, trackHeight: 0, scrollable: false };

function measure(el: HTMLElement): Metrics {
  const { scrollHeight, clientHeight, scrollTop } = el;
  if (scrollHeight <= clientHeight + 1) return none;
  const thumbHeight = Math.max(MIN_THUMB, (clientHeight / scrollHeight) * clientHeight);
  const maxTop = clientHeight - thumbHeight;
  const thumbTop = (scrollTop / (scrollHeight - clientHeight)) * maxTop;
  return { thumbTop, thumbHeight, trackHeight: clientHeight, scrollable: true };
}

export function OverlayScrollbar({ target }: { target: RefObject<HTMLElement | null> }) {
  const [metrics, setMetrics] = useState<Metrics>(none);
  const [active, setActive] = useState(false);
  const [dragging, setDragging] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hovering = useRef(false);
  const drag = useRef<{ startY: number; startScroll: number } | null>(null);

  const update = useCallback(() => {
    const el = target.current;
    if (!el) return;
    setMetrics((previous) => {
      const next = measure(el);
      return previous.thumbTop === next.thumbTop &&
        previous.thumbHeight === next.thumbHeight &&
        previous.scrollable === next.scrollable
        ? previous
        : next;
    });
  }, [target]);

  const flash = useCallback(() => {
    setActive(true);
    clearTimeout(hideTimer.current);
    // 指针还在容器上时不自动隐藏。
    hideTimer.current = setTimeout(() => {
      if (!hovering.current) setActive(false);
    }, HIDE_DELAY_MS);
  }, []);

  useEffect(() => {
    const el = target.current;
    if (!el) return;
    const host = el.parentElement;
    let frame = 0;
    const schedule = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };
    const onScroll = () => {
      schedule();
      flash();
    };
    const onEnter = () => {
      hovering.current = true;
      update();
      setActive(true);
      clearTimeout(hideTimer.current);
    };
    const onLeave = () => {
      hovering.current = false;
      hideTimer.current = setTimeout(() => setActive(false), HIDE_DELAY_MS);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    host?.addEventListener("pointerenter", onEnter);
    host?.addEventListener("pointerleave", onLeave);
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    update();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(hideTimer.current);
      el.removeEventListener("scroll", onScroll);
      host?.removeEventListener("pointerenter", onEnter);
      host?.removeEventListener("pointerleave", onLeave);
      observer.disconnect();
    };
  }, [target, update, flash]);

  const onThumbDown = (event: PointerEvent<HTMLDivElement>) => {
    const el = target.current;
    if (!el) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, startScroll: el.scrollTop };
    setDragging(true);
  };
  const onThumbMove = (event: PointerEvent<HTMLDivElement>) => {
    const el = target.current;
    const state = drag.current;
    if (!el || !state) return;
    const range = metrics.trackHeight - metrics.thumbHeight;
    if (range <= 0) return;
    el.scrollTop = state.startScroll + ((event.clientY - state.startY) / range) * (el.scrollHeight - el.clientHeight);
  };
  const onThumbUp = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    flash();
  };
  // 点轨道（不是滑块）：向点击的方向翻一页。
  const onTrackDown = (event: PointerEvent<HTMLDivElement>) => {
    const el = target.current;
    if (!el || event.target !== event.currentTarget) return;
    const y = event.clientY - event.currentTarget.getBoundingClientRect().top;
    const direction = y < metrics.thumbTop ? -1 : 1;
    el.scrollBy({ top: direction * el.clientHeight * 0.9, behavior: "auto" });
  };

  if (!metrics.scrollable) return null;
  return (
    <div
      className="osb"
      data-visible={active || dragging || undefined}
      data-dragging={dragging || undefined}
      onPointerDown={onTrackDown}
      aria-hidden="true"
    >
      <div
        className="osb-thumb"
        style={{ height: metrics.thumbHeight, transform: `translateY(${metrics.thumbTop}px)` }}
        onPointerDown={onThumbDown}
        onPointerMove={onThumbMove}
        onPointerUp={onThumbUp}
        onPointerCancel={onThumbUp}
      />
    </div>
  );
}
