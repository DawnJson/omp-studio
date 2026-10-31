// fixtures/tsp/ 里 omp 录制的手工整理规则（录制只记 TSP 消息，不记按键；假 omp 按录制回放）：
// - 括号粘贴出来的图片 chip（`k.image:*` 节点）之前要有一行 `{"dir":"in","verb":"k"}`，写粘贴按键里的一段：
//   不然假 omp 按时间提前放出粘贴结果，studio 发送前清 omp 输入框时把它当残留清掉，测试卡在等输入框。
// - `in` 方向的 `r blobs`（studio 回 omp 的 blob 查询）要删掉：假 omp 不该等它。
// - 每个 blob（`out` 的 `b`）的 id 是内容的 sha256：tsp-session.ts 校验，对不上就拒收，图根本画不出来。
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { isRecord } from "../src/shared/type-guards.ts";
import { loadTspFixture, tspFixtureDir, type TspRecordLine } from "./tsp-fixtures.ts";

/** 这一帧有没有新加图片 chip 节点（`["add", "k.image:1", ...]`）。 */
function addsImageChip(line: TspRecordLine): boolean {
  if (line.dir !== "out" || line.verb !== "f" || !isRecord(line.body) || !Array.isArray(line.body["ops"])) return false;
  return line.body["ops"].some(
    (op) => Array.isArray(op) && op[0] === "add" && typeof op[1] === "string" && op[1].startsWith("k.image:"),
  );
}

const isPasteKey = (line: TspRecordLine): boolean =>
  line.dir === "in" &&
  line.verb === "k" &&
  typeof line.body === "string" &&
  (line.body.includes("\u001b[200~") || line.body.includes("\u001b[201~"));

/** 一份录制违反的规则，每条一行（行号从 1 起）。 */
function lintRecording(lines: readonly TspRecordLine[]): string[] {
  const problems: string[] = [];
  const firstChip = lines.findIndex(addsImageChip);
  if (firstChip !== -1 && !lines.slice(0, firstChip).some(isPasteKey))
    problems.push(`第 ${firstChip + 1} 行出现图片 chip，前面没有括号粘贴的 "verb":"k" 行`);
  for (const [index, line] of lines.entries()) {
    if (line.dir === "in" && line.verb === "r" && isRecord(line.body) && line.body["r"] === "blobs")
      problems.push(`第 ${index + 1} 行是 in 方向的 r blobs，要删掉`);
    if (line.dir === "out" && line.verb === "b") {
      const id = line.params?.["id"];
      const actual = createHash("sha256")
        .update(Buffer.from(String(line.body), "base64"))
        .digest("hex");
      if (id !== actual) problems.push(`第 ${index + 1} 行 blob 的 id ${id} 不是内容的 sha256（${actual}）`);
    }
  }
  return problems;
}

describe("规则本身", () => {
  const png = Buffer.from("not really a png");
  const sha = createHash("sha256").update(png).digest("hex");
  const chip: TspRecordLine = {
    t: 3,
    dir: "out",
    verb: "f",
    body: { sf: "s:1", s: 1, ops: [["add", "k.image:1", "k", null, { id: "k.image:1", k: "card" }]] },
  };
  const paste: TspRecordLine = { t: 1, dir: "in", verb: "k", body: '"\u001b[201~' };
  const blob = (id: string): TspRecordLine => ({
    t: 2,
    dir: "out",
    verb: "b",
    params: { id, mime: "image/png" },
    body: png.toString("base64"),
  });

  test("整理好的录制没有问题", () => {
    expect(lintRecording([paste, blob(sha), chip])).toEqual([]);
  });

  test("图片 chip 前没有粘贴按键行", () => {
    expect(lintRecording([blob(sha), chip])).toEqual([expect.stringContaining("第 2 行出现图片 chip")]);
  });

  test("in 方向的 r blobs", () => {
    const reply: TspRecordLine = { t: 4, dir: "in", verb: "r", body: { r: "blobs", ids: [sha] } };
    expect(lintRecording([paste, blob(sha), chip, reply])).toEqual([
      expect.stringContaining("第 4 行是 in 方向的 r blobs"),
    ]);
  });

  test("blob id 不是内容的 sha256", () => {
    expect(lintRecording([paste, blob("aa11"), chip])).toEqual([expect.stringContaining("blob 的 id aa11")]);
  });
});

const names = readdirSync(tspFixtureDir)
  .filter((file) => file.endsWith(".jsonl"))
  .map((file) => file.slice(0, -".jsonl".length));

test("fixtures/tsp 里有录制", () => {
  expect(names.length).toBeGreaterThan(0);
});

test.each(names)("fixtures/tsp/%s.jsonl", (name) => {
  expect(lintRecording(loadTspFixture(name))).toEqual([]);
});
