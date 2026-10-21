import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_DIR_ENTRIES, listDirectory } from "../src/main/files/list-directory.ts";

let work = "";
let root = "";

beforeEach(async () => {
  // 带空格和中文：路径可能是任何样子。
  work = await mkdtemp(path.join(tmpdir(), "omp 文件树 "));
  root = path.join(work, "项目 目录");
  await mkdir(root);
});
afterEach(async () => {
  await rm(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

const names = (listing: { entries: { name: string }[] }) => listing.entries.map((entry) => entry.name);

describe("listDirectory：排序和忽略", () => {
  it("目录在前、文件在后，同类按名字排序（数字按数值，不区分大小写）", async () => {
    for (const dir of ["zeta", "alpha", "Beta"]) await mkdir(path.join(root, dir));
    for (const file of ["b10.txt", "b2.txt", "A.md", "中文.txt"]) await writeFile(path.join(root, file), "");
    const listing = await listDirectory(root, "");
    expect(names(listing)).toEqual(["alpha", "Beta", "zeta", "A.md", "b2.txt", "b10.txt", "中文.txt"]);
    expect(listing.entries.filter((entry) => entry.kind === "dir")).toHaveLength(3);
    expect(listing.truncated).toBe(false);
  });

  it("不列 .git，其他点文件照列；子目录用相对路径列", async () => {
    await mkdir(path.join(root, ".git"));
    await writeFile(path.join(root, ".env"), "");
    await mkdir(path.join(root, "src", "deep"), { recursive: true });
    await writeFile(path.join(root, "src", "a.ts"), "");
    expect(names(await listDirectory(root, ""))).toEqual(["src", ".env"]);
    expect(names(await listDirectory(root, "src"))).toEqual(["deep", "a.ts"]);
    expect(names(await listDirectory(root, path.join("src", "deep")))).toEqual([]);
  });

  it("目录不存在、或是个文件：返回空列表，不抛错；根不存在同理", async () => {
    await writeFile(path.join(root, "f.txt"), "");
    expect((await listDirectory(root, "nope")).entries).toEqual([]);
    expect((await listDirectory(root, "f.txt")).entries).toEqual([]);
    expect((await listDirectory(path.join(work, "missing"), "")).entries).toEqual([]);
  });

  it("一层上千项整层返回；超过上限时只留排序靠前的并标 truncated", async () => {
    expect(MAX_DIR_ENTRIES).toBeGreaterThanOrEqual(5000);
    await Promise.all(Array.from({ length: 1500 }, (_, i) => writeFile(path.join(root, `f${i}.txt`), "")));
    const all = await listDirectory(root, "");
    expect(all.entries).toHaveLength(1500);
    expect(all.entries[0]?.name).toBe("f0.txt");
    expect(all.entries[1499]?.name).toBe("f1499.txt");
    expect(all.truncated).toBe(false);
    const cut = await listDirectory(root, "", 3);
    expect(names(cut)).toEqual(["f0.txt", "f1.txt", "f2.txt"]);
    expect(cut.truncated).toBe(true);
  });
});

describe("listDirectory：.gitignore", () => {
  it("仓库里被忽略的条目带 ignored 标记（不隐藏），不在仓库里时没有标记", async () => {
    await writeFile(path.join(root, "a.ts"), "");
    await writeFile(path.join(root, "debug.log"), "");
    await mkdir(path.join(root, "dist"));
    await writeFile(path.join(root, "dist", "out.js"), "");
    await writeFile(path.join(root, ".gitignore"), "*.log\ndist/\n");
    expect((await listDirectory(root, "")).entries.every((entry) => !entry.ignored)).toBe(true);
    execFileSync("git", ["init", "-q"], { cwd: root });
    const listing = await listDirectory(root, "");
    const ignored = Object.fromEntries(listing.entries.map((entry) => [entry.name, entry.ignored]));
    expect(ignored).toEqual({ dist: true, ".gitignore": false, "a.ts": false, "debug.log": true });
    // 被忽略目录里面的条目也都是忽略的。
    expect((await listDirectory(root, "dist")).entries).toEqual([{ name: "out.js", kind: "file", ignored: true }]);
  });
});

describe("listDirectory：越界和符号链接", () => {
  it("绝对路径、盘符、.. 越界、空字符都拒绝", async () => {
    await expect(listDirectory(root, "..")).rejects.toThrow();
    await expect(listDirectory(root, path.join("a", "..", "..", "x"))).rejects.toThrow();
    await expect(listDirectory(root, work)).rejects.toThrow();
    await expect(listDirectory(root, "C:\\Windows")).rejects.toThrow();
    await expect(listDirectory(root, "\\\\server\\share")).rejects.toThrow();
    await expect(listDirectory(root, "a\0b")).rejects.toThrow();
  });

  it("指到根外的符号链接：不列出，也不能当目录展开；指到根内的照常列", async () => {
    const outside = path.join(work, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.txt"), "");
    await mkdir(path.join(root, "real"));
    await writeFile(path.join(root, "real", "ok.txt"), "");
    let linked = true;
    await symlink(outside, path.join(root, "escape"), "junction").catch(() => (linked = false));
    await symlink(path.join(root, "real"), path.join(root, "inner"), "junction").catch(() => (linked = false));
    // 没有创建符号链接的权限时这条用例没有意义。
    if (!linked) return;
    const listing = await listDirectory(root, "");
    expect(names(listing)).toEqual(["inner", "real"]);
    expect(names(await listDirectory(root, "inner"))).toEqual(["ok.txt"]);
    await expect(listDirectory(root, "escape")).rejects.toThrow("escapes");
  });

  it("断链不列出", async () => {
    await symlink(path.join(work, "gone"), path.join(root, "dangling"), "junction").catch(() => {});
    await writeFile(path.join(root, "x.txt"), "");
    expect(names(await listDirectory(root, ""))).toEqual(["x.txt"]);
  });
});
