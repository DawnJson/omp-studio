// 滚动管理（spec 5.4）：吸底、"回到最新"、缩放保位置、切任务记位置、展开/折叠以被点击元素为锚。
// 唯一的滚动容器是 scroller；content 是它里面的列。吸底时布局变化后在 ResizeObserver 回调里直接把 scrollTop 设到底：
// 回调在排版之后、绘制之前，这一帧画出来就已经在底部。留到下一个 rAF 设，长出来的内容会先在底边下面画一帧再跳上来（闪一下）。
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { onStickToBottomRequest } from "./scroll-bus.ts";

const STICK_THRESHOLD = 48;

interface SavedScroll {
  top: number;
  stuck: boolean;
}
/** 各任务的滚动位置（切任务回来时恢复）。 */
const saved = new Map<string, SavedScroll>();

interface Anchor {
  element: Element;
  offset: number;
}

/** 最外层的 `[data-anchor]` 块，按文档顺序。内层块的底边不超过外层块，"底边在视口顶部以下的第一个块"总是最外层的；
 *  最外层块依次排开、底边递增，可以二分。 */
function outermostAnchors(root: Element): Element[] {
  const out: Element[] = [];
  for (const node of root.querySelectorAll("[data-anchor]")) {
    const last = out.at(-1);
    if (last === undefined || !last.contains(node)) out.push(node);
  }
  return out;
}

/** 底边在 `top` 以下的第一个块；不画的块（display: none，矩形全 0）跳过。列表里有已经摘掉的元素时返回 undefined（要重建）。 */
function firstBelow(list: readonly Element[], top: number): Element | null | undefined {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    let probe = mid;
    let rect: DOMRect | null = null;
    for (; probe >= lo; probe -= 1) {
      const node = list[probe]!;
      if (!node.isConnected) return undefined;
      const box = node.getBoundingClientRect();
      if (box.width !== 0 || box.height !== 0) {
        rect = box;
        break;
      }
    }
    if (rect !== null && rect.bottom > top + 1) hi = probe;
    else lo = mid + 1;
  }
  return list[lo] ?? null;
}

export interface StickToBottom {
  /** 脱离吸底且有新内容时为 true：显示"回到最新"。 */
  showJump: boolean;
  scrollToBottom(): void;
}

export function useStickToBottom(
  taskId: TaskId,
  scroller: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
): StickToBottom {
  const stuck = useRef(true);
  const lastProgrammaticTop = useRef(-1);
  const lastTop = useRef(0);
  const anchor = useRef<Anchor | null>(null);
  /** outermostAnchors 的缓存：对话列的直接子元素增删时作废。 */
  const anchors = useRef<Element[] | null>(null);
  const pendingToggle = useRef<{ element: Element; top: number } | null>(null);
  const [showJump, setShowJump] = useState(false);

  const pinToBottom = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const target = el.scrollHeight - el.clientHeight;
    lastProgrammaticTop.current = target;
    el.scrollTop = target;
    lastTop.current = el.scrollTop;
  }, [scroller]);

  const scrollToBottom = useCallback(() => {
    stuck.current = true;
    setShowJump(false);
    pinToBottom();
  }, [pinToBottom]);

  /** 记录阅读锚点：视口顶部下方第一个可见块和它的相对偏移。 */
  const recordAnchor = useCallback(() => {
    const el = scroller.current;
    const root = content.current;
    if (!el || !root || stuck.current) return;
    const top = el.getBoundingClientRect().top;
    anchors.current ??= outermostAnchors(root);
    let candidate = firstBelow(anchors.current, top);
    if (candidate === undefined) {
      anchors.current = outermostAnchors(root);
      candidate = firstBelow(anchors.current, top);
    }
    anchor.current = candidate ? { element: candidate, offset: candidate.getBoundingClientRect().top - top } : null;
  }, [scroller, content]);

  // 切任务：恢复该任务上次的位置和吸底状态（默认吸底）。
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const previous = saved.get(taskId);
    stuck.current = previous?.stuck ?? true;
    setShowJump(false);
    if (stuck.current) el.scrollTop = el.scrollHeight;
    else el.scrollTop = previous?.top ?? 0;
    lastTop.current = el.scrollTop;
    lastProgrammaticTop.current = el.scrollTop;
    return () => {
      saved.set(taskId, { top: el.scrollTop, stuck: stuck.current });
    };
  }, [taskId, scroller]);

  useEffect(() => {
    const el = scroller.current;
    const root = content.current;
    if (!el || !root) return;
    anchors.current = null;

    // 上次滚动事件时的可滚范围。scroll 事件晚一帧才派发：omp 先收起上方的块（内容变矮，浏览器把 scrollTop 夹小），
    // 同一帧里又长出新内容，到这里读到的就是"scrollTop 变小、离底很远"，看着像用户上滚，其实是布局变化。
    let lastRange = el.scrollHeight - el.clientHeight;
    // 按着鼠标 / 触摸时（拖滚动条、拖选文字）的上滚，可滚范围在变也算用户的。
    let pressed = false;
    const onScroll = () => {
      const programmatic = Math.abs(el.scrollTop - lastProgrammaticTop.current) < 1;
      const range = el.scrollHeight - el.clientHeight;
      const distance = range - el.scrollTop;
      const layoutDriven = range !== lastRange && !pressed;
      lastRange = range;
      if (distance <= STICK_THRESHOLD) {
        stuck.current = true;
        setShowJump(false);
      } else if (!programmatic && !layoutDriven && el.scrollTop < lastTop.current - 0.5) {
        // 用户主动向上（或"对话线"跳到前面的消息）：立即脱离吸底。
        stuck.current = false;
      }
      lastTop.current = el.scrollTop;
      if (!stuck.current) recordAnchor();
    };
    const onPointerDown = () => {
      pressed = true;
    };
    const onPointerUp = () => {
      pressed = false;
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) stuck.current = false;
    };
    const onKey = (event: KeyboardEvent) => {
      if (["PageUp", "Home", "ArrowUp"].includes(event.key)) stuck.current = false;
      if (event.key === "End") scrollToBottom();
    };

    // 内容尺寸变化（流式追加、展开、窗口缩放重排）：吸底就跟到底；否则让锚点块回到原来的视口偏移（浏览器的滚动锚定关着，
    // 见 tsp.css .tsp-scroller；离屏的消息块是 content-visibility: auto，滚到附近才从估计高度换成实际高度），
    // 底下长出新内容时提示"回到最新"。
    let lastHeight = root.offsetHeight;
    let lastWidth = root.offsetWidth;
    const contentObserver = new ResizeObserver(() => {
      const widthChanged = root.offsetWidth !== lastWidth;
      const grownBy = root.offsetHeight - lastHeight;
      lastHeight = root.offsetHeight;
      lastWidth = root.offsetWidth;
      if (stuck.current) {
        pinToBottom();
        return;
      }
      let shift = 0;
      if (anchor.current?.element.isConnected) {
        shift =
          anchor.current.element.getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.current.offset;
        if (Math.abs(shift) > 0.5) {
          el.scrollTop += shift;
          lastProgrammaticTop.current = el.scrollTop;
        }
      }
      if (!widthChanged && grownBy > Math.max(shift, 0) + 0.5) setShowJump(true);
      lastTop.current = el.scrollTop;
    });
    contentObserver.observe(root);
    const anchorsObserver = new MutationObserver(() => {
      anchors.current = null;
    });
    anchorsObserver.observe(root, { childList: true });
    // 滚动区本身变高/变矮（门出现、输入框增高）：吸底时保持吸底；不改变阅读位置。
    const scrollerObserver = new ResizeObserver(() => {
      if (stuck.current) pinToBottom();
    });
    scrollerObserver.observe(el);

    // 展开/折叠任意块以被点击元素为锚：它在视口里的位置不变。
    const onClickCapture = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("[data-anchor]") : null;
      if (!target || stuck.current) return;
      pendingToggle.current = { element: target, top: target.getBoundingClientRect().top };
      requestAnimationFrame(() => {
        const pending = pendingToggle.current;
        pendingToggle.current = null;
        if (!pending?.element.isConnected) return;
        const delta = pending.element.getBoundingClientRect().top - pending.top;
        if (Math.abs(delta) > 0.5) {
          el.scrollTop += delta;
          lastProgrammaticTop.current = el.scrollTop;
          lastTop.current = el.scrollTop;
          // 阅读锚点跟着改：同一帧里内容的 ResizeObserver 还会按锚点补偿一次，用旧偏移会把这次补偿抵消掉。
          recordAnchor();
        }
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("keydown", onKey);
    el.addEventListener("click", onClickCapture, true);
    // 滚动条（OverlayScrollbar）在滚动区外面，按下 / 松开都在 window 上听。
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);
    const stopBus = onStickToBottomRequest((id) => {
      if (id === taskId) scrollToBottom();
    });
    return () => {
      contentObserver.disconnect();
      anchorsObserver.disconnect();
      scrollerObserver.disconnect();
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("click", onClickCapture, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      stopBus();
    };
  }, [taskId, scroller, content, pinToBottom, recordAnchor, scrollToBottom]);

  return { showJump, scrollToBottom };
}
