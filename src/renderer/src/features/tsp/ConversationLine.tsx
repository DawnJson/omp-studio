// 过程区右侧的对话线（spec §4.14"对话线"）：会话里每条用户消息一个刻度，从上到下按发送顺序；点刻度把那条消息滚到视口顶部。
// 视口里正在读的那一轮（最后一条顶边在视口上 1/3 以上的消息）的刻度加深、加长。少于 2 条消息不画。
// 消息来自 TSP 文档（omp.user 卡片，shared/tsp/user-messages.ts），页面里按 `[data-id]` 找到卡片。
import { useEffect, useState, type RefObject } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { sameUserMessages, userMessages, type UserMessage } from "../../../../shared/tsp/user-messages.ts";
import { useT } from "../../i18n/use-t.ts";
import { useTspDerived } from "./tsp-store.ts";

const NONE: readonly UserMessage[] = [];
const PREVIEW_CHARS = 80;
/** 跳过去后消息顶边离视口顶部的距离（--space-4）。 */
const LANDING_GAP = 16;

function preview(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= PREVIEW_CHARS ? line : `${line.slice(0, PREVIEW_CHARS - 1)}…`;
}

function card(scroller: HTMLElement, id: string): HTMLElement | null {
  return scroller.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
}

/** 正在读的消息：顶边在视口上 1/3 以上的最后一条；都在下面时是第一条；滚到底就是最后一条。 */
function currentIndex(scroller: HTMLElement, messages: readonly UserMessage[]): number {
  if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) return messages.length - 1;
  const box = scroller.getBoundingClientRect();
  const line = box.top + box.height / 3;
  let current = 0;
  messages.forEach((message, index) => {
    const el = card(scroller, message.id);
    if (el !== null && el.getBoundingClientRect().top <= line) current = index;
  });
  return current;
}

export function ConversationLine({ taskId, scroller }: { taskId: TaskId; scroller: RefObject<HTMLElement | null> }) {
  const t = useT();
  const messages = useTspDerived(taskId, userMessages, sameUserMessages) ?? NONE;
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const el = scroller.current;
    if (el === null || messages.length < 2) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      setCurrent(currentIndex(el, messages));
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

  if (messages.length < 2) return null;

  const jump = (id: string) => {
    const el = scroller.current;
    const target = el === null ? null : card(el, id);
    if (el === null || target === null) return;
    el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - LANDING_GAP;
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
