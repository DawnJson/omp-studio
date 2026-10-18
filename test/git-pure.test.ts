import { describe, expect, it } from "vitest";
import { formatReviewComments, type ReviewComment } from "../src/shared/git.ts";
import { parseStatusV2 } from "../src/main/git/status.ts";

const c = (
  file: string,
  startLine: number,
  endLine: number,
  body: string,
  side: "old" | "new" = "new",
): ReviewComment => ({
  file,
  startLine,
  endLine,
  side,
  body,
});

describe("formatReviewComments", () => {
  it("一条消息：文件:行范围，单行不写范围；按文件首次出现顺序分组、文件内按行号排序；多行正文续行缩进", () => {
    const text = formatReviewComments(
      [
        c("src/b 文件.ts", 30, 30, "后面的"),
        c("calc.js", 12, 16, "把 mul 改名\n并更新调用处"),
        c("src/b 文件.ts", 2, 4, "前面的", "old"),
      ],
      "zh-CN",
    );
    expect(text).toBe(
      [
        "请按下面的评审意见修改代码：",
        "",
        "1. src/b 文件.ts:2-4（旧版本的行）",
        "   前面的",
        "",
        "2. src/b 文件.ts:30",
        "   后面的",
        "",
        "3. calc.js:12-16",
        "   把 mul 改名",
        "   并更新调用处",
      ].join("\n"),
    );
  });

  it("英文标题；没有评论时抛错", () => {
    expect(formatReviewComments([c("a.ts", 1, 1, "x", "old")], "en")).toBe(
      "Please address these review comments:\n\n1. a.ts:1 (old version lines)\n   x",
    );
    expect(() => formatReviewComments([], "en")).toThrow();
  });
});

describe("parseStatusV2", () => {
  it("分支头、重命名（原路径在下一段）、冲突、含空格的路径", () => {
    const text = [
      "# branch.oid abc",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1",
      "1 .M N... 100644 100644 100644 h1 h2 带 空格/文件.txt",
      "2 R. N... 100644 100644 100644 h1 h2 R100 新 名.txt",
      "旧 名.txt",
      "u UU N... 100644 100644 100644 100644 h1 h2 h3 冲突.txt",
      "? 未跟踪.txt",
      "",
    ].join("\0");
    const { branch, files } = parseStatusV2(text);
    expect(branch).toEqual({ head: "main", oid: "abc", upstream: "origin/main", ahead: 2, behind: 1 });
    expect(files).toEqual([
      { path: "带 空格/文件.txt", oldPath: null, staged: null, unstaged: "modified" },
      { path: "新 名.txt", oldPath: "旧 名.txt", staged: "renamed", unstaged: null },
      { path: "冲突.txt", oldPath: null, staged: "conflicted", unstaged: "conflicted" },
      { path: "未跟踪.txt", oldPath: null, staged: null, unstaged: "untracked" },
    ]);
  });
});
