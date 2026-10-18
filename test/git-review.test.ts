import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GIT_DIFF_MAX_BYTES, toSideBySide, type GitDiffHunk, type GitFileDiff } from "../src/shared/git.ts";
import {
  checkRepoPath,
  discardFile,
  discardHunk,
  getFileDiff,
  stageFile,
  stageHunk,
  unstageFile,
  unstageHunk,
} from "../src/main/git/review.ts";
import { getGitStatus } from "../src/main/git/status.ts";
import { FORTY_LINES, makeRepo, makeScratch, put, sh } from "./git-helpers.ts";

/** 状态的短格式，用 -z 避免 git 给带空格的名字加引号。 */
const short = (dir: string) => sh(dir, "status", "--porcelain", "-z").split("\0").filter(Boolean).join("\n");

let scratch: string;
let n = 0;
beforeAll(async () => {
  scratch = await makeScratch("review");
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const TEXT = "src 目录/文件 一.txt";
/** 每个用例一个新仓库，互不影响。 */
const fresh = () => makeRepo(scratch, `仓库 ${++n}`);

/** 改第 3 行和第 35 行：相隔够远，是两个 hunk。 */
async function editTwoPlaces(dir: string) {
  const lines = FORTY_LINES.split("\n");
  lines[2] = "第 3 行（改）";
  lines[34] = "第 35 行（改）";
  await put(dir, TEXT, lines.join("\n"));
}

function textHunks(diff: GitFileDiff): GitDiffHunk[] {
  if (diff.kind !== "text") throw new Error(`expected a text diff, got ${diff.kind}`);
  return diff.hunks;
}

const refOf = (hunks: GitDiffHunk[], index: number) => ({ index, header: hunks[index]?.header ?? "" });

describe("git status", () => {
  it("暂存、未暂存、未跟踪、删除、重命名都能分出来；路径含空格和中文原样返回", async () => {
    const dir = await fresh();
    await put(dir, TEXT, `${FORTY_LINES}新增\n`); // 未暂存修改
    await put(dir, "新文件 二.txt", "x\n");
    sh(dir, "add", "新文件 二.txt"); // 暂存的新增
    await put(dir, "未跟踪 目录/深 层/三.txt", "y\n"); // 未跟踪，目录展开成文件
    await rm(path.join(dir, "bin.dat")); // 未暂存删除
    sh(dir, "mv", "a.txt", "改名 后.txt"); // 暂存的重命名

    const status = await getGitStatus(dir);
    if (status.kind !== "ok") throw new Error(status.kind);
    expect(status.branch).toMatchObject({ head: "main", upstream: null, ahead: 0, behind: 0 });
    const byPath = Object.fromEntries(status.files.map((file) => [file.path, file]));
    expect(byPath[TEXT]).toMatchObject({ staged: null, unstaged: "modified" });
    expect(byPath["新文件 二.txt"]).toMatchObject({ staged: "added", unstaged: null });
    expect(byPath["未跟踪 目录/深 层/三.txt"]).toMatchObject({ staged: null, unstaged: "untracked" });
    expect(byPath["bin.dat"]).toMatchObject({ staged: null, unstaged: "deleted" });
    expect(byPath["改名 后.txt"]).toMatchObject({ staged: "renamed", oldPath: "a.txt" });
    expect(status.files).toHaveLength(5);
  });

  it("不在仓库里是 not_git 状态，不抛错", async () => {
    expect(await getGitStatus(scratch)).toEqual({ kind: "not_git" });
  });

  it("新仓库没有提交也能取状态（分支 oid 为 null）", async () => {
    const dir = path.join(scratch, "空 仓库");
    sh(scratch, "init", "-b", "main", dir);
    await put(dir, "x.txt", "x\n");
    const status = await getGitStatus(dir);
    expect(status).toMatchObject({ kind: "ok", branch: { head: "main", oid: null } });
  });
});

describe("git diff 解析", () => {
  it("两个 hunk，新旧行号正确，中文内容按 UTF-8 解码，并排视图把删除和新增配对", async () => {
    const dir = await fresh();
    await editTwoPlaces(dir);
    const diff = await getFileDiff(dir, TEXT, "unstaged");
    const hunks = textHunks(diff);
    expect(hunks).toHaveLength(2);
    expect(diff).toMatchObject({ added: 2, removed: 2 });

    const [first, second] = hunks as [GitDiffHunk, GitDiffHunk];
    expect(first).toMatchObject({ oldStart: 1, newStart: 1 });
    const del = first.lines.find((line) => line.kind === "del");
    const add = first.lines.find((line) => line.kind === "add");
    expect(del).toEqual({ kind: "del", oldNo: 3, newNo: null, text: "第 3 行" });
    expect(add).toEqual({ kind: "add", oldNo: null, newNo: 3, text: "第 3 行（改）" });
    expect(first.lines[0]).toEqual({ kind: "context", oldNo: 1, newNo: 1, text: "第 1 行" });
    expect(second.lines.find((line) => line.kind === "add")?.newNo).toBe(35);

    const rows = toSideBySide(first);
    const changed = rows.find((row) => row.left?.kind === "del");
    expect(changed?.left?.text).toBe("第 3 行");
    expect(changed?.right?.text).toBe("第 3 行（改）");
    expect(rows.filter((row) => row.left && row.right && row.left === row.right).length).toBe(
      first.lines.filter((line) => line.kind === "context").length,
    );
  });

  it("文件末尾没有换行：noEol 标出，暂存这个 hunk 后文件内容仍然一致", async () => {
    const dir = await fresh();
    await put(dir, "尾部.txt", "one\ntwo");
    sh(dir, "add", "-A");
    sh(dir, "commit", "-m", "无结尾换行");
    await put(dir, "尾部.txt", "one\ntwo changed");
    const hunks = textHunks(await getFileDiff(dir, "尾部.txt", "unstaged"));
    expect(hunks[0]?.lines.filter((line) => line.noEol)).toHaveLength(2);
    await stageHunk(dir, "尾部.txt", refOf(hunks, 0));
    expect(sh(dir, "diff", "--cached", "--stat")).toContain("尾部.txt");
    expect(short(dir)).toBe("M  尾部.txt");
  });

  it("已暂存一侧：重命名带原路径，diff 取的是 HEAD 到暂存区", async () => {
    const dir = await fresh();
    sh(dir, "mv", "a.txt", "改名 后.txt");
    await put(dir, "改名 后.txt", "alpha\nbeta\ngamma\n");
    sh(dir, "add", "-A");
    const hunks = textHunks(await getFileDiff(dir, "改名 后.txt", "staged"));
    expect(hunks[0]?.lines.filter((line) => line.kind === "add").map((line) => line.text)).toEqual(["gamma"]);
  });

  it("未跟踪文件：整个文件是一个新增 hunk；二进制和过大的文件有各自的 kind", async () => {
    const dir = await fresh();
    await put(dir, "新 文件.txt", "一\n二\n");
    await put(dir, "新.bin", Buffer.from([1, 0, 2]));
    await put(dir, "大.txt", "x".repeat(GIT_DIFF_MAX_BYTES + 1));
    const hunks = textHunks(await getFileDiff(dir, "新 文件.txt", "untracked"));
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({ header: "@@ -0,0 +1,2 @@", newStart: 1, newLines: 2 });
    expect(hunks[0]?.lines.map((line) => [line.newNo, line.text])).toEqual([
      [1, "一"],
      [2, "二"],
    ]);
    expect(await getFileDiff(dir, "新.bin", "untracked")).toEqual({ kind: "binary" });
    expect(await getFileDiff(dir, "大.txt", "untracked")).toEqual({ kind: "too_large" });
  });

  it("已跟踪的二进制文件改动是 binary；过大的 diff 是 too_large", async () => {
    const dir = await fresh();
    await put(dir, "bin.dat", Buffer.from([0, 9, 9, 9]));
    expect(await getFileDiff(dir, "bin.dat", "unstaged")).toEqual({ kind: "binary" });

    const huge = Array.from({ length: 120_000 }, (_, i) => `行 ${i} ${"y".repeat(20)}`).join("\n");
    await put(dir, "巨大.txt", huge);
    sh(dir, "add", "巨大.txt");
    sh(dir, "commit", "-m", "big");
    await put(dir, "巨大.txt", huge.replaceAll("y", "z"));
    expect(await getFileDiff(dir, "巨大.txt", "unstaged")).toEqual({ kind: "too_large" });
  });
});

describe("暂存和丢弃", () => {
  it("只暂存第二个 hunk：暂存区里只有它，未暂存里只剩第一个；再取消暂存回到原样", async () => {
    const dir = await fresh();
    await editTwoPlaces(dir);
    const hunks = textHunks(await getFileDiff(dir, TEXT, "unstaged"));
    await stageHunk(dir, TEXT, refOf(hunks, 1));

    const staged = textHunks(await getFileDiff(dir, TEXT, "staged"));
    expect(staged).toHaveLength(1);
    expect(staged[0]?.lines.find((line) => line.kind === "add")?.text).toBe("第 35 行（改）");
    const rest = textHunks(await getFileDiff(dir, TEXT, "unstaged"));
    expect(rest).toHaveLength(1);
    expect(rest[0]?.lines.find((line) => line.kind === "add")?.text).toBe("第 3 行（改）");

    await unstageHunk(dir, TEXT, refOf(staged, 0));
    expect(textHunks(await getFileDiff(dir, TEXT, "unstaged"))).toHaveLength(2);
    expect(sh(dir, "diff", "--cached", "--name-only")).toBe("");
  });

  it("丢弃第一个 hunk：磁盘上只还原那一处，另一处改动还在", async () => {
    const dir = await fresh();
    await editTwoPlaces(dir);
    const hunks = textHunks(await getFileDiff(dir, TEXT, "unstaged"));
    await discardHunk(dir, TEXT, refOf(hunks, 0));
    const content = await readFile(path.join(dir, TEXT), "utf8");
    expect(content).toContain("第 3 行\n");
    expect(content).not.toContain("第 3 行（改）");
    expect(content).toContain("第 35 行（改）");
  });

  it("diff 在两次调用之间变了：拒绝，不会改错地方", async () => {
    const dir = await fresh();
    await editTwoPlaces(dir);
    const hunks = textHunks(await getFileDiff(dir, TEXT, "unstaged"));
    const stale = refOf(hunks, 1);
    // 文件头部多了 5 行，第二个 hunk 的位置变了。
    await put(dir, TEXT, `前\n前\n前\n前\n前\n${await readFile(path.join(dir, TEXT), "utf8")}`);
    await expect(stageHunk(dir, TEXT, stale)).rejects.toThrow(/changed since/);
    await expect(stageHunk(dir, TEXT, { index: 9, header: "@@ -1 +1 @@" })).rejects.toThrow();
  });

  it("整文件暂存和取消暂存（含新文件、删除）", async () => {
    const dir = await fresh();
    await put(dir, "新 文件.txt", "n\n");
    await rm(path.join(dir, "a.txt"));
    await stageFile(dir, "新 文件.txt");
    await stageFile(dir, "a.txt");
    expect(short(dir)).toBe("D  a.txt\nA  新 文件.txt");
    await unstageFile(dir, "新 文件.txt");
    await unstageFile(dir, "a.txt");
    expect(short(dir)).toBe(" D a.txt\n?? 新 文件.txt");
  });

  it("丢弃文件：已跟踪的退回 HEAD（暂存的和没暂存的一起）、暂存的新文件被移除、未跟踪的被删除", async () => {
    const dir = await fresh();
    await put(dir, "a.txt", "changed\n");
    sh(dir, "add", "a.txt");
    await put(dir, "a.txt", "changed again\n");
    await put(dir, "新.txt", "n\n");
    sh(dir, "add", "新.txt");
    await put(dir, "野 文件.txt", "u\n");

    await discardFile(dir, "a.txt");
    await discardFile(dir, "新.txt");
    await discardFile(dir, "野 文件.txt");
    expect(await readFile(path.join(dir, "a.txt"), "utf8")).toBe("alpha\nbeta\n");
    expect(short(dir)).toBe("");
    await expect(stat(path.join(dir, "野 文件.txt"))).rejects.toThrow();
  });

  it("丢弃重命名：原文件回来，新名字消失", async () => {
    const dir = await fresh();
    sh(dir, "mv", "a.txt", "改名 后.txt");
    await discardFile(dir, "改名 后.txt");
    expect(short(dir)).toBe("");
    expect(await readFile(path.join(dir, "a.txt"), "utf8")).toBe("alpha\nbeta\n");
  });

  it("文件名里的 [ ] 不会被当成通配符（Windows 文件名不能含 *）", async () => {
    const dir = await fresh();
    await put(dir, "a[0].txt", "1\n");
    await put(dir, "a0.txt", "2\n");
    await stageFile(dir, "a[0].txt");
    expect(short(dir)).toBe("A  a[0].txt\n?? a0.txt");
  });
});

describe("路径校验", () => {
  it("越界、绝对路径、.git 内部都拒绝", async () => {
    const dir = await fresh();
    for (const bad of ["../x.txt", "a/../../x", path.join(dir, "a.txt"), "C:/x", ".git/config", ".git", ""])
      expect(() => checkRepoPath(dir, bad), bad).toThrow();
    expect(checkRepoPath(dir, "src 目录/文件 一.txt")).toBe("src 目录/文件 一.txt");
    await expect(getFileDiff(dir, "../x", "unstaged")).rejects.toThrow();
    await expect(discardFile(dir, ".git/config")).rejects.toThrow();
  });

  it("没有改动的路径不能被丢弃（防止拿 discard 删任意已跟踪文件以外的东西）", async () => {
    const dir = await fresh();
    await expect(discardFile(dir, "a.txt")).rejects.toThrow(/no changes/);
  });
});
