// 回复里 ```svg 图的签名：文档一侧（omp 拆出的 md / image 兄弟节点）和会话文件一侧（助手消息原文）算出同一个签名，
// 会话文件按签名找回源码。节点 id 形状照 omp 19.2.1 实测（docs/architecture/conversation.md「svg 图」）。
import { describe, expect, it } from "vitest";
import { SessionFigureIndex } from "../src/main/tsp/session-figures.ts";
import { documentFigureSignature, figureSignature, parseFigureId, splitSvgFences } from "../src/shared/tsp/figures.ts";

const A = '<svg viewBox="0 0 10 10"><rect fill="var(--fg)"/></svg>';
const B = '<svg viewBox="0 0 20 20"><circle fill="var(--accent)"/></svg>';
const REPLY = `前文\n\n\`\`\`svg\n${A}\n\`\`\`\n\n中间\n\n\`\`\`svg\n${B}\n\`\`\`\n\n后文`;

function assistant(text: string) {
  return { type: "message", message: { role: "assistant", content: [{ type: "text", text }] } };
}

/** 文档一侧：omp 拆出来的兄弟节点（id → md 文字；图节点没有文字）。 */
function docSignature(figureId: string, nodes: Record<string, string | null>): string {
  const figure = parseFigureId(figureId);
  if (figure === null) throw new Error("not a figure id");
  return documentFigureSignature(figure, Object.keys(nodes), (id) => nodes[id] ?? null);
}

describe("splitSvgFences", () => {
  it("按 svg 围栏切开，别的围栏（含里面写着 ```svg 的示例）留在文字里，没闭合的不算图", () => {
    expect(splitSvgFences(REPLY)).toEqual({ segments: ["前文", "中间", "后文"], svgs: [A, B] });
    const nested = "看这个：\n\n````markdown\n```svg\n<svg/>\n```\n````\n\n完";
    expect(splitSvgFences(nested).svgs).toEqual([]);
    expect(splitSvgFences("开头\n```svg\n<svg>").svgs).toEqual([]);
  });
});

describe("文档和会话文件的签名一致", () => {
  const nodes = {
    "main/4/t0": "前文",
    "main/4/svg:t0.1~1": null,
    "main/4/t0.2": "中间",
    "main/4/svg:t0.3~1": null,
    "main/4/t0.4": "后文",
  };

  it("两张图各自找回源码", () => {
    const index = new SessionFigureIndex();
    index.entry(assistant(REPLY));
    for (const [id, svg] of [
      ["main/4/svg:t0.1~1", A],
      ["main/4/svg:t0.3~1", B],
    ] as const) {
      const figure = parseFigureId(id)!;
      expect(index.find(docSignature(id, nodes))?.[figure.ordinal]).toBe(svg);
    }
  });

  it("回复以图开头、以图结尾（omp 不出空的文字节点）", () => {
    const text = `\`\`\`svg\n${A}\n\`\`\`\n\n说明\n\n\`\`\`svg\n${B}\n\`\`\``;
    const index = new SessionFigureIndex();
    index.entry(assistant(text));
    const signature = docSignature("main/2/svg:t0.3~1", {
      "main/2/svg:t0.1~1": null,
      "main/2/t0.2": "说明",
      "main/2/svg:t0.3~1": null,
    });
    expect(signature).toBe(figureSignature(splitSvgFences(text).segments));
    expect(index.find(signature)).toEqual([A, B]);
  });

  it("两条回复文字相同、图不同：分不清，不给；图也相同时照给", () => {
    const index = new SessionFigureIndex();
    index.entry(assistant(REPLY));
    index.entry(assistant(REPLY));
    expect(index.find(docSignature("main/4/svg:t0.1~1", nodes))).toEqual([A, B]);
    index.entry(assistant(REPLY.replace(A, B)));
    expect(index.find(docSignature("main/4/svg:t0.1~1", nodes))).toBeNull();
  });

  it("会话文件里还没有这条回复、用户消息里写的 svg 不算", () => {
    const index = new SessionFigureIndex();
    index.entry({ type: "message", message: { role: "user", content: [{ type: "text", text: REPLY }] } });
    expect(index.find(docSignature("main/4/svg:t0.1~1", nodes))).toBeNull();
  });
});

describe("parseFigureId", () => {
  it("只认 omp 的图节点 id", () => {
    expect(parseFigureId("main/4/svg:t1.3~1")).toEqual({ prefix: "main/4/", block: "t1", ordinal: 1 });
    expect(parseFigureId("main/4/t0.2")).toBeNull();
    expect(parseFigureId("main/4/svg:t0.2~1")).toBeNull();
  });
});
