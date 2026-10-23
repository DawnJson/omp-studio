// `/handoff` 的结局检测（omp 18.12.6 真实录制，2026-10-23，路径已脱敏）：
// - handoff-ok.jsonl：三轮对话（`compaction.keepRecentTokens` 调小）后 `/handoff`：dock 里 loader "Generating handoff…"，成功后 main 里新增
//   `omp.compaction` 分隔（头 "Handed-off · 13K → 9.8K tokens"）、toast "Session compacted 1 time" 和一行 "Context handed off and compacted in place"；
//   紧接着 `/compact` 得到 "Error: Compaction failed: Already compacted"。
// - handoff-error.jsonl：只有两轮的短会话：`Error: Handoff failed: Nothing to hand off (already compacted)`。
import { describe, expect, it } from "vitest";
import { compactionMark, compactionOutcome } from "../src/shared/tsp/compaction.ts";
import { applyMessage, createDocument } from "../src/shared/tsp/document.ts";
import { loadTspFixture, tspDocMessages } from "./tsp-fixtures.ts";

/** 回放到发出 `text` 的那一行之前；返回文档和之后（到下一条命令前）的消息。 */
function split(name: string, text: string) {
  const lines = loadTspFixture(name);
  const sent = (line: (typeof lines)[number]) =>
    line.dir === "in" && typeof line.body === "object" && line.body !== null && "text" in line.body
      ? line.body.text
      : null;
  const at = lines.findIndex((line) => sent(line) === text);
  expect(at).toBeGreaterThan(0);
  const next = lines.findIndex((line, index) => index > at && sent(line) !== null);
  const doc = createDocument();
  for (const { message } of tspDocMessages(lines.slice(0, at))) applyMessage(doc, message);
  return { doc, after: tspDocMessages(lines.slice(at, next < 0 ? undefined : next)).map((entry) => entry.message) };
}

describe("compactionOutcome 用于 /handoff", () => {
  it("成功：交接期间没有结局，分隔出现后是 ok", () => {
    const { doc, after } = split("handoff-ok", "/handoff");
    const before = compactionMark(doc);
    expect(compactionOutcome(doc, before)).toBeNull();
    let outcome = compactionOutcome(doc, before);
    for (const message of after) {
      applyMessage(doc, message);
      outcome ??= compactionOutcome(doc, before);
    }
    expect(outcome).toEqual({ ok: true });
  });

  it("失败（会话太短，没东西可交接）：Error: Handoff failed 原文返回", () => {
    const { doc, after } = split("handoff-error", "/handoff");
    const before = compactionMark(doc);
    for (const message of after) applyMessage(doc, message);
    expect(compactionOutcome(doc, before)).toEqual({
      ok: false,
      error: "Error: Handoff failed: Nothing to hand off (already compacted)",
    });
  });

  it("交接之后立刻 /compact：新增的 Error: Compaction failed: Already compacted 是失败，不把交接留下的分隔当成功", () => {
    const { doc, after } = split("handoff-ok", "/compact");
    const before = compactionMark(doc);
    for (const message of after) applyMessage(doc, message);
    expect(compactionOutcome(doc, before)).toEqual({
      ok: false,
      error: "Error: Compaction failed: Already compacted",
    });
  });
});
