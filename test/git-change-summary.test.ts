import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getGitChangeSummary, mergeChanges, parseNumstatZ, untrackedLineStat } from "../src/main/git/change-summary.ts";
import type { GitChangeEntry } from "../src/shared/git.ts";
import { makeRepo, makeScratch, put, sh } from "./git-helpers.ts";

const byPath = (files: GitChangeEntry[]) => [...files].sort((a, b) => a.path.localeCompare(b.path));

async function files(cwd: string): Promise<GitChangeEntry[]> {
  const summary = await getGitChangeSummary(cwd);
  if (summary.kind !== "ok") throw new Error(`expected a repo, got ${summary.kind}`);
  return byPath(summary.files);
}

describe("parseNumstatZ", () => {
  it("普通文件、二进制（- -）、重命名（空路径后跟旧/新路径）", () => {
    const text = ["3\t1\ta 文件.txt", "-\t-\tbin.dat", "0\t0\t", "old.txt", "new.txt", "5\t0\tz.txt", ""].join("\0");
    expect(parseNumstatZ(text)).toEqual([
      { path: "a 文件.txt", oldPath: null, added: 3, removed: 1 },
      { path: "bin.dat", oldPath: null, added: null, removed: null },
      { path: "new.txt", oldPath: "old.txt", added: 0, removed: 0 },
      { path: "z.txt", oldPath: null, added: 5, removed: 0 },
    ]);
  });

  it("空输出没有改动", () => {
    expect(parseNumstatZ("")).toEqual([]);
  });
});

describe("untrackedLineStat / mergeChanges", () => {
  it("文本全是新增行，结尾没有换行也算一行；二进制没有行数", () => {
    expect(untrackedLineStat(Buffer.from("a\nb\n"))).toEqual({ added: 2, removed: 0 });
    expect(untrackedLineStat(Buffer.from("a\nb"))).toEqual({ added: 2, removed: 0 });
    expect(untrackedLineStat(Buffer.alloc(0))).toEqual({ added: 0, removed: 0 });
    expect(untrackedLineStat(Buffer.from([1, 0, 2]))).toEqual({ added: null, removed: null });
  });

  it("已跟踪的在前，未跟踪的在后，同一路径只出现一次", () => {
    const merged = mergeChanges(
      [{ path: "a.txt", oldPath: null, added: 1, removed: 1 }],
      [
        { path: "b.txt", added: 4, removed: 0 },
        { path: "a.txt", added: 9, removed: 0 },
      ],
    );
    expect(merged.map((entry) => [entry.path, entry.added])).toEqual([
      ["a.txt", 1],
      ["b.txt", 4],
    ]);
  });
});

describe("getGitChangeSummary（真实仓库）", () => {
  let scratch: string;
  beforeAll(async () => {
    scratch = await makeScratch("change-summary");
  });
  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it("没有改动时是空列表", async () => {
    const repo = await makeRepo(scratch, "clean");
    expect(await files(repo)).toEqual([]);
  });

  it("修改、新增（未跟踪和已暂存）、删除、二进制，行数相对 HEAD 且中文/空格路径原样", async () => {
    const repo = await makeRepo(scratch, "mixed");
    await put(repo, "a.txt", "alpha\nBETA\ngamma\n");
    await put(repo, "新 文件.txt", "x\ny\n");
    await put(repo, "staged.txt", "one\ntwo\nthree\n");
    sh(repo, "add", "staged.txt");
    await rm(path.join(repo, "src 目录", "文件 一.txt"));
    await put(repo, "bin.dat", Buffer.from([9, 0, 9, 0]));
    await put(repo, "new.bin", Buffer.from([0, 0, 1]));
    expect(await files(repo)).toEqual(
      byPath([
        { path: "a.txt", oldPath: null, added: 2, removed: 1 },
        { path: "新 文件.txt", oldPath: null, added: 2, removed: 0 },
        { path: "staged.txt", oldPath: null, added: 3, removed: 0 },
        { path: "src 目录/文件 一.txt", oldPath: null, added: 0, removed: 40 },
        { path: "bin.dat", oldPath: null, added: null, removed: null },
        { path: "new.bin", oldPath: null, added: null, removed: null },
      ]),
    );
  });

  it("暂存的重命名带原路径；暂存后又在工作区改动，行数合并算到 HEAD", async () => {
    const repo = await makeRepo(scratch, "rename");
    await mkdir(path.join(repo, "moved"), { recursive: true });
    sh(repo, "mv", "a.txt", "moved/a.txt");
    await put(repo, "moved/a.txt", "alpha\nbeta\ngamma\n");
    expect(await files(repo)).toEqual([{ path: "moved/a.txt", oldPath: "a.txt", added: 1, removed: 0 }]);
  });

  it("还没有任何提交的仓库：已暂存和未跟踪的文件都列出", async () => {
    const repo = path.join(scratch, "unborn");
    await mkdir(repo, { recursive: true });
    sh(repo, "init", "-b", "main");
    await put(repo, "s.txt", "1\n2\n");
    sh(repo, "add", "s.txt");
    await put(repo, "u.txt", "1\n");
    expect(await files(repo)).toEqual([
      { path: "s.txt", oldPath: null, added: 2, removed: 0 },
      { path: "u.txt", oldPath: null, added: 1, removed: 0 },
    ]);
  });

  it("不是 git 仓库是类型化结果，不抛错", async () => {
    const plain = path.join(scratch, "plain");
    await mkdir(plain, { recursive: true });
    expect(await getGitChangeSummary(plain)).toEqual({ kind: "not_git" });
  });
});
