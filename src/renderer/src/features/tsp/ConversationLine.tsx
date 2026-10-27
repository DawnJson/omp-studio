// 过程区右侧的对话线（spec §4.14"对话线"）：会话里每条用户消息一个刻度，从上到下按发送顺序；点刻度把那条消息滚到视口顶部。
// 视口里正在读的那一轮（最后一条顶边在视口上 1/3 以上的消息）的刻度加深、加长。少于 2 条消息不画。
// 消息来自 TSP 文档（omp.user 卡片，shared/tsp/user-messages.ts），页面里按 `[data-id]` 找到卡片：每次消息列表变化后各找一次，
// 元素换掉（重挂载）了再找；滚动时按顶边二分（卡片在页面里按发送顺序排，顶边递增），每帧只读 O(log n) 个矩形。
import { useEffect, useRef, useState, type RefObject } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import {
  sameUserMessages,
  USER_MESSAGE_NODES,
  userMessages,
  type UserMessage,
} from "../../../../shared/tsp/user-messages.ts";
import { useT } from "../../i18n/use-t.ts";
import { useTspDerived } from "./tsp-store.ts";

const NONE: readonly UserMessage[] = [];
const PREVIEW_CHARS = 80;
/** 跳过去后消息顶边离视口顶部的距离（--space-4）。 */
const LANDING_GAP = 16;
/** 落点高亮淡掉的时长：提示动画，不走 --dur-* 档（那些在减少动效下归零）。 */
const LANDING_FLASH_MS = 900;

function preview(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= PREVIEW_CHARS ? line : `${line.slice(0, PREVIEW_CHARS - 1)}…`;
}

function card(scroller: HTMLElement, id: string): HTMLElement | null {
  return scroller.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
}

/** 落点提示：accent-soft 底 + 2px accent 环，从有到无淡掉。只动颜色，不属于位移，减少动效下也保留。再跳一次会重播。 */
function flashLanding(target: HTMLElement): void {
  const easing = getComputedStyle(document.documentElement).getPropertyValue("--ease-out").trim();
  // 只给起点帧：终点是元素自己原本的底色和阴影。
  target.animate([{ backgroundColor: "var(--accent-soft)", boxShadow: "0 0 0 2px var(--accent)" }], {
    duration: LANDING_FLASH_MS,
    easing,
  });
}

/** 正在读的消息：顶边在视口上 1/3 以上的最后一条；都在下面时是第一条；滚到底就是最后一条。页面里找不到卡片的消息跳过。 */
function currentIndex(
  scroller: HTMLElement,
  messages: readonly UserMessage[],
  cardOf: (id: string) => HTMLElement | null,
): number {
  if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) return messages.length - 1;
  const box = scroller.getBoundingClientRect();
  const line = box.top + box.height / 3;
  let current = 0;
  let lo = 0;
  let hi = messages.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    let probe = mid;
    let el = cardOf(messages[probe]!.id);
    while (el === null && probe > lo) {
      probe -= 1;
      el = cardOf(messages[probe]!.id);
    }
    if (el === null) lo = mid + 1;
    else if (el.getBoundingClientRect().top <= line) {
      current = probe;
      lo = mid + 1;
    } else hi = probe - 1;
  }
  return current;
}

/** 用户在滚动区里自己动了（滚轮、按下、按键）：落点不再保持。 */
const USER_SCROLL_EVENTS = ["wheel", "pointerdown", "keydown"] as const;

/** 跳过去以后的一小段时间里，对话列尺寸一变就把落点放回原处：离屏的消息块是 content-visibility: auto（tsp.css），
 *  按估计高度排，滚到附近才换成实际高度，落点上方的块变高变矮会把目标推走。返回停止函数。 */
function holdLanding(scroller: HTMLElement, place: () => void): () => void {
  const column = scroller.firstElementChild;
  if (column === null) return () => {};
  const observer = new ResizeObserver(place);
  observer.observe(column);
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
    for (const type of USER_SCROLL_EVENTS) scroller.removeEventListener(type, stop, true);
  };
  const timer = setTimeout(stop, LANDING_FLASH_MS);
  for (const type of USER_SCROLL_EVENTS) scroller.addEventListener(type, stop, { capture: true, passive: true });
  return stop;
}

export function ConversationLine({ taskId, scroller }: { taskId: TaskId; scroller: RefObject<HTMLElement | null> }) {
  const t = useT();
  const messages = useTspDerived(taskId, userMessages, sameUserMessages, USER_MESSAGE_NODES) ?? NONE;
  const [current, setCurrent] = useState(0);
  const stopLanding = useRef<(() => void) | null>(null);

  useEffect(() => {
    const el = scroller.current;
    if (el === null || messages.length < 2) return;
    const cards = new Map<string, HTMLElement | null>();
    const cardOf = (id: string): HTMLElement | null => {
      let found = cards.get(id);
      if (found === undefined || found === null || !found.isConnected) {
        found = card(el, id);
        cards.set(id, found);
      }
      return found;
    };
    let frame = 0;
    const update = () => {
      frame = 0;
      setCurrent(currentIndex(el, messages, cardOf));
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    el.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", schedule);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [scroller, messages]);

  useEffect(() => () => stopLanding.current?.(), []);

  if (messages.length < 2) return null;

  const jump = (id: string) => {
    const el = scroller.current;
    const target = el === null ? null : card(el, id);
    if (el === null || target === null) return;
    const place = () => {
      const delta = target.getBoundingClientRect().top - el.getBoundingClientRect().top - LANDING_GAP;
      if (Math.abs(delta) > 0.5) el.scrollTop += delta;
    };
    stopLanding.current?.();
    place();
    stopLanding.current = holdLanding(el, place);
    flashLanding(target);
  };

  return (
    <nav className="tsp-convline" aria-label={t("scroll.line")} data-testid="conversation-line">
      {messages.map((message, index) => {
        const label = t("scroll.lineItem", { n: index + 1, text: preview(message.text) });
        return (
          <button
            key={message.id}
            type="button"
            className="tsp-convline-tick"
            aria-label={label}
            aria-current={index === current ? "location" : undefined}
            title={label}
            data-testid="conversation-line-tick"
            onClick={() => jump(message.id)}
          />
        );
      })}
    </nav>
  );
}
