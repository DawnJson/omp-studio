// doc 节点（omp 19 计划评审正文）的纯逻辑：选区 → 原文 quote / at，批注 → 渲染文字里的范围（nodes/doc-model.ts）。
import { describe, expect, it } from "vitest";
import {
  blockAt,
  blockStarts,
  commentAnchor,
  locateComment,
  locateSelection,
  readComments,
  sortComments,
} from "../src/renderer/src/features/tsp/nodes/doc-model.ts";
import { applyMessage, createDocument } from "../src/shared/tsp/document.ts";
import { loadTspFixture, tspDocMessages } from "./tsp-fixtures.ts";

// omp 19.2.1 的 doc.text 是去掉标题行的计划原文（以换行开头），录制 fixtures/tsp/plan-review.jsonl。
const SOURCE = [
  "",
  "目标：让每次真实执行的耗时和失败原因都**可追溯**。",
  "",
  "## 1. 核对执行链路",
  "",
  "第1步先检查`任务记录`与执行结果。",
  "",
  "| 顺序 | 要做的事 |",
  "| --- | --- |",
  "| 第一周 | 收集[执行记录](https://example.com/a)并核对 |",
  "",
  "## 2. 核对执行链路",
  "",
  "第2步先检查`任务记录`与执行结果。",
  "",
].join("\n");

describe("选区 → 原文的 quote 和 at", () => {
  it("原样出现在原文里：quote 就是选中的文字，at 是它的 UTF-16 偏移（和录制里 omp 收下的一致）", () => {
    expect(locateSelection(SOURCE, "耗时和失败原因", 0)).toEqual({ quote: "耗时和失败原因", at: 12 });
  });

  it("同一句话出现多次时取选区所在块附近的那一处", () => {
    const second = SOURCE.lastIndexOf("## 2.");
    const located = locateSelection(SOURCE, "与执行结果", second);
    expect(located?.at).toBe(SOURCE.lastIndexOf("与执行结果"));
    expect(locateSelection(SOURCE, "与执行结果", 0)?.at).toBe(SOURCE.indexOf("与执行结果"));
  });

  it("跨了行内代码、加粗的选区对上原文里带记号的那一段", () => {
    expect(locateSelection(SOURCE, "失败原因都可追溯", 0)).toEqual({
      quote: "失败原因都**可追溯",
      at: SOURCE.indexOf("失败原因"),
    });
    const hint = SOURCE.indexOf("第2步");
    expect(locateSelection(SOURCE, "先检查任务记录与", hint)).toEqual({
      quote: "先检查`任务记录`与",
      at: SOURCE.lastIndexOf("先检查"),
    });
  });

  it("跨表格单元格和链接：链接地址不算进对位", () => {
    const located = locateSelection(SOURCE, "第一周\t收集执行记录并核对", 0);
    expect(located?.at).toBe(SOURCE.indexOf("第一周"));
    expect(located?.quote).toBe("第一周 | 收集[执行记录](https://example.com/a)并核对");
  });

  it("空白或对不上的选区没有结果", () => {
    expect(locateSelection(SOURCE, "  \n ", 0)).toBeNull();
    expect(locateSelection(SOURCE, "原文里没有的话", 0)).toBeNull();
  });
});

describe("批注锚点", () => {
  it("at 处正是 quote 就用 at，否则退到第一次出现（规范 TspDocComment.at）", () => {
    const at = SOURCE.lastIndexOf("与执行结果");
    expect(commentAnchor(SOURCE, { quote: "与执行结果", at })).toBe(at);
    expect(commentAnchor(SOURCE, { quote: "与执行结果", at: 3 })).toBe(SOURCE.indexOf("与执行结果"));
    expect(commentAnchor(SOURCE, { quote: "没有", at: undefined })).toBe(-1);
  });

  it("批注按锚点排序，找不到锚点的排最后", () => {
    const comments = readComments([
      { id: "c2", quote: "第2步", at: SOURCE.indexOf("第2步"), note: "b" },
      { id: "c9", quote: "已删掉的话", note: "x" },
      { id: "c1", quote: "耗时", at: 12, note: "a" },
      { id: 3, quote: "坏数据", note: "" },
    ]);
    expect(sortComments(SOURCE, comments).map((comment) => comment.id)).toEqual(["c1", "c2", "c9"]);
  });

  it("批注在渲染文字里的范围：从锚点所在块起找，同一句取锚点附近的那一处", () => {
    const starts = blockStarts(SOURCE);
    const at = SOURCE.lastIndexOf("与执行结果");
    const index = blockAt(starts, at);
    expect(SOURCE.slice(starts[index])).toMatch(/^第2步/);
    const rendered = "第2步先检查任务记录与执行结果。";
    expect(locateComment(SOURCE, { quote: "与执行结果", at }, starts[index]!, rendered)).toEqual({
      from: rendered.indexOf("与执行结果"),
      to: rendered.indexOf("与执行结果") + 5,
    });
    // 带记号的 quote 对上渲染后没有记号的文字。
    const first = blockAt(starts, 12);
    const bold = "目标：让每次真实执行的耗时和失败原因都可追溯。";
    const quote = "失败原因都**可追溯";
    expect(locateComment(SOURCE, { quote, at: SOURCE.indexOf(quote) }, starts[first]!, bold)).toEqual({
      from: bold.indexOf("失败原因"),
      to: bold.indexOf("可追溯") + 3,
    });
  });
});

describe("doc 的原文由 text 操作改写（规范 TSP_TEXT_KINDS 含 doc）", () => {
  it("plan-review.jsonl：就地编辑后 omp 回的 text append 接在原文后面", () => {
    const doc = createDocument();
    for (const { message } of tspDocMessages(loadTspFixture("plan-review"))) {
      const result = applyMessage(doc, message);
      expect(result.errors).toEqual([]);
      const text = doc.surfaces.get("s:1")?.nodes.get("layer/0/0/body/doc")?.p["text"];
      if (typeof text === "string" && text.endsWith("补充：每周复盘一次。")) return;
    }
    throw new Error("doc 的原文没有收到追加的段落");
  });
});
