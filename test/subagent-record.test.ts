// 子代理记录缓存：第二次读用 fromByte 只读新增，reset 清空，保留上限，渲染端按绝对序号追加。
import { describe, expect, it } from "vitest";
import { mergeRecord } from "../src/renderer/src/features/lanes/lane-model.ts";
import { SubagentRecord, type RecordPage } from "../src/main/tasks/subagent-record.ts";
import { subagentLimits } from "../src/shared/subagents.ts";

/** 假的 omp：文件是一串消息，每条 10 字节；按 fromByte 返回其后的内容，fromByte 超过文件大小时 reset。 */
function file(initial: number) {
  const all: number[] = Array.from({ length: initial }, (_, i) => i);
  const calls: (number | undefined)[] = [];
  return {
    all,
    calls,
    fetch: async (fromByte: number | undefined): Promise<RecordPage<number>> => {
      calls.push(fromByte);
      const size = all.length * 10;
      const reset = (fromByte ?? 0) > size;
      const start = reset ? 0 : (fromByte ?? 0) / 10;
      return { messages: all.slice(start), nextByte: size, reset };
    },
  };
}

describe("SubagentRecord", () => {
  it("第一次从头读；第二次用上次的 nextByte 作 fromByte，只追加新增的", async () => {
    const f = file(3);
    const record = new SubagentRecord<number>();
    await record.refresh(f.fetch);
    expect(record.slice(undefined)).toEqual({ messages: [0, 1, 2], from: 0, total: 3, truncated: false });
    f.all.push(3, 4);
    await record.refresh(f.fetch);
    // 第一次：undefined → 读到 30，再读一页（fromByte 30）确认没有更多；第二次从 30 起。
    expect(f.calls).toEqual([undefined, 30, 30, 50]);
    expect(record.slice(undefined).messages).toEqual([0, 1, 2, 3, 4]);
  });

  it("slice(since) 只给调用方还没有的部分", async () => {
    const f = file(5);
    const record = new SubagentRecord<number>();
    await record.refresh(f.fetch);
    expect(record.slice(3)).toEqual({ messages: [3, 4], from: 3, total: 5, truncated: false });
    expect(record.slice(5)).toEqual({ messages: [], from: 5, total: 5, truncated: false });
  });

  it("reset：缓存清空后重读；调用方的 since 超过新的总数时从头给", async () => {
    const f = file(4);
    const record = new SubagentRecord<number>();
    await record.refresh(f.fetch);
    f.all.splice(0, f.all.length, 100, 101); // 文件被换成了更短的内容：fromByte 40 > 20 → reset
    await record.refresh(f.fetch);
    expect(record.slice(undefined).messages).toEqual([100, 101]);
    expect(record.slice(4)).toEqual({ messages: [100, 101], from: 0, total: 2, truncated: false });
  });

  it("超过保留上限：丢最早的，绝对序号不变，标记 truncated", async () => {
    const n = subagentLimits.detailMessages + 5;
    const f = file(n);
    const record = new SubagentRecord<number>();
    await record.refresh(f.fetch);
    const all = record.slice(undefined);
    expect(all).toMatchObject({ from: 5, total: n, truncated: true });
    expect(all.messages).toHaveLength(subagentLimits.detailMessages);
    f.all.push(n);
    await record.refresh(f.fetch);
    const next = record.slice(n);
    expect(next).toMatchObject({ messages: [n], from: n, total: n + 1 });
  });
});

describe("mergeRecord", () => {
  it("接得上就追加，没有新增时返回原对象；接不上（重置、被截断）整个换掉", () => {
    const held = { from: 5, messages: ["a", "b"] };
    expect(mergeRecord(held, { from: 7, messages: ["c"] })).toEqual({ from: 5, messages: ["a", "b", "c"] });
    expect(mergeRecord(held, { from: 7, messages: [] })).toBe(held);
    expect(mergeRecord(held, { from: 0, messages: ["x"] })).toEqual({ from: 0, messages: ["x"] });
    expect(mergeRecord(held, { from: 9, messages: ["y"] })).toEqual({ from: 9, messages: ["y"] });
    expect(mergeRecord(null, { from: 2, messages: ["z"] })).toEqual({ from: 2, messages: ["z"] });
  });
});
