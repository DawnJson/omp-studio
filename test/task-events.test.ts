import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RpcServerFrame } from "../src/shared/omp-wire/rpc-wire.generated.ts";
import { applyTranscriptEvent, emptyTranscript, type TranscriptEvent } from "../src/shared/transcript.ts";
import { BATCH_INTERVAL_MS, BATCH_MAX_EVENTS, coalesceEvents, EventBatcher, type EventBatch } from "../src/main/tasks/event-batcher.ts";
import { translateFrame } from "../src/main/tasks/translate.ts";

const fixtureDir = path.join(import.meta.dirname, "..", "fixtures", "rpc");
const fixtures = readdirSync(fixtureDir)
  .filter((file) => file.endsWith(".ndjson"))
  .map((file) => file.replace(/\.ndjson$/, ""));

function outFrames(name: string): RpcServerFrame[] {
  return readFileSync(path.join(fixtureDir, `${name}.ndjson`), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line): { kind: string; frame?: RpcServerFrame } => JSON.parse(line))
    .flatMap((entry) => (entry.kind === "out" && entry.frame ? [entry.frame] : []));
}

describe.each(fixtures)("帧 → TranscriptEvent 回放 %s", (name) => {
  const frames = outFrames(name);

  it("转发的事件里没有 partial 和 toolcall_delta（体积瘦身，渲染进程不依赖它们）", () => {
    for (const frame of frames) {
      for (const event of translateFrame(frame, 1, 0)) {
        if (event.type === "message_delta") {
          expect(event.delta).not.toHaveProperty("partial");
          expect(event.delta.type).not.toBe("toolcall_delta");
        }
      }
    }
  });

  it("经过批量合并后重建的对话流，和不合并直接 reduce 的结果完全一致", () => {
    const events = frames.flatMap((frame) => translateFrame(frame, 1, 1000));
    const direct = events.reduce(applyTranscriptEvent, emptyTranscript());
    const batcher = new EventBatcher(() => {});
    for (let i = 0; i < events.length; i += 7) batcher.push(events.slice(i, i + 7));
    expect(batcher.snapshot().transcript).toEqual(direct);
  });

  it("所有消息都以 message_end 收尾：没有残留的流式状态", () => {
    const transcript = frames.flatMap((frame) => translateFrame(frame, 1, 1000)).reduce(applyTranscriptEvent, emptyTranscript());
    for (const item of transcript.items) if (item.kind === "message") expect(item.streaming).toBe(false);
  });
});

describe("帧翻译的细节", () => {
  it("消息键带 spawn 代号：进程重启后 messageId 从头编号也不会和旧消息撞键", () => {
    const frame: RpcServerFrame = { type: "message_end", messageId: "msg-1", message: { role: "user", content: "hi", timestamp: 1 } };
    const [first] = translateFrame(frame, 1, 0);
    const [second] = translateFrame(frame, 2, 0);
    expect(first).toMatchObject({ key: "1:msg-1" });
    expect(second).toMatchObject({ key: "2:msg-1" });
  });

  it("没有 partial 的 delta（omp 的增量模式）和带 partial 的完整快照翻译结果相同", () => {
    const base = { type: "text_delta", contentIndex: 0, delta: "x" } as const;
    const withPartial: RpcServerFrame = { type: "message_update", messageId: "m", message: { role: "user", content: "", timestamp: 0 }, assistantMessageEvent: { ...base, partial: { role: "assistant" } as never } };
    const without: RpcServerFrame = { type: "message_update", messageId: "m", message: { role: "user", content: "", timestamp: 0 }, assistantMessageEvent: base as never };
    expect(translateFrame(withPartial, 1, 0)).toEqual(translateFrame(without, 1, 0));
  });

  it("extension_error 和 rpc_frame_error 变成对话流里的 notice，不会被悄悄丢掉", () => {
    expect(translateFrame({ type: "extension_error", extensionPath: "p", event: "tool_call", error: "boom" }, 1, 0)).toEqual([{ type: "notice", level: "error", message: "tool_call: boom", at: 0 }]);
    expect(translateFrame({ type: "rpc_frame_error", error: "too big" }, 1, 0)).toEqual([{ type: "notice", level: "warning", message: "too big", at: 0 }]);
  });
});

const textDelta = (key: string, text: string, contentIndex = 0): TranscriptEvent => ({ type: "message_delta", key, delta: { type: "text_delta", contentIndex, delta: text } });

describe("coalesceEvents", () => {
  it("同一消息同一 contentIndex 相邻的 text_delta 合并成一条", () => {
    expect(coalesceEvents([textDelta("k", "a"), textDelta("k", "b"), textDelta("k", "c")])).toEqual([textDelta("k", "abc")]);
  });

  it("中间隔了别的事件、换了消息或换了 contentIndex 就不能合并（顺序语义不能变）", () => {
    const tool: TranscriptEvent = { type: "tool_start", toolCallId: "t", toolName: "bash", at: 1 };
    expect(coalesceEvents([textDelta("k", "a"), tool, textDelta("k", "b")])).toHaveLength(3);
    expect(coalesceEvents([textDelta("k", "a"), textDelta("j", "b")])).toHaveLength(2);
    expect(coalesceEvents([textDelta("k", "a", 0), textDelta("k", "b", 1)])).toHaveLength(2);
  });

  it("同一 toolCallId 的多个 tool_update 只留最后一个，且不影响别的 tool 的更新", () => {
    const update = (id: string, value: string): TranscriptEvent => ({ type: "tool_update", toolCallId: id, partialResult: value });
    expect(coalesceEvents([update("a", "1"), update("b", "x"), update("a", "2")])).toEqual([update("b", "x"), update("a", "2")]);
  });
});

describe("EventBatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const notice = (n: number): TranscriptEvent => ({ type: "notice", level: "info", message: String(n), at: n });

  it("16 ms 内的事件一次推送，批次的 firstSeq 紧接上一批（渲染进程靠它判断丢帧）", () => {
    const batches: EventBatch[] = [];
    const batcher = new EventBatcher((batch) => batches.push(batch));
    batcher.push([notice(1)]);
    batcher.push([notice(2), notice(3)]);
    expect(batches).toHaveLength(0);
    vi.advanceTimersByTime(BATCH_INTERVAL_MS);
    batcher.push([notice(4)]);
    vi.advanceTimersByTime(BATCH_INTERVAL_MS);
    expect(batches.map((b) => [b.firstSeq, b.events.length])).toEqual([[1, 3], [4, 1]]);
  });

  it("攒满 64 个立刻推送，不等计时器", () => {
    const batches: EventBatch[] = [];
    const batcher = new EventBatcher((batch) => batches.push(batch));
    batcher.push(Array.from({ length: BATCH_MAX_EVENTS }, (_, i) => notice(i)));
    expect(batches).toHaveLength(1);
  });

  it("firstSeq 按合并后的事件数递增：快照的 seq 和渲染进程累计应用的事件数一致", () => {
    const batches: EventBatch[] = [];
    const batcher = new EventBatcher((batch) => batches.push(batch));
    batcher.push([textDelta("k", "a"), textDelta("k", "b"), notice(1)]);
    batcher.flush();
    batcher.push([notice(2)]);
    const { seq } = batcher.snapshot();
    expect(batches.map((b) => [b.firstSeq, b.events.length])).toEqual([[1, 2], [3, 1]]);
    expect(seq).toBe(3);
  });

  it("snapshot() 先冲刷缓冲区：读到的快照不会落后于已经发出的批次", () => {
    const batcher = new EventBatcher(() => {});
    batcher.push([notice(1)]);
    expect(batcher.snapshot().transcript.items).toHaveLength(1);
  });

  it("reset 之后序号从头开始，缓冲里没推送的事件不会在重置后冒出来", () => {
    const batches: EventBatch[] = [];
    const batcher = new EventBatcher((batch) => batches.push(batch));
    batcher.push([notice(1)]);
    batcher.reset();
    vi.advanceTimersByTime(BATCH_INTERVAL_MS * 2);
    expect(batches).toHaveLength(0);
    expect(batcher.snapshot()).toMatchObject({ seq: 0 });
  });
});
