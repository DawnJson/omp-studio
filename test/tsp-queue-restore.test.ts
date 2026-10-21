// 运行中排队的消息按 Esc 之后：omp 把文字写回它自己的输入框（omp 18.12.5 实录 fixtures/tsp/queue-esc.jsonl，
// 第一句要一个长回复，3 秒后再发 `queued-b15: …`，2 秒后按 Esc，读到输入框里的文字后发 edit 清空）。逐帧验证 queue-restore.ts。
import { describe, expect, it } from "vitest";
import { applyMessage, createDocument } from "../src/shared/tsp/document.ts";
import { hasQueuedMessages, restoredQueueEditor } from "../src/shared/tsp/queue-restore.ts";
import { loadTspFixture, tspDocMessages } from "./tsp-fixtures.ts";

const QUEUED = "queued-b15: reply with exactly OK";

describe("排队消息 Esc 后退回 omp 输入框：queue-esc（omp 18.12.5）", () => {
  const lines = loadTspFixture("queue-esc");
  const timeline: { queued: boolean; restored: string | null }[] = [];
  const doc = createDocument();
  for (const { message } of tspDocMessages(lines)) {
    applyMessage(doc, message);
    timeline.push({ queued: hasQueuedMessages(doc), restored: restoredQueueEditor(doc)?.text ?? null });
  }

  it("排队区出现过一段时间，这期间输入框是空的（还没被写回）", () => {
    const queuedFrames = timeline.filter((step) => step.queued);
    expect(queuedFrames.length).toBeGreaterThan(10);
    expect(queuedFrames.every((step) => step.restored === null)).toBe(true);
  });

  it("Esc 那一帧：排队区没了，同一帧输入框里是排队的原文", () => {
    const first = timeline.findIndex((step) => step.restored !== null);
    expect(first).toBeGreaterThan(0);
    expect(timeline[first - 1]?.queued).toBe(true);
    expect(timeline[first]).toEqual({ queued: false, restored: QUEUED });
  });

  it("没有排队、输入框空着时什么都读不到", () => {
    expect(timeline[0]).toEqual({ queued: false, restored: null });
    expect(hasQueuedMessages(createDocument())).toBe(false);
    expect(restoredQueueEditor(createDocument())).toBeNull();
  });

  it("录制里 studio 发的 edit 把输入框清成空", () => {
    const clear = lines.find((line) => line.dir === "in" && (line.body as { ev?: string }).ev === "edit");
    expect(clear?.body).toMatchObject({ from: 0, to: QUEUED.length, text: "", len: QUEUED.length });
    expect(timeline.at(-1)?.restored).toBeNull();
  });
});
