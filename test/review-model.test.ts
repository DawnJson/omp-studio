// 防的失败：评论的行范围落到错的一侧或顺序颠倒（agent 改错位置）、跨旧/新两侧的范围被接受、
// 暂存后选中项消失导致界面空白、文件两侧都有改动时只显示一侧、空评论被发出去。
import { describe, expect, it } from "vitest";
import type { GitDiffLine, GitFileChange } from "../src/shared/git.ts";
import {
  changeBlockStarts,
  commentCovers,
  composeCommitMessage,
  countChangeBlocks,
  commentsEndingAt,
  entryKey,
  flattenGroups,
  groupChanges,
  inSelection,
  indexStats,
  lineRef,
  rangeText,
  resolveSelection,
  selectionOf,
  selectRange,
  sortComments,
  stepEntry,
  stepHunk,
  toReviewComments,
  type QueuedComment,
} from "../src/shared/ui/review-model.ts";

const file = (path: string, staged: GitFileChange["staged"], unstaged: GitFileChange["unstaged"]): GitFileChange => ({
  path,
  oldPath: null,
  staged,
  unstaged,
});

const comment = (patch: Partial<QueuedComment>): QueuedComment => ({
  id: "c",
  area: "unstaged",
  file: "a.ts",
  startLine: 1,
  endLine: 1,
  side: "new",
  body: "x",
  ...patch,
});

describe("groupChanges", () => {
  it("splits staged / unstaged / untracked, sorts by path, omits empty groups", () => {
    const groups = groupChanges([
      file("b.ts", null, "modified"),
      file("a.ts", "added", null),
      file("c.txt", null, "untracked"),
      file("0.ts", null, "modified"),
    ]);
    expect(groups.map((group) => [group.area, group.entries.map((entry) => entry.path)])).toEqual([
      ["staged", ["a.ts"]],
      ["unstaged", ["0.ts", "b.ts"]],
      ["untracked", ["c.txt"]],
    ]);
  });

  it("lists a path with both sides changed once per side, with distinct keys", () => {
    const entries = flattenGroups(groupChanges([file("a.ts", "modified", "modified")]));
    expect(entries.map((entry) => entry.key)).toEqual([entryKey("staged", "a.ts"), entryKey("unstaged", "a.ts")]);
  });

  it("puts conflicted files only in unstaged", () => {
    const groups = groupChanges([file("m.ts", "conflicted", "conflicted")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.area).toBe("unstaged");
  });

  it("keeps the old path of a staged rename", () => {
    const [group] = groupChanges([{ path: "new.ts", oldPath: "old.ts", staged: "renamed", unstaged: null }]);
    expect(group?.entries[0]).toMatchObject({ path: "new.ts", oldPath: "old.ts", kind: "renamed" });
  });
});

describe("selection after the list changes", () => {
  const entries = flattenGroups(
    groupChanges([file("a", null, "modified"), file("b", null, "modified"), file("c", null, "modified")]),
  );

  it("keeps the selected entry while it exists", () => {
    expect(resolveSelection(entries, entryKey("unstaged", "b"), 0)?.path).toBe("b");
  });

  it("falls back to the entry now at the same position, clamped to the end", () => {
    expect(resolveSelection(entries, entryKey("staged", "b"), 1)?.path).toBe("b");
    expect(resolveSelection(entries, "gone", 9)?.path).toBe("c");
    expect(resolveSelection([], "gone", 0)).toBeNull();
  });

  it("steps files without wrapping", () => {
    const key = (path: string) => entryKey("unstaged", path);
    expect(stepEntry(entries, key("a"), -1)?.path).toBe("a");
    expect(stepEntry(entries, key("a"), 1)?.path).toBe("b");
    expect(stepEntry(entries, key("c"), 1)?.path).toBe("c");
    expect(stepEntry(entries, null, 1)?.path).toBe("a");
  });

  it("steps hunks without wrapping; n starts at the first, p at the last", () => {
    expect(stepHunk(0, null, 1)).toBeNull();
    expect(stepHunk(3, null, 1)).toBe(0);
    expect(stepHunk(3, null, -1)).toBe(2);
    expect(stepHunk(3, 2, 1)).toBe(2);
    expect(stepHunk(3, 0, -1)).toBe(0);
  });
});

describe("line selection", () => {
  const line = (patch: Partial<GitDiffLine>): GitDiffLine => ({
    kind: "context",
    oldNo: 4,
    newNo: 6,
    text: "",
    ...patch,
  });

  it("comments old numbers on deleted lines and new numbers otherwise", () => {
    expect(lineRef(line({ kind: "del", newNo: null }))).toEqual({ side: "old", line: 4 });
    expect(lineRef(line({ kind: "add", oldNo: null }))).toEqual({ side: "new", line: 6 });
    expect(lineRef(line({}))).toEqual({ side: "new", line: 6 });
    expect(lineRef(line({ kind: "del", oldNo: null }))).toBeNull();
  });

  it("extends in either direction and normalizes the order", () => {
    expect(selectRange({ side: "new", line: 9 }, { side: "new", line: 5 })).toEqual({ side: "new", start: 5, end: 9 });
    expect(selectRange({ side: "old", line: 2 }, { side: "old", line: 2 })).toEqual({ side: "old", start: 2, end: 2 });
  });

  it("refuses a range across old and new", () => {
    expect(selectRange({ side: "old", line: 2 }, { side: "new", line: 3 })).toBeNull();
  });

  it("tests membership by side and inclusive bounds", () => {
    const selection = selectRange({ side: "new", line: 5 }, { side: "new", line: 7 });
    expect(selection).not.toBeNull();
    if (selection === null) return;
    expect([4, 5, 6, 7, 8].map((n) => inSelection(selection, { side: "new", line: n }))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
    expect(inSelection(selection, { side: "old", line: 6 })).toBe(false);
    expect(selectionOf({ side: "old", line: 3 })).toEqual({ side: "old", start: 3, end: 3 });
  });
});

describe("comment queue", () => {
  it("finds comments covering a line only in the same file, area and side", () => {
    const c = comment({ startLine: 3, endLine: 5 });
    expect(commentCovers(c, "a.ts", "unstaged", { side: "new", line: 4 })).toBe(true);
    expect(commentCovers(c, "a.ts", "unstaged", { side: "new", line: 6 })).toBe(false);
    expect(commentCovers(c, "a.ts", "staged", { side: "new", line: 4 })).toBe(false);
    expect(commentCovers(c, "a.ts", "unstaged", { side: "old", line: 4 })).toBe(false);
    expect(commentCovers(c, "b.ts", "unstaged", { side: "new", line: 4 })).toBe(false);
  });

  it("anchors a range's comment under its last line", () => {
    const c = comment({ startLine: 3, endLine: 5 });
    expect(commentsEndingAt([c], "a.ts", "unstaged", { side: "new", line: 5 })).toEqual([c]);
    expect(commentsEndingAt([c], "a.ts", "unstaged", { side: "new", line: 3 })).toEqual([]);
  });

  it("formats ranges", () => {
    expect(rangeText(7, 7)).toBe("7");
    expect(rangeText(7, 9)).toBe("7–9");
  });

  it("sorts by first appearance of the file, then line, like the message the agent receives", () => {
    const sorted = sortComments([
      comment({ id: "1", file: "b.ts", startLine: 9 }),
      comment({ id: "2", file: "a.ts", startLine: 5 }),
      comment({ id: "3", file: "b.ts", startLine: 2 }),
      comment({ id: "4", file: "a.ts", startLine: 5, endLine: 7 }),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(["3", "1", "2", "4"]);
  });

  it("sends trimmed bodies without UI fields, dropping empty ones", () => {
    const sent = toReviewComments([
      comment({ id: "1", body: "  rename this \n" }),
      comment({ id: "2", body: "   " }),
      comment({ id: "3", file: "z.ts", side: "old", startLine: 2, endLine: 3, body: "why" }),
    ]);
    expect(sent).toEqual([
      { file: "a.ts", startLine: 1, endLine: 1, side: "new", body: "rename this" },
      { file: "z.ts", startLine: 2, endLine: 3, side: "old", body: "why" },
    ]);
    expect(sent[0]).not.toHaveProperty("id");
    expect(sent[0]).not.toHaveProperty("area");
  });
});

describe("unified view single line-number column", () => {
  const number = (line: GitDiffLine) => lineRef(line)?.line ?? null;
  it("deleted lines show the old number, added and context lines the new one", () => {
    expect(number({ kind: "del", oldNo: 7, newNo: null, text: "" })).toBe(7);
    expect(number({ kind: "add", oldNo: null, newNo: 9, text: "" })).toBe(9);
    // 上下文行两个行号不同时（前面有增删）取新行号，评论才落在 agent 手里的新文件上
    expect(number({ kind: "context", oldNo: 12, newNo: 14, text: "" })).toBe(14);
  });
});

describe("changeBlockStarts / countChangeBlocks", () => {
  it("numbers each run of changed rows once, at its first row", () => {
    expect(changeBlockStarts([false, true, true, false, true, false, false, true])).toEqual([
      null,
      0,
      null,
      null,
      1,
      null,
      null,
      2,
    ]);
    expect(changeBlockStarts([true, true])).toEqual([0, null]);
    expect(changeBlockStarts([])).toEqual([]);
  });

  it("a deletion run directly followed by an addition run is one block", () => {
    const lines: GitDiffLine[] = [
      { kind: "context", oldNo: 1, newNo: 1, text: "" },
      { kind: "del", oldNo: 2, newNo: null, text: "" },
      { kind: "add", oldNo: null, newNo: 2, text: "" },
      { kind: "context", oldNo: 3, newNo: 3, text: "" },
      { kind: "add", oldNo: null, newNo: 4, text: "" },
    ];
    expect(countChangeBlocks(lines)).toBe(2);
    expect(countChangeBlocks([])).toBe(0);
  });
});

describe("indexStats", () => {
  it("keys stats by area and path so the same file on both sides keeps both counts", () => {
    const stats = indexStats([
      { area: "staged", path: "a.ts", added: 3, removed: 1 },
      { area: "unstaged", path: "a.ts", added: 0, removed: 5 },
    ]);
    expect(stats.get(entryKey("staged", "a.ts"))).toEqual({ added: 3, removed: 1 });
    expect(stats.get(entryKey("unstaged", "a.ts"))).toEqual({ added: 0, removed: 5 });
    expect(stats.get(entryKey("untracked", "a.ts"))).toBeUndefined();
  });
});

describe("composeCommitMessage", () => {
  it("joins summary and description with a blank line, trimming both", () => {
    expect(composeCommitMessage("  fix: bug \n", "\n  why it broke\n\nmore\n")).toBe(
      "fix: bug\n\nwhy it broke\n\nmore",
    );
  });
  it("is just the summary when the description is blank", () => {
    expect(composeCommitMessage("fix: bug", "  \n ")).toBe("fix: bug");
  });
});
