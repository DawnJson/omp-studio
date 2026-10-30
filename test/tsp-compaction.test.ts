// `/compact` 的结局检测（omp 18.12.5 实录 fixtures/tsp/compact-ok.jsonl、compact-error.jsonl，路径已脱敏）：
// 没有 toast；成功 = main 里新增 omp.compaction 分隔，失败 = 新增 "Error: Compaction failed: …"。
// omp 18.14.0 的错误行改成 `omp.notice.error`、不带 "Error: "（fixtures/tsp/switch-compact-error.jsonl：切模型前的压缩失败）。
import { describe, expect, it } from "vitest";
import { compactionMark, compactionOutcome } from "../src/shared/tsp/compaction.ts";
import { applyMessage, createDocument } from "../src/shared/tsp/document.ts";
import { loadTspFixture, tspDocMessages } from "./tsp-fixtures.ts";

/** 回放到第一条满足 `at` 的输入事件之前，返回文档和"之后"的消息。 */
function split(
  name: string,
  at: (body: { text?: string; ev?: string }) => boolean = (body) => body.text === "/compact",
) {
  const lines = loadTspFixture(name);
  const index = lines.findIndex((line) => line.dir === "in" && at(line.body as { text?: string; ev?: string }));
  expect(index).toBeGreaterThan(0);
  const doc = createDocument();
  for (const { message } of tspDocMessages(lines.slice(0, index))) applyMessage(doc, message);
  return { doc, after: tspDocMessages(lines.slice(index)).map((entry) => entry.message) };
}

describe("compactionOutcome", () => {
  it("成功：压缩期间还没有结局，分隔出现后是 ok", () => {
    const { doc, after } = split("compact-ok");
    const before = compactionMark(doc);
    expect(compactionOutcome(doc, before)).toBeNull();
    expect(after.length).toBeGreaterThanOrEqual(2);
    // 第一帧只是"Compacting context…"的状态行：还不算结局。
    applyMessage(doc, after[0]!);
    expect(compactionOutcome(doc, before)).toBeNull();
    applyMessage(doc, after[1]!);
    expect(compactionOutcome(doc, before)).toEqual({ ok: true });
  });

  it("失败（会话太小）：新增的 Error: Compaction failed 文字原文返回", () => {
    const { doc, after } = split("compact-error");
    const before = compactionMark(doc);
    for (const message of after) applyMessage(doc, message);
    expect(compactionOutcome(doc, before)).toEqual({
      ok: false,
      error: "Error: Compaction failed: Nothing to compact (session too small)",
    });
  });

  it("失败（omp 18.14 的 omp.notice.error 行，没有 Error: 前缀）：原文返回", () => {
    const { doc, after } = split("switch-compact-error", (body) => body.ev === "activate");
    const before = compactionMark(doc);
    for (const message of after) applyMessage(doc, message);
    expect(compactionOutcome(doc, before)).toMatchObject({
      ok: false,
      error: expect.stringMatching(
        /^Compaction failed: Turn prefix summarization failed: 400 summarizer unavailable\n/,
      ),
    });
  });

  it("发命令前就有的分隔和错误不算", () => {
    const { doc, after } = split("compact-ok");
    for (const message of after) applyMessage(doc, message);
    expect(compactionOutcome(doc, compactionMark(doc))).toBeNull();
  });
});
