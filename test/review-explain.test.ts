// 防的失败：改动说明把别的文件的 intent 挂到当前文件、失败的工具调用被当成改动、
// 绝对路径和相对路径写法不同时同一个文件被拆成两份、没有结论的轮出现空说明。
import { describe, expect, it } from "vitest";
import type { Turn, ToolStep } from "../src/renderer/src/features/conversation/model.ts";
import { explainChanges, notesForFile } from "../src/renderer/src/features/review/explain.ts";

let n = 0;
const tool = (name: string, args: unknown, patch: Partial<ToolStep> = {}): ToolStep => ({
  kind: "tool",
  key: `k${++n}`,
  toolCallId: `call-${n}`,
  name,
  intent: null,
  args,
  status: "done",
  output: null,
  result: null,
  startedAt: null,
  endedAt: null,
  ...patch,
});

const turn = (key: string, steps: ToolStep[], answer: string | null, request = "do it"): Turn =>
  ({
    key,
    user: { key: `u-${key}`, text: request, images: [], at: 0 },
    steps,
    answer: answer === null ? null : { key: `a-${key}`, text: answer, streaming: false },
  }) as unknown as Turn;

describe("explainChanges", () => {
  it("collects intents per file with the turn's conclusion", () => {
    const explanations = explainChanges([
      turn(
        "t1",
        [
          tool("edit", { path: "src/a.ts" }, { intent: "Rename helper" }),
          tool("read", { path: "src/a.ts" }, { intent: "Reading" }),
          tool("write", { path: "src/b.ts", content: "x\ny\n" }, { intent: "Add b" }),
        ],
        "Renamed the helper and added b.",
      ),
    ]);
    const a = notesForFile(explanations, "src/a.ts", null);
    expect(a).toHaveLength(1);
    expect(a[0]?.edits.map((edit) => edit.intent)).toEqual(["Rename helper"]);
    expect(a[0]?.conclusion).toBe("Renamed the helper and added b.");
    const b = notesForFile(explanations, "src/b.ts", null);
    expect(b[0]?.edits[0]).toMatchObject({ tool: "write", intent: "Add b", added: 2, removed: 0 });
  });

  it("ignores failed and running edits", () => {
    const explanations = explainChanges([
      turn(
        "t1",
        [tool("edit", { path: "a.ts" }, { status: "error" }), tool("edit", { path: "a.ts" }, { status: "running" })],
        "x",
      ),
    ]);
    expect(notesForFile(explanations, "a.ts", null)).toEqual([]);
  });

  it("keeps turns in conversation order and merges several edits of one turn", () => {
    const explanations = explainChanges([
      turn(
        "t1",
        [tool("edit", { path: "a.ts" }, { intent: "one" }), tool("edit", { path: "a.ts" }, { intent: "two" })],
        "first",
      ),
      turn("t2", [tool("edit", { path: "a.ts" }, { intent: "three" })], null, "again"),
    ]);
    const notes = notesForFile(explanations, "a.ts", null);
    expect(
      notes.map((note) => [note.turnKey, note.edits.map((edit) => edit.intent), note.conclusion, note.request]),
    ).toEqual([
      ["t1", ["one", "two"], "first", "do it"],
      ["t2", ["three"], null, "again"],
    ]);
  });

  it("treats a blank intent as missing and blank conclusions as none", () => {
    const explanations = explainChanges([turn("t1", [tool("edit", { path: "a.ts" }, { intent: "  " })], "  ")]);
    const [note] = notesForFile(explanations, "a.ts", null);
    expect(note?.edits[0]?.intent).toBeNull();
    expect(note?.conclusion).toBeNull();
  });
});

describe("notesForFile path matching", () => {
  const explanations = explainChanges([
    turn("t1", [tool("edit", { path: "C:\\work\\proj\\src\\a.ts" }, { intent: "abs" })], "done"),
    turn("t2", [tool("edit", { path: "src/a.ts" }, { intent: "rel" })], "done"),
    turn("t3", [tool("edit", { path: "src/other.ts" }, { intent: "other" })], "done"),
  ]);

  it("matches absolute and relative spellings of the same file, in order", () => {
    const notes = notesForFile(explanations, "src/a.ts", "C:\\work\\proj");
    expect(notes.map((note) => note.edits[0]?.intent)).toEqual(["abs", "rel"]);
  });

  it("matches by suffix when the repo root is above the task folder", () => {
    const notes = notesForFile(explanations, "proj/src/a.ts", "C:\\work\\proj\\src");
    expect(notes.map((note) => note.edits[0]?.intent)).toEqual(["abs"]);
  });

  it("does not match a different file or a name that merely ends the same", () => {
    expect(notesForFile(explanations, "a.ts", null)).toHaveLength(1);
    expect(notesForFile(explanations, "ther.ts", null)).toEqual([]);
  });
});
