// 防的是：工具步骤的展示数据解析错位——diff 的增删数、hunk 间隔、grep 的命中/文件数、CRLF 输出把行号或内容弄错。
import { describe, expect, it } from "vitest";
import {
  askViews,
  bashStatus,
  bodyLineCount,
  buildBody,
  buildInfo,
  diffStats,
  filePaths,
  globPaths,
  headerTarget,
  parseDiff,
  parseGrep,
  splitGutter,
  splitPath,
  todoPhases,
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

  // omp 实际发的格式（取自真实会话里编辑 .mdx 的结果）：`<符号><行号>|<原文>`，空行是跳过的部分，原文可以以 `- ` / `+ ` 开头。
  const mdx = [
    " 7|",
    " 8|- 完整备份与恢复：配置 → 「本地存储」新增导出",
    "-9|- 余额显示：左侧栏底部显示余额",
    "+9|- 余额显示：左侧栏底部显示余额（两位小数）",
    " 10|- 品牌与推广",
    "",
    " 46|+ [新增] 完整备份与恢复",
    "-47|+ [调整] 生图工作台",
    "+47|+ [调整] 生图工作台（停止）",
    " 60|",
  ].join("\n");

  it("omp 的 `行号|原文` 格式：原文不带 `|`，空行上下文保留，以 `- ` 开头的原文不被吃掉", () => {
    const rows = parseDiff(mdx);
    expect(rows[0]).toEqual({ kind: "ctx", oldNo: 7, newNo: 7, text: "" });
    expect(rows[1]).toEqual({ kind: "ctx", oldNo: 8, newNo: 8, text: "- 完整备份与恢复：配置 → 「本地存储」新增导出" });
    expect(rows[2]).toMatchObject({ kind: "del", oldNo: 9, text: "- 余额显示：左侧栏底部显示余额" });
    expect(rows[3]).toMatchObject({ kind: "add", newNo: 9, text: "- 余额显示：左侧栏底部显示余额（两位小数）" });
    expect(rows.filter((row) => row.kind !== "gap").every((row) => !row.text.startsWith("|"))).toBe(true);
    expect(diffStats(rows)).toEqual({ added: 2, removed: 2 });
  });

  it("omp 的 `行号|原文` 格式：空行是跳过的部分，按行号算间隔；CRLF 输入结果相同", () => {
    const rows = parseDiff(mdx);
    expect(rows.filter((row) => row.kind === "gap")).toEqual([{ kind: "gap", count: 35 }]);
    expect(parseDiff(mdx.replaceAll("\n", "\r\n"))).toEqual(rows);
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

  it("edit 有 diff：头部显示 +a −d；正文行数按行算（空输出为 0）", () => {
    const edit = buildBody("edit", {}, { details: { diff: unified } }, "ok");
    expect(buildInfo("edit", {}, edit)).toEqual({ kind: "diff", added: 2, removed: 1 });
    expect(bodyLineCount(edit)).toBeGreaterThan(0);
    expect(bodyLineCount(buildBody("bash", { command: "echo 1" }, null, "1\n"))).toBe(1);
    expect(bodyLineCount(buildBody("read", { path: "a" }, null, ""))).toBe(0);
  });

  it("filePaths：read 多文件 / 单文件带选择器 / hashline 编辑", () => {
    expect(filePaths("read", { path: "a.ts,b/c.ts" })).toEqual(["a.ts", "b/c.ts"]);
    expect(filePaths("read", { path: "a.ts:1-5,10-20" })).toEqual(["a.ts"]);
    expect(filePaths("read", { paths: ["x.md:3-", "y.md"] })).toEqual(["x.md", "y.md"]);
    expect(filePaths("edit", { input: "[src/a.ts#1A2B]\nPUT 1:\n+x\n[src/b.ts#3C4D]\n" })).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
    expect(filePaths("bash", { command: "ls" })).toEqual([]);
    expect(filePaths("read", { path: "proc://" })).toEqual([]);
    expect(filePaths("read", { path: "history://ReadBeta" })).toEqual([]);
    expect(filePaths("read", { path: "C:/work/a.md" })).toEqual(["C:/work/a.md"]);
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

describe("专用工具的结果", () => {
  it("bash：退出码和耗时来自 details，没有就是 null", () => {
    expect(bashStatus({ details: { exitCode: 1, wallTimeMs: 82.2 } })).toEqual({ exitCode: 1, wallMs: 82.2 });
    expect(bashStatus({ details: {} })).toEqual({ exitCode: null, wallMs: null });
    expect(bashStatus(undefined)).toEqual({ exitCode: null, wallMs: null });
  });

  it("glob：每行一个路径才当文件列表；其他工具和像句子的输出不是", () => {
    expect(globPaths("glob", "calc/ops.py\r\ncalc/text.py\n")).toEqual(["calc/ops.py", "calc/text.py"]);
    expect(globPaths("find", "a.ts")).toEqual(["a.ts"]);
    expect(globPaths("grep", "a.ts")).toEqual([]);
    expect(globPaths("glob", "# 3 files\na.ts")).toEqual([]);
    expect(globPaths("glob", "")).toEqual([]);
  });

  it("splitPath：目录（含斜杠）和文件名，Windows 反斜杠也认", () => {
    expect(splitPath("src/a/b.ts")).toEqual(["src/a/", "b.ts"]);
    expect(splitPath("C:\\work\\a.md")).toEqual(["C:\\work\\", "a.md"]);
    expect(splitPath("a.md")).toEqual(["", "a.md"]);
  });

  it("todo：只留有任务且状态合法的项，没有阶段返回 null", () => {
    const phases = todoPhases({
      details: {
        phases: [
          {
            name: "Fix",
            tasks: [
              { content: "a", status: "completed" },
              { content: "b", status: "weird" },
            ],
          },
          { name: "Empty", tasks: [] },
          { name: "Run", tasks: [{ content: "c", status: "blocked", blocker: "ci" }] },
        ],
      },
    });
    expect(phases).toEqual([
      { name: "Fix", tasks: [{ content: "a", status: "completed" }] },
      { name: "Run", tasks: [{ content: "c", status: "blocked", blocker: "ci" }] },
    ]);
    expect(todoPhases({ details: { phases: [] } })).toBeNull();
    expect(todoPhases(undefined)).toBeNull();
  });

  it("ask：回答在 details（单题 / 多题 results），没有回答时退回参数里的问题", () => {
    const args = {
      questions: [{ question: "语言？", options: [{ label: "Go", description: "快" }, { label: "Rust" }] }],
    };
    expect(
      askViews(args, { details: { question: "语言？", options: ["Go", "Rust"], selectedOptions: ["Go"] } }),
    ).toEqual([
      {
        question: "语言？",
        options: [
          { label: "Go", description: "快" },
          { label: "Rust", description: null },
        ],
        selected: ["Go"],
        custom: null,
        note: null,
      },
    ]);
    const multi = askViews(
      {},
      {
        details: {
          results: [
            { id: "a", question: "Q1", options: ["x", "y"], selectedOptions: [], customInput: "自己写的" },
            { id: "b", question: "Q2", options: ["z"], selectedOptions: ["z"], note: "n" },
          ],
        },
      },
    );
    expect(multi.map((view) => [view.question, view.selected, view.custom, view.note])).toEqual([
      ["Q1", [], "自己写的", null],
      ["Q2", ["z"], null, "n"],
    ]);
    const pending = askViews(args, undefined);
    expect(pending[0]?.selected).toEqual([]);
    expect(pending[0]?.options.map((option) => option.label)).toEqual(["Go", "Rust"]);
  });
});
