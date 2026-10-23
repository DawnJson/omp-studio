// 输入框卡片上上下文 meter 里的自动压缩信息（src/shared/tsp/context-compaction.ts）。
// 阈值部分对着 omp 真实录制：task.jsonl（18.12.3，Auto-compact at 90%，没有预生成摘要）、goal-budget.jsonl（18.12.5，预生成从 82% 起、85% 压缩）。
// 摘要状态（生成中 / 已备好）的那两行标题没有在真机上触发过（要把上下文用到预生成起点），按 omp 18.12.6 源码 `status-line/component.ts` 的文字写。
import { describe, expect, it } from "vitest";
import { deriveContextCompaction, parseContextCompaction } from "../src/shared/tsp/context-compaction.ts";
import { applyMessage, createDocument, type TspDocument } from "../src/shared/tsp/document.ts";
import { loadTspFixture, tspDocMessages } from "./tsp-fixtures.ts";

function finalDoc(name: string): TspDocument {
  const doc = createDocument();
  for (const { message } of tspDocMessages(loadTspFixture(name))) applyMessage(doc, message);
  return doc;
}

describe("deriveContextCompaction（真实录制）", () => {
  it("task.jsonl：omp 给的自动压缩触发点是 90%，没有预生成摘要", () => {
    expect(deriveContextCompaction(finalDoc("task"))).toEqual({
      autoAtPercent: 90,
      summaryStartsAtPercent: null,
      summary: null,
    });
  });

  it("goal-budget.jsonl：预生成摘要从 81.8% 起，85% 自动压缩；用量还远没到，摘要没在生成", () => {
    expect(deriveContextCompaction(finalDoc("goal-budget"))).toEqual({
      autoAtPercent: 85,
      summaryStartsAtPercent: 81.8,
      summary: null,
    });
  });

  it("输入框被提问 / 审批换掉的帧返回 undefined（调用方沿用上一次的值）", () => {
    expect(deriveContextCompaction(createDocument())).toBeUndefined();
  });
});

describe("parseContextCompaction", () => {
  const marks = [
    { at: 0.818, icon: "context.speculation", title: "Compaction summary starts at 82%" },
    { at: 0.85, icon: "context.compaction", title: "Auto-compact at 85%" },
  ];

  it("摘要在生成 / 已备好：标题里多一行（omp 源码的文字）", () => {
    const base = "Context 83% used\n830K of 1M tokens\nAuto-compact at 85%";
    expect(parseContextCompaction({ marks, title: `${base}\nCompaction summary in progress` })?.summary).toBe(
      "running",
    );
    expect(parseContextCompaction({ marks, title: `${base}\nCompaction summary ready` })?.summary).toBe("ready");
    expect(parseContextCompaction({ marks, title: base })?.summary).toBeNull();
  });

  it("没有 marks 时读标题里的 Auto-compact at N%", () => {
    expect(parseContextCompaction({ title: "Context 1% used\n8K of 1M tokens\nAuto-compact at 90%" })).toEqual({
      autoAtPercent: 90,
      summaryStartsAtPercent: null,
      summary: null,
    });
  });

  it("自动压缩关着（没有 marks、标题里没有 Auto-compact 行）是 null，不编一个", () => {
    expect(parseContextCompaction({ title: "Context 1% used\n8K of 1M tokens" })).toBeNull();
    expect(parseContextCompaction({})).toBeNull();
  });

  it("比例夹在 0–100", () => {
    expect(parseContextCompaction({ marks: [{ at: 1.4, icon: "context.compaction" }] })?.autoAtPercent).toBe(100);
  });
});
