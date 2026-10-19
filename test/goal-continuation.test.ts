// 「目标自动推进」= omp 的 goal.continuationModes 里有没有 "rpc"：开关的合并、启动默认的决定、“明确设置过”的判断。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyGoalContinuationDefault, isGoalContinuationExplicit } from "../src/main/omp-config/goal-default.ts";
import { goalContinuationOn, goalDefaultWrite, withGoalContinuation } from "../src/shared/ui/goal-continuation.ts";

describe("withGoalContinuation / goalContinuationOn：开关只增减 rpc，别的条目保留", () => {
  it("打开：加上 rpc；已有就原样", () => {
    expect(withGoalContinuation(["interactive"], true)).toEqual(["interactive", "rpc"]);
    expect(withGoalContinuation(["interactive", "rpc"], true)).toEqual(["interactive", "rpc"]);
    expect(withGoalContinuation(["rpc", "interactive"], true)).toEqual(["rpc", "interactive"]);
    expect(withGoalContinuation([], true)).toEqual(["rpc"]);
  });
  it("关闭：去掉 rpc，别的条目和顺序保留", () => {
    expect(withGoalContinuation(["interactive", "rpc"], false)).toEqual(["interactive"]);
    expect(withGoalContinuation(["rpc", "interactive"], false)).toEqual(["interactive"]);
    expect(withGoalContinuation(["rpc"], false)).toEqual([]);
    expect(withGoalContinuation(["interactive"], false)).toEqual(["interactive"]);
  });
  it("值的形状不认识时按空列表处理，不抛", () => {
    expect(withGoalContinuation(undefined, true)).toEqual(["rpc"]);
    expect(withGoalContinuation("rpc", false)).toEqual([]);
    expect(withGoalContinuation([1, "interactive"], true)).toEqual(["interactive", "rpc"]);
  });
  it("开关状态 = 列表里有 rpc", () => {
    expect(goalContinuationOn(["interactive", "rpc"])).toBe(true);
    expect(goalContinuationOn(["interactive"])).toBe(false);
    expect(goalContinuationOn(undefined)).toBe(false);
  });
});

describe("goalDefaultWrite：启动时的默认允许", () => {
  it("没明确设置过 + 还没有 rpc → 写 [interactive, rpc]", () => {
    expect(goalDefaultWrite(["interactive"], false)).toEqual(["interactive", "rpc"]);
  });
  it("明确设置过（不管是 [interactive] 还是别的）→ 不写", () => {
    expect(goalDefaultWrite(["interactive"], true)).toBeNull();
    expect(goalDefaultWrite([], true)).toBeNull();
    expect(goalDefaultWrite(["interactive", "rpc"], true)).toBeNull();
  });
  it("没明确设置过但已经有 rpc（别处带来的）→ 不写", () => {
    expect(goalDefaultWrite(["interactive", "rpc"], false)).toBeNull();
  });
});

describe("isGoalContinuationExplicit：只读 agent 目录的 config.yml", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "goal-default-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));
  const config = (text: string) => writeFile(path.join(dir, "config.yml"), text, "utf8");

  it("没有 config.yml、空文件、没有这个键 → 没设过", async () => {
    expect(await isGoalContinuationExplicit(dir)).toBe(false);
    await config("");
    expect(await isGoalContinuationExplicit(dir)).toBe(false);
    await config("retry:\n  maxRetries: 3\ngoal:\n  statusInFooter: false\n");
    expect(await isGoalContinuationExplicit(dir)).toBe(false);
  });
  it("omp config set 写出的形状（即使值等于默认值）→ 设过", async () => {
    await config("goal:\n  continuationModes:\n    - interactive");
    expect(await isGoalContinuationExplicit(dir)).toBe(true);
  });
  it("平铺的键、行内数组 → 设过", async () => {
    await config('"goal.continuationModes": [interactive]\n');
    expect(await isGoalContinuationExplicit(dir)).toBe(true);
    await config("goal: { continuationModes: [] }\n");
    expect(await isGoalContinuationExplicit(dir)).toBe(true);
  });
  it("解析不了 → 当作设过，不去碰", async () => {
    await config("goal: [unclosed\n");
    expect(await isGoalContinuationExplicit(dir)).toBe(true);
  });
});

describe("applyGoalContinuationDefault", () => {
  const run = async (value: unknown, explicit: boolean) => {
    const writes: string[][] = [];
    const outcome = await applyGoalContinuationDefault({
      readValue: () => Promise.resolve(value),
      isExplicit: () => Promise.resolve(explicit),
      write: (modes) => {
        writes.push(modes);
        return Promise.resolve();
      },
    });
    return { outcome, writes };
  };
  it("没设过 → 写一次 [interactive, rpc]", async () => {
    expect(await run(["interactive"], false)).toEqual({ outcome: "written", writes: [["interactive", "rpc"]] });
  });
  it("设过 → 什么也不写", async () => {
    expect(await run(["interactive"], true)).toEqual({ outcome: "explicit", writes: [] });
  });
  it("已经有 rpc → 不写", async () => {
    expect(await run(["interactive", "rpc"], false)).toEqual({ outcome: "already-on", writes: [] });
  });
});
