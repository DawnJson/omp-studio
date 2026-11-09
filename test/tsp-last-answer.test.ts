// lastAnswerText（shared/tsp/last-answer.ts）：从 TSP 文档取最后一条助手消息的正文。
import { describe, expect, it } from "vitest";
import { applyMessage, createDocument, type TspDocument } from "../src/shared/tsp/document.ts";
import { answerNodeIds, answerText, lastAnswerText } from "../src/shared/tsp/last-answer.ts";
import { loadTspFixture, tspDocMessages } from "./tsp-fixtures.ts";

function replay(name: string): TspDocument {
  const doc = createDocument();
  for (const { message } of tspDocMessages(loadTspFixture(name))) applyMessage(doc, message);
  return doc;
}

type Add = ["add", string, string, null, Record<string, unknown>];
const add = (id: string, parent: string, k: string, p?: Record<string, unknown>): Add => [
  "add",
  id,
  parent,
  null,
  { id, k, ...(p === undefined ? {} : { p }) },
];

/** 合成一个 inline surface：main 下按给定顺序挂节点。 */
function synthetic(ops: Add[]): TspDocument {
  const doc = createDocument();
  applyMessage(doc, { verb: "o", body: { id: "s:1", mode: "inline", title: "omp", role: "omp.session" } });
  applyMessage(doc, {
    verb: "f",
    body: { sf: "s:1", s: 1, ops: [add("main", "s:1", "col"), add("dock", "s:1", "col"), ...ops] },
  } as never);
  return doc;
}

describe("lastAnswerText", () => {
  it("真实录制（fixtures/tsp/task.jsonl，omp 18.12.5）：取最后一条助手消息的 markdown 原文，不含用量行", () => {
    expect(lastAnswerText(replay("task"))).toBe(
      "两个并行子代理分别修复了 `calc/ops.py` 里的 `sub`、`div`、`mean` 和 `calc/text.py` 里的 `count_words`。`python -m pytest -q` 运行结果为 **29 passed**，全部通过。",
    );
  });

  it("只有工具调用、没有正文的助手消息跳过，取更早的有正文的那条", () => {
    const doc = synthetic([
      add("a1", "main", "col", { role: "omp.assistant" }),
      add("a1.t", "a1", "md", { text: "第一条回答" }),
      add("a2", "main", "col", { role: "omp.assistant" }),
      add("a2.tool", "a2", "tool", { role: "omp.tool.bash" }),
      add("a2.tool.m", "a2.tool", "md", { text: "工具卡片里的 markdown 不算" }),
    ]);
    expect(lastAnswerText(doc)).toBe("第一条回答");
  });

  it("同一条消息里的多段正文用空行连起来；带 role 的 md（任务说明）、思考块、错误卡不算", () => {
    const doc = synthetic([
      add("a1", "main", "col", { role: "omp.assistant" }),
      add("a1.k", "a1", "col", { role: "omp.thinking" }),
      add("a1.k.m", "a1.k", "md", { text: "思考内容" }),
      add("a1.t0", "a1", "md", { text: "先说这个\n" }),
      add("a1.x", "a1", "md", { role: "omp.task.assignment", text: "子代理任务" }),
      add("a1.t1", "a1", "md", { text: "  再说那个" }),
      add("a1.e", "a1", "card", { role: "omp.error" }),
      add("a1.e.m", "a1.e", "md", { text: "错误文字" }),
    ]);
    expect(lastAnswerText(doc)).toBe("先说这个\n\n再说那个");
  });

  it("没有助手消息、没有 inline surface 时为 null", () => {
    expect(lastAnswerText(createDocument())).toBeNull();
    expect(lastAnswerText(synthetic([add("u", "main", "col", { role: "omp.user" })]))).toBeNull();
  });
});

describe("answerText / answerNodeIds（每轮用量行上的复制回答：复制所在那条助手消息）", () => {
  it("取的是给定容器自己的正文，不是对话里最后一条；纯工具调用的容器为空", () => {
    const doc = synthetic([
      add("a1", "main", "col", { role: "omp.assistant" }),
      add("a1.t", "a1", "md", { text: "第一轮的回答" }),
      add("a2", "main", "col", { role: "omp.assistant" }),
      add("a2.tool", "a2", "tool", { role: "omp.tool.bash" }),
      add("a3", "main", "col", { role: "omp.assistant" }),
      add("a3.t0", "a3", "md", { text: "第二轮" }),
      add("a3.k", "a3", "col", { role: "omp.thinking" }),
      add("a3.k.m", "a3.k", "md", { text: "思考" }),
      add("a3.t1", "a3", "md", { text: "的回答" }),
    ]);
    const surface = doc.surfaces.get("s:1")!;
    expect(answerText(surface, "a1")).toBe("第一轮的回答");
    expect(answerText(surface, "a2")).toBe("");
    expect(answerText(surface, "a3")).toBe("第二轮\n\n的回答");
    expect(answerNodeIds(surface, "a3")).toEqual(["a3.t0", "a3.t1"]);
  });
});
