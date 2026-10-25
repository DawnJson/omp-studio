import { describe, expect, it } from "vitest";
import { OutputBatcher } from "../src/main/terminal/output-batcher.ts";
import type { BatchClock } from "../src/main/platform/batch-timer.ts";
import { Backlog } from "../src/main/terminal/backlog.ts";

function fakeClock() {
  let next = 1;
  const state = { now: 1000 };
  const immediates = new Map<number, () => void>();
  const timeouts = new Map<number, { callback: () => void; ms: number }>();
  const clock: BatchClock = {
    now: () => state.now,
    setImmediate(callback) {
      immediates.set(next, callback);
      return next++;
    },
    clearImmediate(handle) {
      immediates.delete(handle as number);
    },
    setTimeout(callback, ms) {
      timeouts.set(next, { callback, ms });
      return next++;
    },
    clearTimeout(handle) {
      timeouts.delete(handle as number);
    },
  };
  const run = <T>(map: Map<number, T>, call: (entry: T) => void) => {
    for (const [id, entry] of map) {
      map.delete(id);
      call(entry);
    }
  };
  return {
    clock,
    state,
    immediates,
    timeouts,
    runImmediates: () => run(immediates, (callback) => callback()),
    runTimeouts: () => run(timeouts, ({ callback }) => callback()),
  };
}

describe("OutputBatcher", () => {
  it("空闲后的第一批下一轮事件循环就发，不等间隔；同一轮推进来的合成一次", () => {
    const fake = fakeClock();
    const out: string[] = [];
    const batcher = new OutputBatcher((data) => out.push(data), { intervalMs: 16, maxChars: 100 }, fake.clock);
    batcher.push("a");
    batcher.push("b");
    batcher.push("c");
    expect(out).toEqual([]);
    expect(fake.timeouts.size).toBe(0);
    fake.runImmediates();
    expect(out).toEqual(["abc"]);
    expect(fake.immediates.size).toBe(0);
  });

  it("刚发过一批：再来的内容等到上次发出后满间隔才发；间隔过了又是下一轮就发", () => {
    const fake = fakeClock();
    const out: string[] = [];
    const batcher = new OutputBatcher((data) => out.push(data), { intervalMs: 16, maxChars: 100 }, fake.clock);
    batcher.push("a");
    fake.runImmediates();
    fake.state.now += 5;
    batcher.push("b");
    batcher.push("c");
    expect(fake.immediates.size).toBe(0);
    expect([...fake.timeouts.values()].map((entry) => entry.ms)).toEqual([11]);
    fake.state.now += 11;
    fake.runTimeouts();
    expect(out).toEqual(["a", "bc"]);
    fake.state.now += 40;
    batcher.push("d");
    expect(fake.timeouts.size).toBe(0);
    fake.runImmediates();
    expect(out).toEqual(["a", "bc", "d"]);
  });

  it("攒够 maxChars 立刻发，并取消已安排的一次", () => {
    const fake = fakeClock();
    const out: string[] = [];
    const batcher = new OutputBatcher((data) => out.push(data), { intervalMs: 16, maxChars: 5 }, fake.clock);
    batcher.push("ab");
    batcher.push("cde");
    expect(out).toEqual(["abcde"]);
    expect(fake.immediates.size + fake.timeouts.size).toBe(0);
    batcher.push("f");
    expect(fake.timeouts.size).toBe(1);
  });

  it("flush 立即发出，没有内容时什么也不发；discard 丢掉未发的", () => {
    const fake = fakeClock();
    const out: string[] = [];
    const batcher = new OutputBatcher((data) => out.push(data), { intervalMs: 16, maxChars: 100 }, fake.clock);
    batcher.flush();
    expect(out).toEqual([]);
    batcher.push("x");
    batcher.flush();
    expect(out).toEqual(["x"]);
    batcher.push("y");
    batcher.discard();
    fake.runImmediates();
    fake.runTimeouts();
    expect(out).toEqual(["x"]);
  });

  it("忽略空串", () => {
    const fake = fakeClock();
    const batcher = new OutputBatcher(() => undefined, { intervalMs: 16, maxChars: 100 }, fake.clock);
    batcher.push("");
    expect(fake.immediates.size + fake.timeouts.size).toBe(0);
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
