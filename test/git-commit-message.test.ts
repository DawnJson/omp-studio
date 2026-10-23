import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generateCommitMessage, parseOmpCommitOutput, type OmpCommand } from "../src/main/git/commit-message.ts";
import { splitCommitMessage } from "../src/shared/git.ts";
import { makeRepo, makeScratch, put, sh } from "./git-helpers.ts";

// omp 18.12.6 `omp commit --dry-run --no-changelog` 的真实 stdout（2026-10-23，DeepSeek V4 Flash，一个文件加一行）。
const REAL_OUTPUT =
  "● Resolving model...\n  └─ DeepSeek V4 Flash\n● Discovering context files...\n  └─ (none found)\n● Starting commit agent...\n" +
  "● I'll start by inspecting the staged changes.\n\uf00c GitOverview\n  ⎿ staged: true\n    └ include_untracked: false\n" +
  "\uf00c ProposeCommit\n  ⎿ type: feat\n    └ summary: added greet function to a.txt\n● Proposed commit:\n\n" +
  "  \x1b[38;2;42;48;56m```\x1b[39m\n    feat: added greet function to a.txt\n\n    Appended a greet function entry to a.txt.\n" +
  "  \x1b[38;2;42;48;56m```\x1b[39m\n\n  \x1b[38;2;0;180;255m- \x1b[39mSingle staged file (\x1b[38;2;0;255;136ma.txt\x1b[39m, +1 line), so no split was needed.\n" +
  "● agent finished (4 messages, 3 tools)\n\nGenerated commit message:\nfeat: added greet function to a.txt\n\n- Appended a greet function entry to a.txt.\n";

describe("parseOmpCommitOutput", () => {
  it("真实输出：取最后一个 Generated commit message 之后的内容，标题和正文分开，不带进度和 ANSI", () => {
    expect(parseOmpCommitOutput(REAL_OUTPUT)).toEqual({
      title: "feat: added greet function to a.txt",
      body: "- Appended a greet function entry to a.txt.",
      split: null,
    });
  });

  it("只有标题、CRLF 换行、中文正文", () => {
    expect(parseOmpCommitOutput("x\r\nGenerated commit message:\r\nfix: 修复\r\n")).toEqual({
      title: "fix: 修复",
      body: "",
      split: null,
    });
    expect(parseOmpCommitOutput("Generated commit message:\nfeat: a\n\n- 一\n- 二\n\n- 三\n")).toEqual({
      title: "feat: a",
      body: "- 一\n- 二\n\n- 三",
      split: null,
    });
  });

  it("拆分建议：取第一个提交的信息，并带上提交个数（Changes: 行不算信息）", () => {
    const out =
      "● x\n\nSplit commit plan (dry run):\nCommit 1:\nfeat: 先做这个\n\n- 第一件事\nChanges: a.txt\nCommit 2:\nfix: 再做那个\nChanges: b c.txt (all)\n";
    expect(parseOmpCommitOutput(out)).toEqual({ title: "feat: 先做这个", body: "- 第一件事", split: 2 });
  });

  it("没有信息（或标记后是空的）返回 null", () => {
    expect(parseOmpCommitOutput("● Resolving model...\nNo changes to commit.\n")).toBeNull();
    expect(parseOmpCommitOutput("Generated commit message:\n\n")).toBeNull();
    expect(parseOmpCommitOutput("")).toBeNull();
  });
});

describe("splitCommitMessage", () => {
  it("第一行是摘要，空行之后是说明；和 composeCommitMessage 互逆", () => {
    expect(splitCommitMessage("标题\n\n第一段\n\n第二段\n")).toEqual({
      summary: "标题",
      description: "第一段\n\n第二段",
    });
    expect(splitCommitMessage("只有标题")).toEqual({ summary: "只有标题", description: "" });
    expect(splitCommitMessage("标题\r\n\r\n正文\r\n")).toEqual({ summary: "标题", description: "正文" });
    expect(splitCommitMessage("")).toEqual({ summary: "", description: "" });
  });
});

let scratch: string;
let n = 0;
beforeAll(async () => {
  scratch = await makeScratch("commit-message");
});
afterAll(async () => {
  // 取消用例里被结束的假 omp 在 Windows 上可能还占着仓库目录一会儿。
  await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const FAKE = path.resolve("test/fake-omp/fake-omp-commit.ts");

async function setup(mode: string, extra: Record<string, string> = {}) {
  const dir = await makeRepo(scratch, `仓库 ${++n}`);
  const home = path.join(scratch, `agent ${n}`);
  const log = path.join(scratch, `calls ${n}.log`);
  const omp: OmpCommand = {
    command: process.execPath,
    args: [FAKE],
    env: { ...process.env, FAKE_COMMIT_MODE: mode, FAKE_COMMIT_LOG: log, PI_CODING_AGENT_DIR: home, ...extra },
  };
  const calls = async () => (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean);
  return { dir, home, omp, calls };
}

describe("generateCommitMessage（假 omp）", () => {
  it("有暂存内容：参数是数组（commit --dry-run --no-changelog，不带 -m），cwd = 仓库根，结果可直接填进提交框", async () => {
    const { dir, omp, calls } = await setup("ok");
    await put(dir, "a.txt", "changed\n");
    sh(dir, "add", "a.txt");
    const before = sh(dir, "status", "--porcelain");

    const result = await generateCommitMessage(dir, omp, new AbortController().signal);
    expect(result).toEqual({
      kind: "generated",
      title: "feat: 假 omp 生成的标题",
      body: "- 第一条说明\n- 第二条说明",
      split: null,
    });
    expect(await calls()).toEqual([`${dir}\tcommit --dry-run --no-changelog`]);
    // 只是预览：暂存区和工作区原样。
    expect(sh(dir, "status", "--porcelain")).toBe(before);
  });

  it("从仓库子目录调用也在仓库根运行", async () => {
    const { dir, omp, calls } = await setup("ok");
    await put(dir, "src 目录/新.txt", "x\n");
    sh(dir, "add", "-A");
    await generateCommitMessage(path.join(dir, "src 目录"), omp, new AbortController().signal);
    expect(await calls()).toEqual([`${dir}\tcommit --dry-run --no-changelog`]);
  });

  it("没有已暂存的改动：不运行 omp（真实的 omp 会自己 git add 全部），只有未暂存 / 未跟踪也一样", async () => {
    const { dir, omp, calls } = await setup("ok");
    expect(await generateCommitMessage(dir, omp, new AbortController().signal)).toEqual({
      kind: "nothing_staged",
    });
    await put(dir, "a.txt", "changed\n");
    await put(dir, "新 文件.txt", "n\n");
    expect(await generateCommitMessage(dir, omp, new AbortController().signal)).toEqual({
      kind: "nothing_staged",
    });
    expect(await calls()).toEqual([]);
    expect(sh(dir, "diff", "--cached", "--name-only")).toBe("");
  });

  it("拆分建议带上个数；没有模型是 no_model；退出码非 0（智能体出错回退）是 failed 且带 omp 的话", async () => {
    for (const [mode, expected] of [
      ["split", { kind: "generated", title: "feat: 先做这个", body: "- 第一件事", split: 2 }],
      ["nomodel", { kind: "no_model" }],
      ["fail", { kind: "failed", message: "Agent error: the model timed out" }],
    ] as const) {
      const { dir, omp } = await setup(mode);
      await put(dir, "a.txt", `${mode}\n`);
      sh(dir, "add", "a.txt");
      expect(await generateCommitMessage(dir, omp, new AbortController().signal)).toEqual(expected);
    }
  });

  it("取消：结束 omp 进程，返回 cancelled", async () => {
    const { dir, omp, calls } = await setup("hang");
    await put(dir, "a.txt", "changed\n");
    sh(dir, "add", "a.txt");
    const controller = new AbortController();
    const running = generateCommitMessage(dir, omp, controller.signal);
    // 等假 omp 真的起来了（它启动时记一行调用）再取消，而不是猜一个时长。
    await vi.waitFor(async () => expect(await calls()).toHaveLength(1), { timeout: 15_000 });
    controller.abort();
    expect(await running).toEqual({ kind: "cancelled" });
  });
});
