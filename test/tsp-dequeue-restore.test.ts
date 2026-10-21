import { describe, expect, it } from "vitest";
import { DEQUEUE_WAIT_MS, restoreDequeuedQueue, type DequeueDeps } from "../src/shared/tsp/dequeue-restore.ts";
import { applyMessage, createDocument } from "../src/shared/tsp/document.ts";
import type { TspEvent } from "../src/shared/tsp/tsp.generated.ts";
import { loadTspFixture, tspDocMessages } from "./tsp-fixtures.ts";

/** fixtures/tsp/queue-esc.jsonl（omp 18.12.5）：排队消息被取回时 omp 把文字追加进它自己的输入框（和 ⌥↑ / `queue.edit` 同一种帧）。 */
function harness() {
  const doc = createDocument();
  const listeners = new Set<() => void>();
  const drafts: string[] = [];
  const events: TspEvent[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const deps: DequeueDeps = {
    document: () => doc,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    appendToDraft: (text) => drafts.push(text),
    sendEvent: (event) => events.push(event),
    setTimeout: (callback) => {
      timers.set(nextTimer, callback);
      return nextTimer++;
    },
    clearTimeout: (handle) => timers.delete(handle as number),
  };
  const frames = tspDocMessages(loadTspFixture("queue-esc")).map(({ message }) => message);
  return {
    deps,
    drafts,
    events,
    listeners,
    timers,
    play() {
      for (const message of frames) {
        applyMessage(doc, message);
        for (const listener of listeners) listener();
      }
    },
  };
}

describe("restoreDequeuedQueue", () => {
  it("omp 把排队文字写回它的输入框后:放进草稿一次、发 edit 清空 omp 的输入框、取消订阅和计时器", () => {
    const h = harness();
    restoreDequeuedQueue(h.deps);
    expect(h.listeners.size).toBe(1);
    h.play();
    expect(h.drafts).toHaveLength(1);
    expect(h.drafts[0]).not.toBe("");
    expect(h.events).toHaveLength(1);
    const edit = h.events[0] as Record<string, unknown>;
    expect(edit["ev"]).toBe("edit");
    expect(edit["text"]).toBe("");
    expect(edit["to"]).toBe(h.drafts[0]!.length);
    expect(h.listeners.size).toBe(0);
    expect(h.timers.size).toBe(0);
  });

  it("文字一直没出现:到时间收尾,不碰草稿、不发事件", () => {
    const h = harness();
    restoreDequeuedQueue(h.deps);
    expect(DEQUEUE_WAIT_MS).toBe(3000);
    for (const callback of h.timers.values()) callback();
    expect(h.listeners.size).toBe(0);
    h.play();
    expect(h.drafts).toEqual([]);
    expect(h.events).toEqual([]);
  });
});
