// 子代理聚合：帧 → 泳道状态（并行、嵌套、已完成 / 取消、上限）。帧形状见 docs/architecture/subagents.md。
import { describe, expect, it } from "vitest";
import type { SubagentLifecyclePayload, SubagentProgressPayload } from "../src/shared/omp-wire/rpc-wire.generated.ts";
import { subagentLimits } from "../src/shared/subagents.ts";
import { SubagentTracker, splitResolvedModel, trimSubagentMessages } from "../src/main/tasks/subagent-tracker.ts";

const life = (
  id: string,
  status: SubagentLifecyclePayload["status"],
  extra: Partial<SubagentLifecyclePayload> = {},
): SubagentLifecyclePayload => ({ id, agent: "task", agentSource: "user", status, index: 0, ...extra });

const tool = (name: string, args: string, endMs: number, extra: Record<string, unknown> = {}) => ({
  tool: name,
  args,
  argsKey: "path",
  intent: `${name} ${args}`,
  isError: false,
  endMs,
  ...extra,
});

function prog(id: string, progress: Record<string, unknown>, extra: Partial<SubagentProgressPayload> = {}) {
  return {
    index: 0,
    agent: "task",
    agentSource: "user",
    task: "read a file",
    progress: { id, status: "running", ...progress },
    ...extra,
  } satisfies SubagentProgressPayload;
}

describe("SubagentTracker", () => {
  it("两个并行子代理：各自的起止、模型、费用，按开始顺序排列", () => {
    const t = new SubagentTracker();
    t.lifecycle(life("Alpha", "started", { sessionFile: "a.jsonl", detached: true }), 1000);
    t.lifecycle(life("Beta", "started", { index: 1 }), 1010);
    expect(t.runningCount).toBe(2);
    t.progress(
      prog("Alpha", {
        lastIntent: "Reading alpha.txt",
        toolCount: 1,
        requests: 1,
        tokens: 500,
        cost: 0.0001,
        durationMs: 900,
        resolvedModel: "deepseek/deepseek-v4-flash:high",
        resolvedThinkingLevel: "high",
        contextTokens: 7000,
        contextWindow: 1_000_000,
        recentTools: [tool("read", "alpha.txt", 1500)],
      }),
      1600,
    );
    t.lifecycle(life("Alpha", "completed"), 2000);
    expect(t.runningCount).toBe(1);
    const [alpha, beta] = t.lanes();
    expect(alpha).toMatchObject({
      id: "Alpha",
      status: "completed",
      startedAt: 1000,
      endedAt: 2000,
      model: "deepseek/deepseek-v4-flash",
      thinkingLevel: "high",
      tokens: 500,
      cost: 0.0001,
      toolCount: 1,
      lastIntent: "Reading alpha.txt",
      detached: true,
      parentId: null,
    });
    expect(alpha?.tools).toEqual([
      { tool: "read", target: "alpha.txt", targetKey: "path", intent: "read alpha.txt", isError: false, at: 1500 },
    ]);
    expect(beta).toMatchObject({ id: "Beta", status: "running", startedAt: 1010, endedAt: null, model: null });
    expect(t.sessionFile("Alpha")).toBe("a.jsonl");
  });

  it("progress 是累计快照：recentTools 在帧之间重叠时不重复记录；改文件的工具进 touched", () => {
    const t = new SubagentTracker();
    t.lifecycle(life("A", "started"), 0);
    const read = tool("read", "a.txt", 10);
    const edit = tool("edit", "src/a.ts", 20);
    t.progress(prog("A", { recentTools: [read] }), 11);
    t.progress(prog("A", { recentTools: [read, edit] }), 21);
    t.progress(
      prog("A", {
        recentTools: [read, edit, tool("write", "out.md", 30), tool("edit", "bad.ts", 31, { isError: true })],
      }),
      32,
    );
    t.progress(prog("A", { recentTools: [tool("edit", "src/a.ts", 40)] }), 41);
    const lane = t.lane("A");
    expect(lane?.tools.map((x) => `${x.tool}:${x.target}`)).toEqual([
      "read:a.txt",
      "edit:src/a.ts",
      "write:out.md",
      "edit:bad.ts",
      "edit:src/a.ts",
    ]);
    expect(lane?.touched).toEqual(["src/a.ts", "out.md"]);
  });

  it("endMs 落在合理范围之外（回放、时钟不一致）时用接收时间", () => {
    const t = new SubagentTracker();
    t.lifecycle(life("A", "started"), 100_000);
    t.progress(
      prog("A", { recentTools: [tool("read", "a", 5), tool("read", "b", 100_500), tool("read", "c", 999_999_999)] }),
      101_000,
    );
    expect(t.lane("A")?.tools.map((x) => x.at)).toEqual([101_000, 100_500, 101_000]);
  });

  it("没有 endMs 的工具用接收时间", () => {
    const t = new SubagentTracker();
    t.progress(prog("A", { recentTools: [{ tool: "bash", args: "ls", isError: false }] }), 777);
    expect(t.lane("A")?.tools[0]?.at).toBe(777);
  });

  it("嵌套：按点号找到存在的父；父不存在或名字里的点号不构成父子时是顶层", () => {
    const t = new SubagentTracker();
    t.lifecycle(life("Outer-3", "started"), 0);
    t.lifecycle(life("Outer-3.Inner", "started", { parentToolCallId: "call_x" }), 5);
    t.lifecycle(life("v1.2-fix", "started"), 6);
    expect(t.lane("Outer-3.Inner")?.parentId).toBe("Outer-3");
    expect(t.lane("v1.2-fix")?.parentId).toBeNull();
  });

  it("终态：completed / failed / aborted 记下结束时间；迟到的 started 或 progress 不会把终态改回去", () => {
    const t = new SubagentTracker();
    for (const [id, status] of [
      ["C", "completed"],
      ["F", "failed"],
      ["X", "aborted"],
    ] as const) {
      t.lifecycle(life(id, "started"), 100);
      t.lifecycle(life(id, status), 200);
    }
    t.progress(prog("X", { status: "running", tokens: 9 }), 300);
    expect(t.lanes().map((l) => `${l.id}:${l.status}:${l.endedAt}`)).toEqual([
      "C:completed:200",
      "F:failed:200",
      "X:aborted:200",
    ]);
    expect(t.lane("X")?.tokens).toBe(9);
    expect(t.runningCount).toBe(0);
  });

  it("progress 先于 lifecycle 到达也能建出泳道；progress 带终态时泳道结束", () => {
    const t = new SubagentTracker();
    t.progress(prog("A", { status: "completed", tokens: 3 }), 50);
    expect(t.lane("A")).toMatchObject({ status: "completed", startedAt: 50, endedAt: 50 });
  });

  it("没有 progress.id 的帧被忽略", () => {
    const t = new SubagentTracker();
    expect(t.progress({ ...prog("A", {}), progress: { status: "running" } }, 1)).toBe(false);
    expect(t.lanes()).toEqual([]);
  });

  it("进程退出：还在跑的变 aborted，已结束的不动", () => {
    const t = new SubagentTracker();
    t.lifecycle(life("Done", "started"), 0);
    t.lifecycle(life("Done", "completed"), 10);
    t.lifecycle(life("Live", "started"), 5);
    expect(t.abortRunning(99)).toBe(true);
    expect(t.lane("Live")).toMatchObject({ status: "aborted", endedAt: 99 });
    expect(t.lane("Done")).toMatchObject({ status: "completed", endedAt: 10 });
    expect(t.abortRunning(100)).toBe(false);
  });

  it("上限：每个子代理只保留最近 toolsPerLane 条工具调用；泳道数超限时先丢最早结束的，在跑的不丢", () => {
    const t = new SubagentTracker();
    t.lifecycle(life("A", "started"), 0);
    const total = subagentLimits.toolsPerLane + 50;
    for (let i = 0; i < total; i++) t.progress(prog("A", { recentTools: [tool("read", `f${i}.txt`, i + 1)] }), i + 1);
    const tools = t.lane("A")?.tools ?? [];
    expect(tools).toHaveLength(subagentLimits.toolsPerLane);
    expect(tools[0]?.target).toBe("f50.txt");
    expect(tools.at(-1)?.target).toBe(`f${total - 1}.txt`);
    // 被丢掉的最近一条再出现一次（recentTools 重叠）也不会重复记录。
    t.progress(prog("A", { recentTools: [tool("read", `f${total - 1}.txt`, total)] }), total + 1);
    expect(t.lane("A")?.tools).toHaveLength(subagentLimits.toolsPerLane);

    const many = new SubagentTracker();
    many.lifecycle(life("Running", "started"), 0);
    for (let i = 0; i < subagentLimits.lanesPerTask + 5; i++) {
      many.lifecycle(life(`S${i}`, "started"), 10 + i);
      many.lifecycle(life(`S${i}`, "completed"), 1000 + i);
    }
    const ids = many.lanes().map((l) => l.id);
    expect(ids).toHaveLength(subagentLimits.lanesPerTask);
    expect(ids).toContain("Running");
    expect(ids).not.toContain("S0");
    expect(ids).toContain(`S${subagentLimits.lanesPerTask + 4}`);
  });

  it("assignment 截断到上限", () => {
    const t = new SubagentTracker();
    t.progress(prog("A", {}, { assignment: "x".repeat(subagentLimits.assignmentChars + 10) }), 1);
    expect(t.lane("A")?.assignment).toHaveLength(subagentLimits.assignmentChars);
  });
});

describe("splitResolvedModel", () => {
  it("只在后缀正好是思考强度时拆分", () => {
    expect(splitResolvedModel("a/b:high", "high")).toEqual({ model: "a/b", thinkingLevel: "high" });
    expect(splitResolvedModel("a/b:free", "high")).toEqual({ model: "a/b:free", thinkingLevel: "high" });
    expect(splitResolvedModel("a/b", null)).toEqual({ model: "a/b", thinkingLevel: null });
  });
});

describe("trimSubagentMessages", () => {
  it("条数超限时留最近的并标记截断", () => {
    const messages = Array.from({ length: subagentLimits.detailMessages + 3 }, (_, i) => ({ i }));
    const out = trimSubagentMessages(messages);
    expect(out.truncated).toBe(true);
    expect(out.messages).toHaveLength(subagentLimits.detailMessages);
    expect(out.messages[0]).toEqual({ i: 3 });
  });
  it("大小超限时从前面丢", () => {
    const big = "x".repeat(subagentLimits.detailBytes / 2 + 1);
    const out = trimSubagentMessages([{ big }, { big }, { small: 1 }]);
    expect(out.truncated).toBe(true);
    expect(out.messages.at(-1)).toEqual({ small: 1 });
    expect(out.messages.length).toBeLessThan(3);
  });
  it("没超限原样返回", () => {
    expect(trimSubagentMessages([1, 2])).toEqual({ messages: [1, 2], truncated: false });
  });
});

describe("SubagentTracker：真实录制", () => {
  async function replay(name: string): Promise<SubagentTracker> {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(new URL(`../fixtures/rpc/${name}.ndjson`, import.meta.url), "utf8");
    const tracker = new SubagentTracker();
    let at = 1_000_000_000_000;
    for (const line of text.split("\n")) {
      if (line === "") continue;
      const entry = JSON.parse(line) as { kind: string; frame?: { type?: string; payload?: unknown } };
      if (entry.kind !== "out") continue;
      at += 100;
      if (entry.frame?.type === "subagent_lifecycle")
        tracker.lifecycle(entry.frame.payload as SubagentLifecyclePayload, at);
      if (entry.frame?.type === "subagent_progress")
        tracker.progress(entry.frame.payload as SubagentProgressPayload, at);
    }
    return tracker;
  }

  it("subagents-parallel：两个并行子代理都完成，模型、费用、改动文件来自 progress", async () => {
    const t = await replay("subagents-parallel");
    const lanes = t.lanes();
    expect(lanes.map((l) => [l.id, l.status])).toEqual([
      ["AlphaReader", "completed"],
      ["BetaSummarizer", "completed"],
    ]);
    const [alpha, beta] = lanes;
    expect(alpha?.model).toBe("deepseek/deepseek-v4-flash");
    expect(alpha?.thinkingLevel).toBe("high");
    expect(alpha?.tokens).toBeGreaterThan(0);
    expect(alpha?.cost).toBeGreaterThan(0);
    expect(alpha?.parentId).toBeNull();
    expect(alpha?.assignment).toContain("alpha.txt");
    // 录制是几天前的：endMs 落在合理范围之外，用接收时间，所以每个工具的时间都在泳道的起止之内。
    for (const lane of lanes)
      for (const tool of lane.tools) {
        expect(tool.at).toBeGreaterThanOrEqual(lane.startedAt);
        expect(tool.at).toBeLessThanOrEqual(lane.endedAt ?? Infinity);
      }
    expect(beta?.tools.map((x) => x.tool).sort()).toEqual(["read", "write"]);
    expect(beta?.touched).toEqual(["beta-summary.md"]);
    expect(alpha?.touched).toEqual([]);
  });

  it("subagents-control：cancel 之后是 aborted，steer 的那个正常完成，主代理重派的是新名字", async () => {
    const t = await replay("subagents-control");
    expect(t.lanes().map((l) => [l.id, l.status])).toEqual([
      ["ReadAlpha", "completed"],
      ["ReadBeta", "aborted"],
      ["ReadBetaRetry", "completed"],
    ]);
    expect(t.lane("ReadBeta")?.endedAt).not.toBeNull();
    expect(t.runningCount).toBe(0);
  });
});
