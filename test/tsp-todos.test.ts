import { describe, expect, it } from "vitest";
import type { TodoPhase } from "../src/shared/omp-wire/rpc-wire.generated.ts";
import { applyMessage, createDocument } from "../src/shared/tsp/document.ts";
import { deriveTodoPhases, phasesOfChecklist, stripPhaseNumeral } from "../src/shared/tsp/todos.ts";
import { loadTspFixture, tspDocMessages } from "./tsp-fixtures.ts";

/** 逐帧回放，返回每一帧之后的待办（omp 18.12.3 录制）。 */
function replay(name: string) {
  const doc = createDocument();
  return tspDocMessages(loadTspFixture(name)).map(({ message }) => {
    applyMessage(doc, message);
    return deriveTodoPhases(doc);
  });
}
const statuses = (phases: readonly TodoPhase[]) => phases.map((p) => p.tasks.map((t) => t.status));

describe("TSP 待办（omp 18.12.3 录制 task.jsonl，HUD 节点 omp.hud.todo）", () => {
  const steps = replay("task");

  it("todo 工具写入之前没有待办", () => {
    expect(steps[0]).toEqual([]);
    expect(steps.findIndex((phases) => phases.length > 0)).toBeGreaterThan(0);
  });

  it("第一次写入：4 个阶段、5 条，阶段名去掉罗马数字前缀", () => {
    const first = steps.find((phases) => phases.length > 0)!;
    expect(first.map((p) => p.name)).toEqual(["Inspect", "Fix", "Verify", "Report"]);
    expect(first[0]!.tasks[0]).toEqual({
      content: "Read calc/ops.py, calc/text.py and tests to identify bugs",
      status: "in_progress",
    });
    expect(statuses(first)).toEqual([["in_progress"], ["pending", "pending"], ["pending"], ["pending"]]);
  });

  it("随回合推进：Inspect 完成 → Fix 两项依次完成 → 全部 completed", () => {
    const seen: string[] = [];
    for (const phases of steps) {
      const key = JSON.stringify(statuses(phases));
      if (phases.length > 0 && seen.at(-1) !== key) seen.push(key);
    }
    expect(seen).toEqual([
      '[["in_progress"],["pending","pending"],["pending"],["pending"]]',
      '[["completed"],["in_progress","pending"],["pending"],["pending"]]',
      '[["completed"],["completed","in_progress"],["pending"],["pending"]]',
      '[["completed"],["completed","completed"],["in_progress"],["pending"]]',
      '[["completed"],["completed","completed"],["completed"],["completed"]]',
    ]);
    // 全部做完后 HUD 还留着（帧 137–144 都是 5/5 completed），回合结束的最后一帧（145）随 omp 的清理消失。
    expect(statuses(steps.at(-2)!).flat()).toEqual(Array(5).fill("completed"));
    expect(steps.at(-1)).toEqual([]);
  });

  it("其它录制（没有 todo 工具）始终是 []", () => {
    for (const name of ["ask", "cards", "picker", "slash"]) {
      for (const phases of replay(name)) expect(phases).toEqual([]);
    }
  });
});

describe("phasesOfChecklist", () => {
  it("五种状态、spans 文字，blocked 的 note 是阻塞原因、其他状态的 note 是备注", () => {
    const phases = phasesOfChecklist([
      {
        id: "0",
        title: [{ t: "I. " }, { t: "Plan", s: "strong" }],
        items: [
          { id: "0.0", text: "a", status: "pending" },
          { id: "0.1", text: [{ t: "b" }, { t: "2" }], status: "active" },
          { id: "0.2", text: "c", status: "done" },
          { id: "0.3", text: "d", status: "dropped", note: "skipped" },
          { id: "0.4", text: "e", status: "blocked", note: [{ t: "waiting " }, { t: "on CI" }] },
        ],
      },
    ]);
    expect(phases).toEqual([
      {
        name: "Plan",
        tasks: [
          { content: "a", status: "pending" },
          { content: "b2", status: "in_progress" },
          { content: "c", status: "completed" },
          { content: "d", status: "abandoned", notes: ["skipped"] },
          { content: "e", status: "blocked", blocker: "waiting on CI" },
        ],
      },
    ]);
  });

  it("认不出的形状和未知状态跳过，不抛", () => {
    expect(phasesOfChecklist(undefined)).toEqual([]);
    expect(
      phasesOfChecklist([null, { title: "x" }, { title: "y", items: [{ text: "z", status: "weird" }, 3] }]),
    ).toEqual([{ name: "y", tasks: [] }]);
  });

  it("只去掉罗马数字前缀", () => {
    expect(stripPhaseNumeral("IV. Report")).toBe("Report");
    expect(stripPhaseNumeral("Install deps")).toBe("Install deps");
    expect(stripPhaseNumeral("I.Report")).toBe("I.Report");
  });
});
