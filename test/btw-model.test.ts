// 旁路提问（/btw）的纯逻辑：delta 累积、记录 upsert、进程退出时标 interrupted，以及面板的选择规则。
import { describe, expect, it } from "vitest";
import {
  applyBtwEvent,
  btwLimits,
  btwTurns,
  interruptBtw,
  isBtwRunning,
  latestTurn,
  type BtwHistoryRecord,
} from "../src/shared/btw.ts";
import { activeTopic, canAsk, NEW_TOPIC, topicLabel } from "../src/renderer/src/features/btw/btw-view.ts";

const record = (id: string, patch: Partial<BtwHistoryRecord> = {}): BtwHistoryRecord => ({
  id,
  leafId: "leaf",
  question: `q-${id}`,
  answer: "",
  status: "running",
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

describe("applyBtwEvent", () => {
  it("delta 累加到话题的答案上，先到的 running 记录之后的 delta 逐段拼接", () => {
    let records: readonly BtwHistoryRecord[] = [];
    records = applyBtwEvent(records, { type: "record", record: record("a") });
    records = applyBtwEvent(records, { type: "delta", recordId: "a", delta: "p" });
    records = applyBtwEvent(records, { type: "delta", recordId: "a", delta: "ong" });
    expect(records).toEqual([record("a", { answer: "pong" })]);
  });

  it("有追问时 delta 加到最后一条追问上，话题本身的答案不变", () => {
    const base = record("a", {
      answer: "pong",
      status: "complete",
      followUps: [{ question: "again", answer: "", status: "running", createdAt: 2, updatedAt: 2 }],
    });
    const next = applyBtwEvent([base], { type: "delta", recordId: "a", delta: "ping" });
    expect(next[0]?.answer).toBe("pong");
    expect(next[0]?.followUps?.[0]?.answer).toBe("ping");
    expect(latestTurn(next[0]!).answer).toBe("ping");
  });

  it("不认识的 recordId 和空 delta 不改变列表（返回同一个数组）", () => {
    const records = [record("a")];
    expect(applyBtwEvent(records, { type: "delta", recordId: "nope", delta: "x" })).toBe(records);
    expect(applyBtwEvent(records, { type: "delta", recordId: "a", delta: "" })).toBe(records);
  });

  it("record 事件：新话题放最前，已有的按 id 整条替换（以最后一条为准，盖掉累积的 delta）", () => {
    const first = applyBtwEvent([], { type: "record", record: record("a") });
    const second = applyBtwEvent(first, { type: "record", record: record("b") });
    expect(second.map((r) => r.id)).toEqual(["b", "a"]);
    const streamed = applyBtwEvent(second, { type: "delta", recordId: "a", delta: "pon" });
    const done = applyBtwEvent(streamed, {
      type: "record",
      record: record("a", { answer: "pong", status: "complete" }),
    });
    expect(done.map((r) => [r.id, r.answer, r.status])).toEqual([
      ["b", "", "running"],
      ["a", "pong", "complete"],
    ]);
  });

  it("records 事件整份替换，并且只留最新的 btwLimits.records 个", () => {
    const many = Array.from({ length: btwLimits.records + 5 }, (_, i) => record(`r${i}`));
    const next = applyBtwEvent([record("old")], { type: "records", records: many });
    expect(next).toHaveLength(btwLimits.records);
    expect(next[0]?.id).toBe("r0");
  });

  it("不改动传入的数组和记录（不可变）", () => {
    const original = record("a");
    const records = [original];
    applyBtwEvent(records, { type: "delta", recordId: "a", delta: "x" });
    expect(original.answer).toBe("");
    expect(records[0]).toBe(original);
  });
});

describe("running / interrupted", () => {
  it("isBtwRunning 看每个话题的最新一问（追问在跑也算）", () => {
    expect(isBtwRunning([record("a", { status: "complete" })])).toBe(false);
    expect(isBtwRunning([record("a")])).toBe(true);
    expect(
      isBtwRunning([
        record("a", {
          status: "complete",
          followUps: [{ question: "f", answer: "", status: "running", createdAt: 2, updatedAt: 2 }],
        }),
      ]),
    ).toBe(true);
  });

  it("interruptBtw 把在跑的最新一问标成 interrupted，别的不动；没有在跑的返回原数组", () => {
    const done = record("done", { status: "complete", answer: "ok" });
    const idle = [done];
    expect(interruptBtw(idle, 9)).toBe(idle);

    const running = record("a", {
      answer: "par",
      status: "complete",
      followUps: [{ question: "f", answer: "par", status: "running", createdAt: 2, updatedAt: 2 }],
    });
    const next = interruptBtw([running, done], 9);
    expect(next[1]).toBe(done);
    expect(next[0]?.status).toBe("complete");
    expect(next[0]?.followUps?.[0]).toMatchObject({ status: "interrupted", answer: "par", updatedAt: 9 });
    expect(isBtwRunning(next)).toBe(false);
    expect(btwTurns(next[0]!)).toHaveLength(2);
  });
});

describe("面板的选择规则", () => {
  const records = [record("new", { status: "complete" }), record("old", { status: "complete" })];

  it("默认显示最新的话题；选了存在的话题显示它；选的不存在时回退到最新的", () => {
    expect(activeTopic(records, null)?.id).toBe("new");
    expect(activeTopic(records, "old")?.id).toBe("old");
    expect(activeTopic(records, "gone")?.id).toBe("new");
  });

  it("选了新话题时没有显示中的话题（输入框开新话题）；没有记录时也是", () => {
    expect(activeTopic(records, NEW_TOPIC)).toBeNull();
    expect(activeTopic([], null)).toBeNull();
  });

  it("有内容并且没有在跑的旁路提问才能发", () => {
    expect(canAsk(records, "  ")).toBe(false);
    expect(canAsk(records, "why")).toBe(true);
    expect(canAsk([record("a")], "why")).toBe(false);
  });

  it("话题标签只取问题的第一行并截断", () => {
    expect(topicLabel(record("a", { question: "first line\nsecond" }))).toBe("first line");
    expect(topicLabel(record("a", { question: "x".repeat(40) }), 10)).toBe(`${"x".repeat(10)}…`);
  });
});
