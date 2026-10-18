import { describe, expect, it } from "vitest";
import { OutputBatcher, type BatcherTimers } from "../src/main/terminal/output-batcher.ts";
import { Backlog } from "../src/main/terminal/backlog.ts";

function fakeTimers() {
  const pending = new Map<number, () => void>();
  let next = 1;
  const timers: BatcherTimers = {
    setTimeout(callback) {
      pending.set(next, callback);
      return next++;
    },
    clearTimeout(handle) {
      pending.delete(handle as number);
    },
  };
  return {
    timers,
    pending,
    fire() {
      for (const [id, callback] of pending) {
        pending.delete(id);
        callback();
      }
    },
  };
}

describe("OutputBatcher", () => {
  it("到点把攒的内容合成一次发出", () => {
    const { timers, fire, pending } = fakeTimers();
    const out: string[] = [];
    const batcher = new OutputBatcher((data) => out.push(data), { intervalMs: 16, maxChars: 100 }, timers);
    batcher.push("a");
    batcher.push("b");
    batcher.push("c");
    expect(out).toEqual([]);
    expect(pending.size).toBe(1);
    fire();
    expect(out).toEqual(["abc"]);
    expect(pending.size).toBe(0);
  });

  it("攒够 maxChars 立刻发，并取消定时器", () => {
    const { timers, pending } = fakeTimers();
    const out: string[] = [];
    const batcher = new OutputBatcher((data) => out.push(data), { intervalMs: 16, maxChars: 5 }, timers);
    batcher.push("ab");
    batcher.push("cde");
    expect(out).toEqual(["abcde"]);
    expect(pending.size).toBe(0);
    batcher.push("f");
    expect(pending.size).toBe(1);
  });

  it("flush 立即发出，没有内容时什么也不发；discard 丢掉未发的", () => {
    const { timers, fire } = fakeTimers();
    const out: string[] = [];
    const batcher = new OutputBatcher((data) => out.push(data), { intervalMs: 16, maxChars: 100 }, timers);
    batcher.flush();
    expect(out).toEqual([]);
    batcher.push("x");
    batcher.flush();
    expect(out).toEqual(["x"]);
    batcher.push("y");
    batcher.discard();
    fire();
    expect(out).toEqual(["x"]);
  });

  it("忽略空串", () => {
    const { timers, pending } = fakeTimers();
    const batcher = new OutputBatcher(() => undefined, { intervalMs: 16, maxChars: 100 }, timers);
    batcher.push("");
    expect(pending.size).toBe(0);
  });
});

describe("Backlog", () => {
  it("不超过上限时原样返回", () => {
    const backlog = new Backlog(100);
    backlog.append("hello\n");
    backlog.append("world");
    expect(backlog.snapshot()).toBe("hello\nworld");
  });

  it("超过上限只留最近的，且不超过上限，从行首开始", () => {
    const backlog = new Backlog(50);
    for (let index = 0; index < 100; index += 1) backlog.append(`line-${String(index).padStart(3, "0")}\n`);
    const snapshot = backlog.snapshot();
    expect(snapshot.length).toBeLessThanOrEqual(50);
    expect(snapshot.startsWith("line-")).toBe(true);
    expect(snapshot.endsWith("line-099\n")).toBe(true);
  });

  it("一次追加就远超上限也成立", () => {
    const backlog = new Backlog(10);
    backlog.append("x".repeat(1000) + "\nend");
    expect(backlog.snapshot()).toBe("end");
  });

  it("没有换行时不从代理对中间切开", () => {
    const backlog = new Backlog(5);
    backlog.append("a😀😀😀😀😀😀");
    const snapshot = backlog.snapshot();
    expect(snapshot.length).toBeLessThanOrEqual(5);
    const first = snapshot.charCodeAt(0);
    expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
  });
});
