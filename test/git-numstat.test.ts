// 防的失败：评审文件树的 `+a −d` 和 diff 里的数不一致（重命名、二进制、未跟踪文件、无结尾换行的数错）、
// "文件"视图拿到的不是整个文件连成的一个 hunk、"改动块"视图的上下文被改大而让 hunk 级暂存对不上 header。
import { rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countLines, getChangeStats, parseNumstat } from "../src/main/git/numstat.ts";
import { getFileDiff } from "../src/main/git/review.ts";
import { FORTY_LINES, makeRepo, makeScratch, put, sh } from "./git-helpers.ts";

let scratch: string;
let n = 0;
beforeAll(async () => {
  scratch = await makeScratch("numstat");
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const fresh = () => makeRepo(scratch, `仓库 ${++n}`);
const TEXT = "src 目录/文件 一.txt";

describe("parseNumstat", () => {
  it("reads plain entries with spaces and Chinese in the path", () => {
    expect(parseNumstat("3\t1\tsrc 目录/文件 一.txt\0", "unstaged")).toEqual([
      { area: "unstaged", path: "src 目录/文件 一.txt", added: 3, removed: 1 },
    ]);
  });

  it("skips binary entries and takes the new path of a rename", () => {
    const text = ["-\t-\tbin.dat\0", "2\t0\t\0旧 名.txt\0新 名.txt\0", "1\t1\tb.txt\0"].join("");
    expect(parseNumstat(text, "staged")).toEqual([
      { area: "staged", path: "新 名.txt", added: 2, removed: 0 },
      { area: "staged", path: "b.txt", added: 1, removed: 1 },
    ]);
  });

  it("is empty for empty output", () => {
    expect(parseNumstat("", "staged")).toEqual([]);
  });
});

describe("countLines", () => {
  it("counts lines like diffOfNewFile: trailing newline is not an extra line", () => {
    expect(countLines(Buffer.from(""))).toBe(0);
    expect(countLines(Buffer.from("\n"))).toBe(1);
    expect(countLines(Buffer.from("a"))).toBe(1);
    expect(countLines(Buffer.from("a\n"))).toBe(1);
    expect(countLines(Buffer.from("a\nb"))).toBe(2);
    expect(countLines(Buffer.from("a\n\nb\n"))).toBe(3);
    expect(countLines(Buffer.from("\n\n\n"))).toBe(3);
  });

  it("counts CRLF lines by their \\n, with or without a final line break", () => {
    expect(countLines(Buffer.from("a\r\nb\r\n"))).toBe(2);
    expect(countLines(Buffer.from("a\r\nb"))).toBe(2);
    expect(countLines(Buffer.from("a\r\nb\r"))).toBe(2);
  });
});

describe("untracked line count cache", () => {
  const FILE = "缓存 文件.txt";
  const count = async (dir: string) =>
    (await getChangeStats(dir)).find((s) => s.area === "untracked" && s.path === FILE)?.added;

  it("reuses the count while mtime and size match, rereads when either changes", async () => {
    const dir = await fresh();
    const abs = join(dir, FILE);
    await put(dir, FILE, "一\n二\n");
    // 先钉成整秒：文件系统 mtime 比 Date 精细（NTFS 100ns），用 Date 恢复不回原值。
    const mtime = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000);
    const atime = mtime;
    await utimes(abs, atime, mtime);
    expect(await count(dir)).toBe(2);

    // 同样大小（8 字节）、同样 mtime：命中缓存，不重读（这正是缓存要省掉的读）。
    await put(dir, FILE, "a\n\n\n\n\n\n\n");
    await utimes(abs, atime, mtime);
    expect(await count(dir)).toBe(2);

    // 只改 mtime：重读。
    await utimes(abs, atime, new Date(mtime.getTime() + 5000));
    expect(await count(dir)).toBe(7);
    await put(dir, FILE, "一\n二\n三");
    await utimes(abs, atime, new Date(mtime.getTime() + 5000));
    // 只改 size（mtime 和上一次读时一样）：重读。
    expect(await count(dir)).toBe(3);

    // 变成空文件、再变成二进制：各自重读。
    await put(dir, FILE, "");
    expect(await count(dir)).toBe(0);
    await put(dir, FILE, Buffer.from([0x61, 0, 0x0a]));
    expect(await count(dir)).toBeUndefined();
  });
});

describe("getChangeStats / getFileDiff context", () => {
  it("both sides of one file, renames, untracked text; binary has no entry; counts equal the per-file diff", async () => {
    const dir = await fresh();
    const lines = FORTY_LINES.split("\n");
    lines[2] = "第 3 行（改）";
    await put(dir, TEXT, lines.join("\n"));
    sh(dir, "add", TEXT); // 暂存：-1 +1
    await put(dir, TEXT, `${lines.join("\n")}末尾加一行\n`); // 工作区再改：末行
    sh(dir, "mv", "a.txt", "改名 后.txt");
    await put(dir, "新 文件.txt", "一\n二\n三");
    await put(dir, "新.bin", Buffer.from([0, 1, 2]));

    const stats = await getChangeStats(dir);
    const find = (area: string, path: string) => stats.find((s) => s.area === area && s.path === path);
    expect(find("staged", TEXT)).toMatchObject({ added: 1, removed: 1 });
    expect(find("unstaged", TEXT)).toMatchObject({ added: 1, removed: 0 });
    expect(find("staged", "改名 后.txt")).toMatchObject({ added: 0, removed: 0 });
    expect(find("untracked", "新 文件.txt")).toMatchObject({ added: 3, removed: 0 });
    expect(find("untracked", "新.bin")).toBeUndefined();

    for (const area of ["staged", "unstaged"] as const) {
      const diff = await getFileDiff(dir, TEXT, area);
      const stat = find(area, TEXT);
      if (diff.kind !== "text" || !stat) throw new Error("expected text diff and stat");
      expect({ added: stat.added, removed: stat.removed }).toEqual({ added: diff.added, removed: diff.removed });
    }
  });

  it("'file' context joins separate changes into one hunk covering the whole file; 'hunks' keeps them apart", async () => {
    const dir = await fresh();
    const lines = FORTY_LINES.split("\n");
    lines[2] = "第 3 行（改）";
    lines[34] = "第 35 行（改）";
    await put(dir, TEXT, lines.join("\n"));

    const hunks = await getFileDiff(dir, TEXT, "unstaged", "hunks");
    const whole = await getFileDiff(dir, TEXT, "unstaged", "file");
    if (hunks.kind !== "text" || whole.kind !== "text") throw new Error("expected text diffs");
    expect(hunks.hunks).toHaveLength(2);
    expect(whole.hunks).toHaveLength(1);
    expect(whole.hunks[0]?.lines).toHaveLength(40 + 2);
    expect(whole.hunks[0]?.lines[0]).toMatchObject({ kind: "context", oldNo: 1, newNo: 1 });
    expect({ added: whole.added, removed: whole.removed }).toEqual({ added: hunks.added, removed: hunks.removed });
  });
});
