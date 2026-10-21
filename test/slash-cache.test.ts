import { describe, expect, it } from "vitest";
import type { AvailableSlashCommand } from "../src/shared/omp-wire/rpc-wire.generated.ts";
import { createSlashLoader } from "../src/renderer/src/features/palette/slash-cache.ts";

const list: AvailableSlashCommand[] = [{ name: "model", source: "builtin" }];

function setup(results: (AvailableSlashCommand[] | Error)[]) {
  const calls: string[] = [];
  const published: [string, readonly AvailableSlashCommand[]][] = [];
  const errors: unknown[] = [];
  const pending = [...results];
  const loader = createSlashLoader(
    async (key) => {
      calls.push(key);
      const next = pending.shift() ?? list;
      if (next instanceof Error) throw next;
      return next;
    },
    (key, commands) => published.push([key, commands]),
    (error) => errors.push(error),
  );
  return { loader, calls, published, errors };
}

describe("slash 命令列表加载（B1）", () => {
  it("第一次拿到空数组（omp 还在起）不算已取过：下次请求会再取，拿到非空才记下", async () => {
    const { loader, calls, published } = setup([[], list]);
    await loader.request("t1");
    expect(published).toEqual([]);
    await loader.request("t1");
    expect(calls).toEqual(["t1", "t1"]);
    expect(published).toEqual([["t1", list]]);
    await loader.request("t1");
    expect(calls).toHaveLength(2);
  });

  it("同一个键请求还在路上时不重复发", async () => {
    const { loader, calls } = setup([list]);
    await Promise.all([loader.request("t1"), loader.request("t1")]);
    expect(calls).toEqual(["t1"]);
  });

  it("失败不记：报错，下次请求再取", async () => {
    const boom = new Error("boom");
    const { loader, calls, errors, published } = setup([boom, list]);
    await loader.request("t1");
    expect(errors).toEqual([boom]);
    await loader.request("t1");
    expect(calls).toHaveLength(2);
    expect(published).toEqual([["t1", list]]);
  });

  it("任务和草稿各记各的", async () => {
    const { loader, calls } = setup([]);
    await Promise.all([loader.request("draft"), loader.request("t1")]);
    expect(calls).toEqual(["draft", "t1"]);
  });
});
