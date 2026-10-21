// 对话流里的 Todo 卡片（TSP checklist 节点）：omp 录制的帧里阶段没有图标，只有 items 的 status；
// 阶段做完时 studio 画对勾（和待办板一致），不能是一个空心圆（进度环满圈）。
import { describe, expect, it } from "vitest";
import { phaseMarkKind, readPhases } from "../src/renderer/src/features/tsp/nodes/checklist-model.ts";
import { applyMessage, createDocument } from "../src/shared/tsp/document.ts";
import { loadTspFixture, tspDocMessages } from "./tsp-fixtures.ts";

function lastFullChecklist(name: string): unknown {
  const doc = createDocument();
  let phases: unknown;
  for (const { message } of tspDocMessages(loadTspFixture(name))) {
    applyMessage(doc, message);
    for (const surface of doc.surfaces.values())
      for (const node of surface.nodes.values())
        if (node.k === "checklist" && node.p.mode === "full") phases = node.p.phases;
  }
  return phases;
}

describe("Todo 卡片的阶段标记（omp 18.12.3 录制 task.jsonl）", () => {
  const recorded = lastFullChecklist("task");
  const phases = readPhases(recorded);

  it("录制的帧：4 个阶段，每项都是 done，阶段本身不带图标（omp 没发 icon 名和 tone）", () => {
    expect(phases.map((phase) => phase.items.map((item) => item.status))).toEqual([
      ["done"],
      ["done", "done"],
      ["done"],
      ["done"],
    ]);
    expect(JSON.stringify(recorded)).not.toContain('"icon"');
    expect(JSON.stringify(recorded)).not.toContain('"tone"');
  });

  it("做完的阶段画对勾，不是进度环", () => {
    for (const phase of phases) expect(phaseMarkKind(phase.items.length, phase.items.length)).toBe("check");
  });

  it("没做完的阶段和空阶段仍是进度环", () => {
    expect(phaseMarkKind(1, 2)).toBe("ring");
    expect(phaseMarkKind(0, 0)).toBe("ring");
  });
});
