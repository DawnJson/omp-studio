// eval 输出被 JSON 视图切成几段时，折叠中合成一段夹紧的范围（shared/tsp/run-output.ts），用真实 omp 18.13.1 的录制测。
import { describe, expect, it } from "vitest";
import { applyMessage, createDocument, type DocNode } from "../src/shared/tsp/document.ts";
import { runOutputSpan } from "../src/shared/tsp/run-output.ts";
import { loadTspFixture, tspDocMessages } from "./tsp-fixtures.ts";

/** 回放录制，每帧之后取所有 omp.run 列的子节点（按显示顺序）。 */
function runCells(name: string): { id: string; children: DocNode[] }[][] {
  const doc = createDocument();
  return tspDocMessages(loadTspFixture(name)).map(({ message }) => {
    applyMessage(doc, message);
    const cells: { id: string; children: DocNode[] }[] = [];
    for (const surface of doc.surfaces.values()) {
      for (const node of surface.nodes.values()) {
        if (node.p["role"] !== "omp.run") continue;
        cells.push({ id: node.id, children: node.c.map((id) => surface.nodes.get(id)!) });
      }
    }
    return cells;
  });
}

describe("eval 输出的合并范围", () => {
  it("文字、JSON 视图交替的输出合成一段：从代码之后到底栏之前，露 omp 给文字段的 10 行", () => {
    const frames = runCells("eval-split-output");
    const last = frames.at(-1)!;
    expect(last).toHaveLength(1);
    const { children } = last[0]!;
    const span = runOutputSpan(children);
    expect(span).toEqual({ start: 1, end: 6, lines: 10 });
    // 范围里正好是 3 段文字和 2 个 JSON 视图，代码和底栏在外面。
    expect(children.slice(span!.start, span!.end).map((child) => child.k)).toEqual([
      "ansi",
      "tree",
      "ansi",
      "tree",
      "ansi",
    ]);
    expect(children[0]!.p["role"]).toBe("omp.tool.eval.input");
    expect(children[span!.end]!.p["role"]).toBe("omp.run.foot");
  });

  it("只有一段文字输出时不合并，交给那一段自己夹紧（bash 的输出也是这种排法）", () => {
    const children = runCells("eval-split-output").at(-1)![0]!.children;
    const [input, output, , , , , foot] = children;
    expect(runOutputSpan([input, output, foot])).toBeNull();
  });
});
