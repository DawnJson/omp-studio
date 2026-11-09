// toolRuns（shared/tsp/tool-runs.ts）：main 里连续的工具调用切成一组。
import { describe, expect, it } from "vitest";
import { applyMessage, createDocument, type DocSurface } from "../src/shared/tsp/document.ts";
import { runOpen, toolRuns, type ToolRun } from "../src/shared/tsp/tool-runs.ts";
import { loadTspFixture, tspDocMessages } from "./tsp-fixtures.ts";

function replay(name: string): DocSurface {
  const doc = createDocument();
  for (const { message } of tspDocMessages(loadTspFixture(name))) applyMessage(doc, message);
  return doc.surfaces.get("s:1")!;
}

const sizes = (surface: DocSurface) => toolRuns(surface).map((run) => run.tools.length);

describe("toolRuns", () => {
  it("实录：空的助手列、只有思考块的助手列不打断一串；有正文的回答、等待卡打断", () => {
    // task（omp 18.12.3）：glob read · read · task · [wait] · [wait] · bash · read · todo · 回答（工具开始时思考块被删，留下空列）。
    expect(sizes(replay("task"))).toEqual([4, 3]);
    // resume（--resume 重放）：每次调用前一段思考；第 2 轮 task bash bash 后面是三张等待卡；第 3 轮只有一张卡，不成组。
    expect(sizes(replay("resume"))).toEqual([5, 3]);
    // cards：同一条消息里 bash、edit、eval 连着。jobs-kill：中间隔着思考的两批各三个 bash。
    expect(sizes(replay("cards"))).toEqual([3]);
    expect(sizes(replay("jobs-kill"))).toEqual([6]);
  });

  it("成员从第一张卡到最后一张卡（含中间的助手列）；后面跟着回答时不是最后一段", () => {
    const surface = replay("cards");
    const [run] = toolRuns(surface);
    const main = surface.nodes.get("main")!.c;
    expect(run!.members[0]).toBe(run!.tools[0]!.id);
    expect(run!.members.at(-1)).toBe(run!.tools.at(-1)!.id);
    expect(run!.members.every((id) => main.includes(id))).toBe(true);
    expect(run!.tools.every((tool) => tool.status === "done")).toBe(true);
    // 后面是回答：不再是最后一段。
    expect(run!.last).toBe(false);
  });

  it("等待卡、提问卡打断一串且自己不进组；回答还没出来时组是最后一段（last）", () => {
    const surface = replay("cards");
    const main = surface.nodes.get("main")!;
    const tools = main.c.filter((id) => surface.nodes.get(id)?.k === "tool");
    const middle = tools[1]!;
    // 中间那张改成等待卡：两边都只剩一张，没有组。
    const original = surface.nodes.get(middle)!;
    surface.nodes.set(middle, { ...original, p: { ...original.p, role: "omp.tool.wait" } });
    expect(sizes(surface)).toEqual([]);
    surface.nodes.set(middle, { ...original, p: { ...original.p, role: "omp.tool.ask" } });
    expect(sizes(surface)).toEqual([]);
    surface.nodes.set(middle, original);
    // 去掉末尾的回答：组后面没有别的节点了，这一轮可能还在往里加卡。
    surface.nodes.set("main", { ...main, c: main.c.slice(0, -1) });
    expect(toolRuns(surface).map((run) => run.last)).toEqual([true]);
  });
});

describe("runOpen：组展开着没有", () => {
  const run = (statuses: string[], last: boolean): ToolRun => ({
    members: statuses.map((_, i) => `n${i}`),
    tools: statuses.map((status, i) => ({ id: `n${i}`, key: `k${i}`, status, name: "bash" })),
    last,
  });
  const idle = { ended: false, busy: false, expanded: false };

  it("默认：有卡在跑、或在末尾且任务在跑时展开；跑完收起；omp 进程不在了不算在跑；omp 展开着工具输出（Ctrl+O）时全部展开", () => {
    expect(runOpen(run(["done", "running"], false), idle, undefined).open).toBe(true);
    expect(runOpen(run(["done", "pending"], false), idle, undefined).open).toBe(true);
    expect(runOpen(run(["done", "done"], true), { ...idle, busy: true }, undefined).open).toBe(true);
    // 跑完了：在末尾但任务空闲，或后面已经有回答。
    expect(runOpen(run(["done", "done"], true), idle, undefined).open).toBe(false);
    expect(runOpen(run(["done", "done"], false), { ...idle, busy: true }, undefined).open).toBe(false);
    expect(runOpen(run(["done", "running"], true), { ...idle, ended: true, busy: true }, undefined).open).toBe(false);
    expect(runOpen(run(["done", "error"], false), { ...idle, expanded: true }, undefined).open).toBe(true);
  });

  it("用户点过的以它为准；默认值变了（跑完、Ctrl+O）记录作废，回到默认值", () => {
    const running = run(["done", "running"], true);
    const finished = run(["done", "done"], true);
    // 跑的时候用户收起：照用户的。
    const closed = runOpen(running, { ...idle, busy: true }, undefined);
    const fold = { basis: closed.basis, open: false };
    expect(runOpen(running, { ...idle, busy: true }, fold)).toEqual({ open: false, basis: true, stale: false });
    // 跑完了：默认值从展开变成收起，记录作废。
    expect(runOpen(finished, idle, fold)).toEqual({ open: false, basis: false, stale: true });
    // 跑完后用户点开，再按 Ctrl+O（omp 报展开）：默认值变了，作废；omp 收起后也不会回到用户那次点开。
    const opened = { basis: false, open: true };
    expect(runOpen(finished, idle, opened)).toEqual({ open: true, basis: false, stale: false });
    expect(runOpen(finished, { ...idle, expanded: true }, opened)).toEqual({ open: true, basis: true, stale: true });
  });
});
