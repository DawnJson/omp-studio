// 过程区右侧的对话线（spec §4.15"对话线"）：会话里每条用户消息一个刻度，从上到下按发送顺序；点刻度把那条消息滚到视口顶部。
// 视口里正在读的那一轮（最后一条顶边在视口上 1/3 以上的消息）的刻度加深、加长。少于 2 条消息不画。
// 消息来自 TSP 文档（omp.user 卡片，shared/tsp/user-messages.ts），页面里按 `[data-id]` 找到卡片：每次消息列表变化后各找一次，
// 元素换掉（重挂载）了再找；滚动时按顶边二分（卡片在页面里按发送顺序排，顶边递增），每帧只读 O(log n) 个矩形。
// 大纲（2026-11-09）：悬停或键盘聚焦对话线时，刻度左边展开一张大纲，每条消息一行（序号 + 第一行文字），点行同点刻度；
// 离开 300ms 收起，Esc 收起回到刻度。上一轮 / 下一轮（Ctrl Shift ↑/↓，use-shortcuts → studio 命令）和命令面板"对话大纲"也在这里处理。
import { useContext, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type RefObject } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import {
  outlineLabel,
  sameUserMessages,
  USER_MESSAGE_NODES,
  userMessages,
  type UserMessage,
} from "../../../../shared/tsp/user-messages.ts";
import { useT } from "../../i18n/use-t.ts";
import { requestLeaveBottom } from "../conversation/scroll-bus.ts";
import { onStudioCommand } from "../palette/studio-command.ts";
import { TspParkedCtx } from "./tsp-context.ts";
import { useTspDerived } from "./tsp-store.ts";

const NONE: readonly UserMessage[] = [];
const PREVIEW_CHARS = 80;
/** 跳过去后消息顶边离视口顶部的距离（--space-4）。 */
const LANDING_GAP = 16;
/** 落点高亮淡掉的时长：提示动画，不走 --dur-* 档（那些在减少动效下归零）。 */
const LANDING_FLASH_MS = 900;
/** 指针离开对话线 / 大纲后多久收起大纲：从刻度移到大纲要跨过中间的空隙。 */
const OUTLINE_CLOSE_MS = 300;

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

/** 在一组按钮里按 ↑/↓ 移焦点（到头不动）。返回是否处理了。 */
function moveFocus(event: KeyboardEvent<HTMLElement>, container: HTMLElement | null): boolean {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || container === null) return false;
  event.preventDefault();
  const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")];
  const at = buttons.findIndex((button) => button === document.activeElement);
  const next = buttons[Math.min(buttons.length - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)))];
  next?.focus();
  return true;
}

export function ConversationLine({ taskId, scroller }: { taskId: TaskId; scroller: RefObject<HTMLElement | null> }) {
  const t = useT();
  const parked = useContext(TspParkedCtx);
  const messages = useTspDerived(taskId, userMessages, sameUserMessages, USER_MESSAGE_NODES) ?? NONE;
  const [current, setCurrent] = useState(0);
  const stopLanding = useRef<(() => void) | null>(null);
  /** 刚跳到的那条和跳完的 scrollTop：滚动位置没变时它就是"正在读的"（短对话滚不到让它在顶上，按位置算会算成最后一条）。 */
  const pinned = useRef<{ index: number; scrollTop: number } | null>(null);
  /** 按位置重算当前那条（effect 里装好，键盘上一轮 / 下一轮现算起点用）。 */
  const reading = useRef<() => number>(() => 0);
  const nav = useRef<HTMLElement>(null);
  const outline = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  /** 打开后把焦点放进大纲的当前行（命令面板"对话大纲"）。 */
  const [focusRow, setFocusRow] = useState(false);
  /** Esc 收起之后：指针重新进来或焦点离开之前不再展开。 */
  const [dismissed, setDismissed] = useState(false);
  const closeTimer = useRef(0);
  const open = (hovered || focused) && !dismissed;

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
    const compute = (): number => {
      const pin = pinned.current;
      if (pin !== null && pin.index < messages.length && Math.abs(el.scrollTop - pin.scrollTop) < 1) return pin.index;
      pinned.current = null;
      return currentIndex(el, messages, cardOf);
    };
    reading.current = compute;
    let frame = 0;
    const update = () => {
      frame = 0;
      setCurrent(compute());
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

  useEffect(
    () => () => {
      stopLanding.current?.();
      clearTimeout(closeTimer.current);
    },
    [],
  );

  const jump = (index: number) => {
    const el = scroller.current;
    const message = messages[index];
    const target = el === null || message === undefined ? null : card(el, message.id);
    if (el === null || target === null) return;
    const place = () => {
      const delta = target.getBoundingClientRect().top - el.getBoundingClientRect().top - LANDING_GAP;
      if (Math.abs(delta) > 0.5) el.scrollTop += delta;
      pinned.current = { index, scrollTop: el.scrollTop };
    };
    stopLanding.current?.();
    requestLeaveBottom(taskId);
    place();
    setCurrent(index);
    stopLanding.current = holdLanding(el, place);
    flashLanding(target);
  };
  const jumpRef = useRef(jump);
  jumpRef.current = jump;

  // 上一轮 / 下一轮、命令面板"对话大纲"。设置页盖着（parked）时不翻页；大纲照开（命令面板先切回对话页）。
  useEffect(
    () =>
      onStudioCommand((command) => {
        if (messages.length < 2) return;
        if (command === "outline") {
          setDismissed(false);
          setFocused(true);
          setFocusRow(true);
        } else if ((command === "prevTurn" || command === "nextTurn") && !parked) {
          const from = reading.current();
          const to = Math.min(messages.length - 1, Math.max(0, from + (command === "nextTurn" ? 1 : -1)));
          if (to !== from) jumpRef.current(to);
        }
      }),
    [messages, parked],
  );

  useEffect(() => {
    if (!open) return;
    const row = outline.current?.querySelector<HTMLElement>('[aria-current="location"]');
    row?.scrollIntoView({ block: "nearest" });
    if (focusRow) {
      row?.focus();
      setFocusRow(false);
    }
  }, [open, focusRow, current]);

  if (messages.length < 2) return null;

  const hoverOn = () => {
    clearTimeout(closeTimer.current);
    setDismissed(false);
    setHovered(true);
  };
  const hoverOff = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setHovered(false), OUTLINE_CLOSE_MS);
  };
  // 只认键盘带进来的焦点（:focus-visible）：鼠标点了行 / 刻度以后，指针离开照样收起。
  const focusIn = (event: FocusEvent) => {
    if (event.target instanceof Element && event.target.matches(":focus-visible")) setFocused(true);
  };
  const focusOut = (event: FocusEvent) => {
    const next = event.relatedTarget;
    if (next instanceof Node && (nav.current?.contains(next) || outline.current?.contains(next))) return;
    setFocused(false);
    setDismissed(false);
  };
  const closeToTick = (event: KeyboardEvent<HTMLElement>) => {
    if (!open || event.key !== "Escape" || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey)
      return false;
    // 不让 Esc 再往下走（写给 omp = 中断、输入框的停止）。
    event.preventDefault();
    event.stopPropagation();
    clearTimeout(closeTimer.current);
    setDismissed(true);
    nav.current?.querySelectorAll<HTMLButtonElement>("button")[current]?.focus();
    return true;
  };

  return (
    <>
      {open && (
        <div
          ref={outline}
          className="tsp-outline"
          role="group"
          aria-label={t("scroll.outline")}
          data-testid="conversation-outline"
          onPointerEnter={hoverOn}
          onPointerLeave={hoverOff}
          onFocus={focusIn}
          onBlur={focusOut}
          onKeyDown={(event) => {
            if (!closeToTick(event)) moveFocus(event, outline.current);
          }}
        >
          {messages.map((message, index) => (
            <button
              key={message.id}
              type="button"
              className="tsp-outline-row"
              aria-current={index === current ? "location" : undefined}
              data-testid="conversation-outline-row"
              onClick={() => jump(index)}
            >
              <span className="tsp-outline-n">{index + 1}</span>
              <span className="tsp-outline-text">{outlineLabel(message.text)}</span>
            </button>
          ))}
        </div>
      )}
      <nav
        ref={nav}
        className="tsp-convline"
        aria-label={t("scroll.line")}
        data-testid="conversation-line"
        onPointerEnter={hoverOn}
        onPointerLeave={hoverOff}
        onFocus={focusIn}
        onBlur={focusOut}
        onKeyDown={(event) => {
          if (!closeToTick(event)) moveFocus(event, nav.current);
        }}
      >
        {messages.map((message, index) => {
          const label = t("scroll.lineItem", { n: index + 1, text: preview(message.text) });
          return (
            <button
              key={message.id}
              type="button"
              className="tsp-convline-tick"
              aria-label={label}
              aria-current={index === current ? "location" : undefined}
              data-testid="conversation-line-tick"
              onClick={() => jump(index)}
            />
          );
        })}
      </nav>
    </>
  );
}
