import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GitDiffHunk, GitFileDiff } from "../src/shared/git.ts";
import { buildLinePatch, splitRawDiff } from "../src/main/git/diff.ts";
import { discardLines, getFileDiff, stageLines, unstageLines } from "../src/main/git/review.ts";
import { FORTY_LINES, makeRepo, makeScratch, put, sh } from "./git-helpers.ts";

let scratch: string;
let n = 0;
beforeAll(async () => {
  scratch = await makeScratch("lines");
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const TEXT = "src 目录/文件 一.txt";
const fresh = () => makeRepo(scratch, `仓库 ${++n}`);

const HEADER = "diff --git a/f.txt b/f.txt\nindex 1111111..2222222 100644\n--- a/f.txt\n+++ b/f.txt\n";
const rawOf = (hunk: string) => {
  const raw = splitRawDiff(Buffer.from(HEADER + hunk, "latin1"));
  if (raw === null) throw new Error("not a text diff");
  return raw;
};
const patchText = (hunk: string, selected: number[], direction: "forward" | "reverse") =>
  buildLinePatch(rawOf(hunk), 0, new Set(selected), direction).toString("latin1").slice(HEADER.length);

describe("buildLinePatch（选中行 → 补丁）", () => {
  // 下标：0 ' a'，1 '-b'，2 '+B'，3 '+B2'，4 ' c'，5 ' d'
  const MIXED = "@@ -1,4 +1,5 @@ fn\n a\n-b\n+B\n+B2\n c\n d\n";

  it("只选删除行（forward）：没选的新增行丢掉，旧侧不变", () => {
    expect(patchText(MIXED, [1], "forward")).toBe("@@ -1,4 +1,3 @@ fn\n a\n-b\n c\n d\n");
  });

  it("只选新增行（forward）：没选的删除行变成上下文", () => {
    expect(patchText(MIXED, [2], "forward")).toBe("@@ -1,4 +1,5 @@ fn\n a\n b\n+B\n c\n d\n");
  });

  it("混合选择：删除 + 其中一行新增", () => {
    expect(patchText(MIXED, [1, 3], "forward")).toBe("@@ -1,4 +1,4 @@ fn\n a\n-b\n+B2\n c\n d\n");
  });

  it("reverse：没选的新增行变成上下文，没选的删除行丢掉", () => {
    expect(patchText(MIXED, [3], "reverse")).toBe("@@ -1,4 +1,5 @@ fn\n a\n B\n+B2\n c\n d\n");
    expect(patchText(MIXED, [1], "reverse")).toBe("@@ -1,6 +1,5 @@ fn\n a\n-b\n B\n B2\n c\n d\n");
  });

  it("纯新增的 hunk（旧侧 0 行）：起始行按 git 的约定写成前一行", () => {
    const hunk = "@@ -0,0 +1,2 @@\n+x\n+y\n";
    expect(patchText(hunk, [1], "forward")).toBe("@@ -0,0 +1,1 @@\n+y\n");
  });

  it("文件末尾没有换行：标记跟着它的那一行走", () => {
    const hunk =
      "@@ -1,2 +1,2 @@\n one\n-two\n\\ No newline at end of file\n+two changed\n\\ No newline at end of file\n";
    // 只选删除行：新增行连同它的标记一起丢掉。
    expect(patchText(hunk, [1], "forward")).toBe("@@ -1,2 +1,1 @@\n one\n-two\n\\ No newline at end of file\n");
    // 两行都选：原样。
    expect(patchText(hunk, [1, 2], "forward")).toBe(hunk);
    // 只选新增行：旧行变成上下文却不再是最后一行，拼不出这样的文件，拒绝而不是写出坏补丁。
    expect(() => patchText(hunk, [2], "forward")).toThrow(/newline/);
  });

  it("CRLF 文件：行尾的 \\r 原样保留", () => {
    const hunk = "@@ -1,3 +1,3 @@\n a\r\n-b\r\n+B\r\n c\r\n";
    expect(patchText(hunk, [1, 2], "forward")).toBe(hunk);
    expect(patchText(hunk, [2], "forward")).toBe("@@ -1,3 +1,4 @@\n a\r\n b\r\n+B\r\n c\r\n");
  });

  it("选了上下文行、越界、没选任何行都拒绝", () => {
    expect(() => patchText(MIXED, [0], "forward")).toThrow(/added or removed/);
    expect(() => patchText(MIXED, [9], "forward")).toThrow(/added or removed/);
    expect(() => patchText(MIXED, [], "forward")).toThrow(/no lines/);
  });
});

function textHunks(diff: GitFileDiff): GitDiffHunk[] {
  if (diff.kind !== "text") throw new Error(`expected a text diff, got ${diff.kind}`);
  return diff.hunks;
}

/** 行内容 → hunk.lines 的下标（add / del 前缀区分同名行）。 */
function at(hunk: GitDiffHunk | undefined, kind: "add" | "del", text: string): number {
  const found = hunk?.lines.findIndex((line) => line.kind === kind && line.text === text) ?? -1;
  if (found === -1) throw new Error(`no ${kind} line ${text}`);
  return found;
}

const ref = (hunks: GitDiffHunk[], index: number, lines: number[]) => ({
  index,
  header: hunks[index]?.header ?? "",
  lines,
});

/** 第 3 行换成两行、删第 5 行、第 6 行后插一行：同一个 hunk 里有三处改动。 */
async function editOneHunk(dir: string) {
  const lines = FORTY_LINES.split("\n");
  lines.splice(2, 1, "第 3 行（改）", "第 3 行（再加）");
  lines.splice(5, 1); // 原第 5 行（现在在下标 5）
  lines.splice(7, 0, "插入的一行");
  await put(dir, TEXT, lines.join("\n"));
}

describe("按行暂存 / 取消暂存 / 丢弃（真实仓库，路径含空格和中文）", () => {
  it("暂存选中的行：索引只多这几行，工作区不变，剩下的仍是未暂存", async () => {
    const dir = await fresh();
    await editOneHunk(dir);
    const before = await readFile(path.join(dir, TEXT), "utf8");
    const hunks = textHunks(await getFileDiff(dir, TEXT, "unstaged"));
    expect(hunks).toHaveLength(1);
    const hunk = hunks[0];

    await stageLines(dir, TEXT, ref(hunks, 0, [at(hunk, "del", "第 3 行"), at(hunk, "add", "第 3 行（改）")]));

    const staged = textHunks(await getFileDiff(dir, TEXT, "staged"));
    expect(
      staged.flatMap((h) => h.lines.filter((l) => l.kind !== "context").map((l) => `${l.kind}:${l.text}`)),
    ).toEqual(["del:第 3 行", "add:第 3 行（改）"]);
    expect(await readFile(path.join(dir, TEXT), "utf8")).toBe(before);
    const rest = textHunks(await getFileDiff(dir, TEXT, "unstaged"));
    expect(rest.flatMap((h) => h.lines.filter((l) => l.kind !== "context").map((l) => `${l.kind}:${l.text}`))).toEqual([
      "add:第 3 行（再加）",
      "del:第 5 行",
      "add:插入的一行",
    ]);
  });

  it("只暂存新增行：被替换的旧行留在索引里（先加后删的顺序不影响结果）", async () => {
    const dir = await fresh();
    await editOneHunk(dir);
    const hunks = textHunks(await getFileDiff(dir, TEXT, "unstaged"));
    await stageLines(dir, TEXT, ref(hunks, 0, [at(hunks[0], "add", "插入的一行")]));
    expect(sh(dir, "diff", "--cached", "-U0", "--", TEXT)).toContain("+插入的一行");
    expect(sh(dir, "diff", "--cached", "--numstat", "--", TEXT)).toBe(`1\t0\t${TEXT}`);
  });

  it("连着改 3 行只挑中间那对：暂存后新行在原位置（不挪到没选中的行后面），丢弃后旧行也回到原位置", async () => {
    const dir = await fresh();
    const lines = FORTY_LINES.split("\n");
    lines.splice(2, 3, "第 3 行（改）", "第 4 行（改）", "第 5 行（改）");
    await put(dir, TEXT, lines.join("\n"));
    const hunks = textHunks(await getFileDiff(dir, TEXT, "unstaged"));
    const pair = (hunk: GitDiffHunk | undefined) => [at(hunk, "del", "第 4 行"), at(hunk, "add", "第 4 行（改）")];

    await stageLines(dir, TEXT, ref(hunks, 0, pair(hunks[0])));
    expect(sh(dir, "show", `:${TEXT}`).split("\n").slice(1, 6)).toEqual([
      "第 2 行",
      "第 3 行",
      "第 4 行（改）",
      "第 5 行",
      "第 6 行",
    ]);

    sh(dir, "reset", "-q");
    const again = textHunks(await getFileDiff(dir, TEXT, "unstaged"));
    await discardLines(dir, TEXT, ref(again, 0, pair(again[0])));
    expect((await readFile(path.join(dir, TEXT), "utf8")).split("\n").slice(1, 6)).toEqual([
      "第 2 行",
      "第 3 行（改）",
      "第 4 行",
      "第 5 行（改）",
      "第 6 行",
    ]);
  });

  it("取消暂存选中的行：先全部暂存，再退回两行，其余仍在暂存区", async () => {
    const dir = await fresh();
    await editOneHunk(dir);
    sh(dir, "add", "-A");
    const staged = textHunks(await getFileDiff(dir, TEXT, "staged"));
    const hunk = staged[0];
    await unstageLines(dir, TEXT, ref(staged, 0, [at(hunk, "add", "第 3 行（再加）"), at(hunk, "del", "第 5 行")]));

    const stillStaged = textHunks(await getFileDiff(dir, TEXT, "staged"));
    expect(
      stillStaged.flatMap((h) => h.lines.filter((l) => l.kind !== "context").map((l) => `${l.kind}:${l.text}`)),
    ).toEqual(["del:第 3 行", "add:第 3 行（改）", "add:插入的一行"]);
    const unstaged = textHunks(await getFileDiff(dir, TEXT, "unstaged"));
    expect(
      unstaged.flatMap((h) => h.lines.filter((l) => l.kind !== "context").map((l) => `${l.kind}:${l.text}`)),
    ).toEqual(["add:第 3 行（再加）", "del:第 5 行"]);
  });

  it("丢弃选中的行：工作区只回退这几行，其余改动还在", async () => {
    const dir = await fresh();
    await editOneHunk(dir);
    const hunks = textHunks(await getFileDiff(dir, TEXT, "unstaged"));
    const hunk = hunks[0];
    // 丢弃"插入的一行"和"删掉第 5 行"：前者被删掉，后者被恢复。
    await discardLines(dir, TEXT, ref(hunks, 0, [at(hunk, "add", "插入的一行"), at(hunk, "del", "第 5 行")]));
    const content = await readFile(path.join(dir, TEXT), "utf8");
    expect(content).not.toContain("插入的一行");
    expect(content).toContain("第 5 行\n");
    expect(content).toContain("第 3 行（改）\n第 3 行（再加）\n");
    expect(sh(dir, "diff", "--cached", "--name-only")).toBe("");
  });

  it("hunk 变过（header 对不上）时拒绝，不改任何东西", async () => {
    const dir = await fresh();
    await editOneHunk(dir);
    const hunks = textHunks(await getFileDiff(dir, TEXT, "unstaged"));
    const stale = ref(hunks, 0, [at(hunks[0], "add", "插入的一行")]);
    await put(dir, TEXT, `前\n前\n${await readFile(path.join(dir, TEXT), "utf8")}`);
    await expect(stageLines(dir, TEXT, stale)).rejects.toThrow(/changed since/);
    expect(sh(dir, "diff", "--cached", "--name-only")).toBe("");
  });

  it("CRLF 文件：暂存的字节里仍是 \\r\\n，不会混进 LF", async () => {
    const dir = await fresh();
    sh(dir, "config", "core.autocrlf", "false");
    await put(dir, "crlf 文件.txt", "一\r\n二\r\n三\r\n四\r\n");
    sh(dir, "add", "-A");
    sh(dir, "commit", "-m", "crlf");
    await put(dir, "crlf 文件.txt", "一\r\n二\r\n新插\r\n三\r\n四\r\n");
    const hunks = textHunks(await getFileDiff(dir, "crlf 文件.txt", "unstaged"));
    await stageLines(dir, "crlf 文件.txt", ref(hunks, 0, [at(hunks[0], "add", "新插\r")]));
    // sh 会去掉输出末尾的换行，所以把改动放在中间检查。
    const blob = sh(dir, "show", ":crlf 文件.txt").replaceAll("\r", "<CR>");
    expect(blob).toBe("一<CR>\n二<CR>\n新插<CR>\n三<CR>\n四");
  });

  it("文件末尾没有换行：选中整处改动可以暂存，只选一半被拒绝", async () => {
    const dir = await fresh();
    await put(dir, "尾部.txt", "one\ntwo");
    sh(dir, "add", "-A");
    sh(dir, "commit", "-m", "tail");
    await put(dir, "尾部.txt", "one\ntwo changed");
    const hunks = textHunks(await getFileDiff(dir, "尾部.txt", "unstaged"));
    const hunk = hunks[0];
    await expect(stageLines(dir, "尾部.txt", ref(hunks, 0, [at(hunk, "add", "two changed")]))).rejects.toThrow(
      /newline/,
    );

    await stageLines(dir, "尾部.txt", ref(hunks, 0, [at(hunk, "del", "two"), at(hunk, "add", "two changed")]));
    expect(sh(dir, "show", ":尾部.txt")).toBe("one\ntwo changed");
    expect(sh(dir, "status", "--porcelain", "--", "尾部.txt")).toBe("M  尾部.txt");
  });

  it("未跟踪文件没有 hunk，不能按行暂存", async () => {
    const dir = await fresh();
    await put(dir, "新 文件.txt", "a\nb\n");
    await expect(stageLines(dir, "新 文件.txt", { index: 0, header: "@@ -0,0 +1,2 @@", lines: [0] })).rejects.toThrow(
      /untracked/,
    );
  });

  it("忽略空白（-w）只影响显示：空白改动在 -w 的 diff 里消失，hunk 操作仍用完整 diff", async () => {
    const dir = await fresh();
    const lines = FORTY_LINES.split("\n");
    lines[2] = "  第 3 行"; // 只加了缩进
    lines[8] = "第 9 行（真改）";
    await put(dir, TEXT, lines.join("\n"));

    const plain = textHunks(await getFileDiff(dir, TEXT, "unstaged"));
    const ignoring = textHunks(await getFileDiff(dir, TEXT, "unstaged", "hunks", true));
    expect(plain).toHaveLength(1); // 两处改动之间只隔 5 行，合成一个 hunk
    expect(plain[0]?.lines.some((line) => line.text === "  第 3 行")).toBe(true);
    expect(ignoring.flatMap((h) => h.lines).some((line) => line.text === "  第 3 行")).toBe(false);
    expect(ignoring.flatMap((h) => h.lines).some((line) => line.text === "第 9 行（真改）")).toBe(true);

    // 用不带 -w 的 diff 暂存 hunk 里的行：缩进那一行照样能选。
    await stageLines(dir, TEXT, ref(plain, 0, [at(plain[0], "add", "  第 3 行"), at(plain[0], "del", "第 3 行")]));
    expect(sh(dir, "diff", "--cached", "--numstat", "--", TEXT)).toBe(`1\t1\t${TEXT}`);
  });
});
