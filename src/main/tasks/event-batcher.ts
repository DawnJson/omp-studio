// 每个任务一个：缓冲 TranscriptEvent，合并相邻 delta，16 ms 或攒满 64 个时一次推送；同时维护权威快照。
// 快照只反映已经推送出去的批次，`snapshot()` 先冲刷再返回，所以 `seq` 永远和已发批次对得上
// （渲染进程要求 firstSeq === 本地 seq + 1，见 ipc.ts TranscriptBatch）。
import { applyTranscriptEvent, emptyTranscript, type Transcript, type TranscriptEvent } from "../../shared/transcript.ts";

export const BATCH_INTERVAL_MS = 16;
export const BATCH_MAX_EVENTS = 64;

export interface EventBatch {
  firstSeq: number;
  events: TranscriptEvent[];
}

/**
 * 合并（只在一个批次内）：
 * - 相邻的、同一消息同一 contentIndex 的 text_delta / thinking_delta 合成一条；
 * - 同一 toolCallId 的多个 tool_update 只留最后一个（位置也取最后一个）。
 */
export function coalesceEvents(events: TranscriptEvent[]): TranscriptEvent[] {
  const lastToolUpdate = new Map<string, number>();
  events.forEach((event, i) => {
    if (event.type === "tool_update") lastToolUpdate.set(event.toolCallId, i);
  });
  const out: TranscriptEvent[] = [];
  events.forEach((event, i) => {
    if (event.type === "tool_update" && lastToolUpdate.get(event.toolCallId) !== i) return;
    const previous = out[out.length - 1];
    if (event.type === "message_delta" && previous?.type === "message_delta" && previous.key === event.key) {
      const a = previous.delta;
      const b = event.delta;
      if ((a.type === "text_delta" && b.type === "text_delta") || (a.type === "thinking_delta" && b.type === "thinking_delta")) {
        if (a.contentIndex === b.contentIndex) {
          out[out.length - 1] = { ...event, delta: { ...b, delta: a.delta + b.delta } };
          return;
        }
      }
    }
    out.push(event);
  });
  return out;
}

export class EventBatcher {
  #pending: TranscriptEvent[] = [];
  #timer: NodeJS.Timeout | undefined;
  #transcript: Transcript = emptyTranscript();
  #seq = 0;
  readonly #emit: (batch: EventBatch) => void;

  constructor(emit: (batch: EventBatch) => void) {
    this.#emit = emit;
  }

  push(events: TranscriptEvent[]): void {
    if (events.length === 0) return;
    this.#pending.push(...events);
    if (this.#pending.length >= BATCH_MAX_EVENTS) this.flush();
    else this.#timer ??= setTimeout(() => this.flush(), BATCH_INTERVAL_MS);
  }

  /** 立刻推送缓冲区。状态变化（对话框、prompt_result、settled）和读快照前调用。 */
  flush(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    if (this.#pending.length === 0) return;
    const events = coalesceEvents(this.#pending);
    this.#pending = [];
    const firstSeq = this.#seq + 1;
    for (const event of events) this.#transcript = applyTranscriptEvent(this.#transcript, event);
    this.#seq += events.length;
    this.#emit({ firstSeq, events });
  }

  snapshot(): { seq: number; transcript: Transcript } {
    this.flush();
    return { seq: this.#seq, transcript: this.#transcript };
  }

  /** 丢掉快照和缓冲（回收后释放内存）；序号从头开始，重新打开任务时渲染进程用 openTask 的快照对齐。 */
  reset(): void {
    this.dispose();
    this.#pending = [];
    this.#transcript = emptyTranscript();
    this.#seq = 0;
  }

  dispose(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}
