import { describe, expect, it } from "vitest";
import type { DirListing } from "../src/shared/ipc.ts";
import { flattenTree, treeKeyAction } from "../src/renderer/src/features/file-preview/tree-model.ts";

const entry = (name: string, kind: "dir" | "file", ignored = false) => ({ name, kind, ignored });
const listings = new Map<string, DirListing>([
  ["", { entries: [entry("src", "dir"), entry("dist", "dir", true), entry("a.md", "file")], truncated: false }],
  ["src", { entries: [entry("deep", "dir"), entry("b.ts", "file")], truncated: true }],
  ["src/deep", { entries: [entry("c.ts", "file")], truncated: false }],
]);

describe("flattenTree：展开的目录子项紧跟在后面", () => {
  it("全部收起：只有根这一层", () => {
    const rows = flattenTree(listings, new Set());
    expect(rows.map((row) => row.path)).toEqual(["src", "dist", "a.md"]);
  });

  it("嵌套展开带深度；被截断的层末尾有提示行；还没加载的展开目录暂时没有子项", () => {
    const rows = flattenTree(listings, new Set(["src", "src/deep", "dist"]));
    expect(rows.map((row) => `${row.type === "node" ? row.depth : "t"}:${row.path.replace("\0", "|")}`)).toEqual([
      "0:src",
      "1:src/deep",
      "2:src/deep/c.ts",
      "1:src/b.ts",
      "t:src|truncated",
      "0:dist",
      "0:a.md",
    ]);
    const dist = rows.find((row) => row.path === "dist");
    expect(dist?.type === "node" && dist.expanded && dist.ignored).toBe(true);
  });
});

describe("treeKeyAction：键盘导航", () => {
  const rows = flattenTree(listings, new Set(["src"]));
  // src, src/deep, src/b.ts, (truncated), dist, a.md
  it("没有光标时 ↓ 落在第一项，↑ 也不越界", () => {
    expect(treeKeyAction(rows, null, "ArrowDown")).toEqual({ type: "move", path: "src" });
    expect(treeKeyAction(rows, "src", "ArrowUp")).toEqual({ type: "move", path: "src" });
    expect(treeKeyAction(rows, "a.md", "ArrowDown")).toEqual({ type: "move", path: "a.md" });
  });

  it("↓ 跳过提示行", () => {
    expect(treeKeyAction(rows, "src/b.ts", "ArrowDown")).toEqual({ type: "move", path: "dist" });
  });

  it("→：收起的目录展开；已展开的进入第一个子项；文件无动作", () => {
    expect(treeKeyAction(rows, "dist", "ArrowRight")).toEqual({ type: "expand", path: "dist" });
    expect(treeKeyAction(rows, "src", "ArrowRight")).toEqual({ type: "move", path: "src/deep" });
    expect(treeKeyAction(rows, "a.md", "ArrowRight")).toBeNull();
  });

  it("←：已展开的目录收起；否则回到父目录；根层的项无动作", () => {
    expect(treeKeyAction(rows, "src", "ArrowLeft")).toEqual({ type: "collapse", path: "src" });
    expect(treeKeyAction(rows, "src/b.ts", "ArrowLeft")).toEqual({ type: "move", path: "src" });
    expect(treeKeyAction(rows, "a.md", "ArrowLeft")).toBeNull();
  });

  it("Enter / 空格：文件打开，目录展开收起；Home / End", () => {
    expect(treeKeyAction(rows, "a.md", "Enter")).toEqual({ type: "open", path: "a.md" });
    expect(treeKeyAction(rows, "src", " ")).toEqual({ type: "collapse", path: "src" });
    expect(treeKeyAction(rows, "dist", "Enter")).toEqual({ type: "expand", path: "dist" });
    expect(treeKeyAction(rows, null, "Enter")).toBeNull();
    expect(treeKeyAction(rows, "dist", "Home")).toEqual({ type: "move", path: "src" });
    expect(treeKeyAction(rows, "src", "End")).toEqual({ type: "move", path: "a.md" });
  });

  it("空树没有动作", () => {
    expect(treeKeyAction([], null, "ArrowDown")).toBeNull();
  });
});
