import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_INDEXED_FILES,
  MAX_RESULTS,
  ProjectFileIndex,
  indexFiles,
  matchProjectFiles,
  parseFileQuery,
  walkFiles,
} from "../src/main/files/project-files.ts";

describe("parseFileQuery：查询词形状校验", () => {
  it("相对路径放行，反斜杠统一成 /", () => {
    expect(parseFileQuery("")).toBe("");
    expect(parseFileQuery("src/ma")).toBe("src/ma");
    expect(parseFileQuery("src\\ma")).toBe("src/ma");
  });
  it("绝对路径、盘符、.. 越界、空字符、超长、非字符串都拒绝", () => {
    expect(() => parseFileQuery("/etc/passwd")).toThrow();
    expect(() => parseFileQuery("C:\\Windows")).toThrow();
    expect(() => parseFileQuery("\\\\server\\share")).toThrow();
    expect(() => parseFileQuery("../secret")).toThrow();
    expect(() => parseFileQuery("a/../../b")).toThrow();
    expect(() => parseFileQuery("a\0b")).toThrow();
    expect(() => parseFileQuery("x".repeat(257))).toThrow();
    expect(() => parseFileQuery(42)).toThrow();
  });
});

describe("matchProjectFiles：匹配和排序", () => {
  const files = indexFiles([
    "src/main/index.ts",
    "src/renderer/App.tsx",
    "README.md",
    "docs/design/spec.md",
    "src/a/b/readme-notes.md",
  ]);
  it("文件名前缀排在路径包含之前，不区分大小写", () => {
    expect(matchProjectFiles(files, "readme")).toEqual(["README.md", "src/a/b/readme-notes.md"]);
    expect(matchProjectFiles(files, "SPEC")).toEqual(["docs/design/spec.md"]);
  });
  it("路径前缀、目录子串、子序列都能匹配；不匹配返回空", () => {
    expect(matchProjectFiles(files, "src/ren")[0]).toBe("src/renderer/App.tsx");
    expect(matchProjectFiles(files, "design")).toEqual(["docs/design/spec.md"]);
    expect(matchProjectFiles(files, "smi")).toContain("src/main/index.ts");
    expect(matchProjectFiles(files, "zzz")).toEqual([]);
  });
  it("空查询按层级浅的在前，条数不超过上限", () => {
    expect(matchProjectFiles(files, "")[0]).toBe("README.md");
    const many = indexFiles(Array.from({ length: 100 }, (_, i) => `f${i}.ts`));
    expect(matchProjectFiles(many, "f")).toHaveLength(MAX_RESULTS);
    expect(matchProjectFiles(many, "f", 5)).toHaveLength(5);
  });
  it("只留前 limit 条时的顺序和全部排好后截取的一致", () => {
    const mixed = indexFiles(
      Array.from({ length: 300 }, (_, i) => `${"d/".repeat((i * 7) % 4)}${i % 3 ? "x" : "file"}${(i * 37) % 300}.ts`),
    );
    const all = matchProjectFiles(mixed, "f", mixed.length);
    for (const limit of [1, 5, 20, 299]) expect(matchProjectFiles(mixed, "f", limit)).toEqual(all.slice(0, limit));
  });
});

describe("ProjectFileIndex：缓存和上限", () => {
  it("索引条数截到 MAX_INDEXED_FILES，返回条数不超过 MAX_RESULTS，不含绝对路径", async () => {
    const index = new ProjectFileIndex(async () =>
      Array.from({ length: MAX_INDEXED_FILES + 500 }, (_, i) => `dir/file${i}.ts`),
    );
    expect(await index.list("/proj")).toHaveLength(MAX_INDEXED_FILES);
    const found = await index.search("/proj", "file");
    expect(found).toHaveLength(MAX_RESULTS);
    expect(found.every((file) => !path.isAbsolute(file) && !file.includes(":"))).toBe(true);
  });
  it("缓存期内同一目录只加载一次，过期后重新加载，加载失败不留缓存", async () => {
    let loads = 0;
    let now = 0;
    let fail = true;
    const index = new ProjectFileIndex(
      async () => {
        loads += 1;
        if (fail) throw new Error("boom");
        return ["a.ts"];
      },
      () => now,
    );
    await expect(index.list("/p")).rejects.toThrow("boom");
    fail = false;
    expect((await index.list("/p")).map((file) => file.path)).toEqual(["a.ts"]);
    await index.list("/p");
    expect(loads).toBe(2);
    now = 60_000;
    await index.list("/p");
    expect(loads).toBe(3);
  });
});

describe("walkFiles：没有 git 时的遍历", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });
  it("跳过 node_modules 和 .git、不收含空白的路径、不跟随符号链接、尊重上限，只给相对路径", async () => {
    root = await mkdtemp(path.join(tmpdir(), "files-walk-"));
    await mkdir(path.join(root, "src"));
    await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await mkdir(path.join(root, ".git"));
    await writeFile(path.join(root, "a.ts"), "");
    await writeFile(path.join(root, "my file.ts"), "");
    await writeFile(path.join(root, "src", "b.ts"), "");
    await writeFile(path.join(root, "node_modules", "pkg", "x.js"), "");
    await writeFile(path.join(root, ".git", "HEAD"), "");
    const outside = await mkdtemp(path.join(tmpdir(), "files-outside-"));
    await writeFile(path.join(outside, "secret.txt"), "");
    await symlink(outside, path.join(root, "link"), "junction").catch(() => {});
    try {
      const files = await walkFiles(root);
      expect(files.sort()).toEqual(["a.ts", "src/b.ts"]);
      expect(await walkFiles(root, 1)).toHaveLength(1);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
