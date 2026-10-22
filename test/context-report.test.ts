// omp 的 /context 报告解析（omp 18.12.6 实录 fixtures/tsp/context-report.jsonl：点 meter 打开、点 Close 关，做了两次）。
import { describe, expect, it } from "vitest";
import { applyMessage, createDocument } from "../src/shared/tsp/document.ts";
import { findContextReport, type OmpContextReport } from "../src/shared/tsp/context-report.ts";
import { loadTspFixture, tspDocMessages } from "./tsp-fixtures.ts";

/** 每条文档消息之后的解析结果（按录制顺序）。 */
function replay(): (OmpContextReport | null)[] {
  const doc = createDocument();
  return tspDocMessages(loadTspFixture("context-report")).map(({ message }) => {
    applyMessage(doc, message);
    return findContextReport(doc);
  });
}

describe("findContextReport（omp 18.12.6 实录）", () => {
  it("报告弹出时读出每类的精确 token 数（title 里的千分位数，不是行里的 3K 缩写），已用不含剩余和预留", () => {
    const first = replay().find((result) => result !== null);
    expect(first?.report).toEqual({
      rows: [
        { key: "systemPrompt", label: "System prompt", tokens: 2958 },
        { key: "systemTools", label: "System tools", tokens: 4543 },
        { key: "systemContext", label: "System context", tokens: 115 },
        { key: "skills", label: "Skills", tokens: 549 },
        { key: "messages", label: "Messages", tokens: 0 },
        { key: "free", label: "Free space", tokens: 161835 },
        { key: "buffer", label: "Autocompact buffer", tokens: 30000 },
      ],
      used: 8165,
      window: 200000,
    });
  });

  it("关闭按钮就是录制里 studio 发回去的那个 action（omp 据此关掉了报告）", () => {
    const closes = loadTspFixture("context-report")
      .filter((line) => line.dir === "in" && (line.body as { act?: string }).act === "close")
      .map((line) => line.body as { id: string; act: string });
    const opened = replay().filter((result): result is OmpContextReport => result !== null);
    const distinct = [...new Map(opened.map((result) => [result.close?.id, result.close])).values()];
    expect(distinct).toEqual(closes.map(({ id, act }) => ({ id, act })));
  });

  it("每次关闭之后都读不到报告（两次打开各自关掉，最后不留着）", () => {
    const results = replay();
    const transitions = results
      .map((result) => result !== null)
      .filter((open, i, all) => i === 0 || open !== all[i - 1]);
    expect(transitions).toEqual([false, true, false, true, false]);
  });
});
