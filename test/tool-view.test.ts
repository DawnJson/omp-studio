// 防的是：工具步骤的展示数据解析错位——diff 的增删数、hunk 间隔、grep 的命中/文件数、CRLF 输出把行号或内容弄错。
import { describe, expect, it } from "vitest";
import {
  buildBody,
  buildInfo,
  defaultOpen,
  diffStats,
  formatElapsed,
  headerTarget,
  parseDiff,
  parseGrep,
  splitGutter,
} from "../src/renderer/src/features/conversation/tool-view.ts";

const unified = [
  "--- a/x.ts",
  "+++ b/x.ts",
  "@@ -2,3 +2,3 @@",
  " keep",
  "-old",
  "+new",
  " tail",
  "@@ -20,2 +20,3 @@",
  " ctx",
  "+added",
  " ctx2",
].join("\n");

describe("parseDiff", () => {
  it("统一 diff：增删数、行号、hunk 之间的间隔行数", () => {
    const rows = parseDiff(unified);
    expect(diffStats(rows)).toEqual({ added: 2, removed: 1 });
    expect(rows.filter((row) => row.kind === "gap")).toEqual([{ kind: "gap", count: 15 }]);
    expect(rows[1]).toMatchObject({ kind: "del", oldNo: 3, newNo: null, text: "old" });
    expect(rows[2]).toMatchObject({ kind: "add", oldNo: null, newNo: 3, text: "new" });
  });

  it("CRLF 输入与 LF 结果相同，文本里不带 \\r", () => {
    const rows = parseDiff(unified.replaceAll("\n", "\r\n"));
    expect(rows).toEqual(parseDiff(unified));
    expect(JSON.stringify(rows)).not.toContain("\\r");
  });

  it("内容以 -- 或 ++ 开头的行不被当成文件头", () => {
    const rows = parseDiff(["@@ -1,2 +1,2 @@", "--- removed dash", "+++ added plus"].join("\n"));
    expect(diffStats(rows)).toEqual({ added: 1, removed: 1 });
  });

  it("omp 带行号的 diff：... 之后按行号算间隔", () => {
    const rows = parseDiff([" 10 a", "-11 b", "+11 c", " ...", " 30 z"].join("\n"));
    expect(diffStats(rows)).toEqual({ added: 1, removed: 1 });
    expect(rows.find((row) => row.kind === "gap")).toEqual({ kind: "gap", count: 18 });
  });
});

describe("parseGrep", () => {
  const text = ["# src/", "## a.ts#AB12", " 47: before", "*48: hit one", "*60: hit two", "## b.ts", "*3: only"].join(
    "\r\n",
  );

  it("文件数、命中数、命中行标记", () => {
    const files = parseGrep(text);
    expect(files?.map((file) => [file.path, file.matches])).toEqual([
      ["src/a.ts", 2],
      ["src/b.ts", 1],
    ]);
    expect(files?.[0]?.rows).toEqual([
      { no: 47, text: "before", match: false },
      { no: 48, text: "hit one", match: true },
      { no: 60, text: "hit two", match: true },
    ]);
  });

  it("认不出文件头就返回 null", () => {
    expect(parseGrep("No matches found")).toBeNull();
  });
});

describe("splitGutter", () => {
  it("每行都带 N: 才拆", () => {
    expect(splitGutter(["1:a", "2:b:c"])).toEqual([
      { no: 1, text: "a" },
      { no: 2, text: "b:c" },
    ]);
    expect(splitGutter(["1:a", "plain"])).toBeNull();
    expect(splitGutter([])).toBeNull();
  });
});

describe("头部与正文汇总", () => {
  it("read 的行范围：参数给 offset/limit，路径自带选择器则原样", () => {
    expect(headerTarget("read", { path: "a.ts", offset: 60, limit: 101 })).toBe("a.ts:60-160");
    expect(headerTarget("read", { path: "a.ts:5-9", offset: 1 })).toBe("a.ts:5-9");
    expect(headerTarget("grep", { pattern: "x", offset: 3 })).toBe("x");
  });

  it("计时格式", () => {
    expect(formatElapsed(52_130)).toBe("52.1s");
    expect(formatElapsed(65_000)).toBe("1m 05s");
    expect(formatElapsed(4_200_000)).toBe("1h 10m");
  });

  it("edit 有 diff：默认展开，头部显示 +a −d；bash 展开；read 不展开", () => {
    const edit = buildBody("edit", {}, { details: { diff: unified } }, "ok");
    expect(buildInfo("edit", {}, edit)).toEqual({ kind: "diff", added: 2, removed: 1 });
    expect(defaultOpen("edit", edit)).toBe(true);
    expect(defaultOpen("bash", buildBody("bash", { command: "echo 1" }, null, "1\n"))).toBe(true);
    expect(defaultOpen("read", buildBody("read", { path: "a" }, null, "text"))).toBe(false);
  });

  it("grep 头部：命中数与文件数；task：代理数与后台", () => {
    const grep = buildBody("grep", {}, null, "## a.ts\n*1: x\n## b.ts\n*2: y\n*3: z");
    expect(buildInfo("grep", {}, grep)).toEqual({ kind: "search", matches: 3, files: 2 });
    const task = buildBody("task", {}, null, "spawned");
    expect(buildInfo("task", { tasks: [{}, {}], async: true }, task)).toEqual({
      kind: "task",
      agents: 2,
      background: true,
    });
  });
});
