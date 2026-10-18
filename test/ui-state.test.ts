// 防的是：对话流镜像丢帧/重复帧后内容错乱；门的倒计时在重挂载后重新计时；ask 门答到一半切走再回来内容丢了。
import { describe, expect, it } from "vitest";
import { remainingMs } from "../src/renderer/src/features/dialogs/gate-timer.ts";
import { clearAskDraft, getAskDraft, updateAskDraft } from "../src/renderer/src/features/dialogs/ask-draft-store.ts";
import { planBatch } from "../src/renderer/src/store/transcript-sync.ts";
import type { TaskId, TranscriptBatch } from "../src/shared/ipc.ts";
import { emptyTranscript, type TranscriptEvent } from "../src/shared/transcript.ts";

const taskId = "t1" as TaskId;
const notice = (n: number): TranscriptEvent => ({ type: "notice", level: "info", message: `m${n}`, at: n });
const batch = (firstSeq: number, count: number): TranscriptBatch => ({ taskId, firstSeq, events: Array.from({ length: count }, (_, i) => notice(firstSeq + i)) });
const messages = (outcome: ReturnType<typeof planBatch>) => (outcome.kind === "apply" ? outcome.mirror.transcript.items.map((item) => (item.kind === "notice" ? item.message : "?")) : null);

describe("对话流镜像同步", () => {
  const mirror = { seq: 2, transcript: emptyTranscript() };

  it("没有快照的任务忽略批次", () => {
    expect(planBatch(undefined, batch(1, 2)).kind).toBe("ignore");
  });
  it("已应用过的前缀跳过，只应用新的部分，seq 相应前进", () => {
    const outcome = planBatch(mirror, batch(2, 3)); // seq 2,3,4：2 已应用
    expect(messages(outcome)).toEqual(["m3", "m4"]);
    expect(outcome.kind === "apply" && outcome.mirror.seq).toBe(4);
  });
  it("整批都是旧的：忽略，不重复追加", () => {
    expect(planBatch(mirror, batch(1, 2)).kind).toBe("ignore");
  });
  it("断档（firstSeq 超过本地 seq + 1）：要求重新拉快照，不应用", () => {
    expect(planBatch(mirror, batch(5, 2)).kind).toBe("resync");
  });
  it("刚好衔接时正常应用", () => {
    expect(messages(planBatch(mirror, batch(3, 1)))).toEqual(["m3"]);
  });
});

describe("门的倒计时", () => {
  it("按主进程收到请求的时间算：什么时候挂载都一样，不会重置", () => {
    expect(remainingMs(30_000, 1000, 1000)).toBe(30_000);
    expect(remainingMs(30_000, 1000, 11_000)).toBe(20_000);
    expect(remainingMs(30_000, 1000, 99_000)).toBe(0);
  });
});

describe("ask 门的半成品答案", () => {
  it("按请求 id 存着：门卸载再挂载后还在，答复后清掉", () => {
    updateAskDraft("ask-1", 2, (draft) => ({ ...draft, step: 1, states: draft.states.map((s, i) => (i === 0 ? { ...s, selected: ["Go"] } : s)) }));
    expect(getAskDraft("ask-1")?.step).toBe(1);
    expect(getAskDraft("ask-1")?.states[0]?.selected).toEqual(["Go"]);
    expect(getAskDraft("ask-2")).toBeUndefined();
    clearAskDraft("ask-1");
    expect(getAskDraft("ask-1")).toBeUndefined();
  });
});

