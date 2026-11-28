// 提示词优化的可选轻量上下文（src/main/prompt-enhance/context.ts）：最近对话摘要 + Git 改动文件路径。
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildEnhanceContext,
  formatChangedFiles,
  readChangedFiles,
  readRecentTurns,
} from "../src/main/prompt-enhance/context.ts";

function jsonl(entries: readonly Record<string, unknown>[]): string {
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

let tmp: string;
let seq = 0;

async function writeSession(entries: readonly Record<string, unknown>[]): Promise<string> {
  const file = path.join(tmp, `session-${++seq}.jsonl`);
  await writeFile(file, jsonl(entries), "utf8");
  return file;
}

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "omp-enhance-ctx-"));
});
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe("readRecentTurns", () => {
  it("沿当前分支 parentId 只取最近 2 轮，跳过工具结果、agent 注入消息、被分叉放弃的支路与思考块", async () => {
    const file = await writeSession([
      { type: "session", id: "s1" },
      { type: "message", id: "u1", parentId: null, message: { role: "user", content: "第 1 轮问题" } },
      { type: "message", id: "a1", parentId: "u1", message: { role: "assistant", content: "第 1 轮回答" } },
      // 另一条旧分支（不是最后一个条目的祖先）
      { type: "message", id: "u-dead", parentId: "a1", message: { role: "user", content: "被放弃的分支" } },
      { type: "message", id: "u2", parentId: "a1", message: { role: "user", content: "第 2 轮问题" } },
      {
        type: "message",
        id: "sys",
        parentId: "u2",
        message: { role: "user", attribution: "agent", content: "内部注入" },
      },
      { type: "message", id: "tool", parentId: "sys", message: { role: "toolResult", content: "巨长工具输出" } },
      {
        type: "message",
        id: "a2-mid",
        parentId: "tool",
        message: { role: "assistant", content: [{ type: "text", text: "中间过渡话" }] },
      },
      {
        type: "message",
        id: "a2",
        parentId: "a2-mid",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "secret" },
            { type: "text", text: "<think>内部思考</think>第 2 轮结论在 enhance.ts" },
          ],
        },
      },
      { type: "message", id: "u3", parentId: "a2", message: { role: "user", content: "第 3 轮问题" } },
      { type: "message", id: "a3", parentId: "u3", message: { role: "assistant", content: "第 3 轮结论" } },
    ]);

    const result = await readRecentTurns(file);
    expect(result).toBe(
      "User: 第 2 轮问题\nAssistant: 第 2 轮结论在 enhance.ts\nUser: 第 3 轮问题\nAssistant: 第 3 轮结论",
    );
    expect(result).not.toContain("第 1 轮");
    expect(result).not.toContain("被放弃的分支");
    expect(result).not.toContain("巨长工具输出");
    expect(result).not.toContain("内部注入");
    expect(result).not.toContain("内部思考");
    expect(result).not.toContain("中间过渡话");
  });

  it("压缩长代码块并截断超长正文", async () => {
    const bigCode = `\`\`\`ts\n${"const x = 1;\n".repeat(40)}\`\`\``;
    const file = await writeSession([
      { type: "message", id: "u1", parentId: null, message: { role: "user", content: "x".repeat(500) } },
      { type: "message", id: "a1", parentId: "u1", message: { role: "assistant", content: `看代码：\n${bigCode}` } },
    ]);
    const result = (await readRecentTurns(file))!;
    expect(result).toContain("[code block]");
    expect(result.length).toBeLessThanOrEqual(800);
  });

  it("空会话或缺失文件返回 null", async () => {
    const empty = await writeSession([{ type: "session", id: "s1" }]);
    expect(await readRecentTurns(empty)).toBeNull();
    expect(await readRecentTurns(null)).toBeNull();
    expect(await readRecentTurns(path.join(tmp, "missing.jsonl"))).toBeNull();
  });
});

describe("formatChangedFiles", () => {
  it("格式化状态码与路径，超出上限截断并标注剩余数量", () => {
    expect(formatChangedFiles([])).toBeNull();
    expect(
      formatChangedFiles([
        { path: "src/a.ts", oldPath: null, staged: null, unstaged: "modified" },
        { path: "src/b.ts", oldPath: null, staged: "added", unstaged: null },
        { path: "src/c.ts", oldPath: null, staged: null, unstaged: "untracked" },
      ]),
    ).toBe("M src/a.ts\nA src/b.ts\n? src/c.ts");

    const many = Array.from({ length: 35 }, (_, i) => ({
      path: `src/f-${i}.ts`,
      oldPath: null,
      staged: null,
      unstaged: "modified" as const,
    }));
    const formatted = formatChangedFiles(many)!;
    expect(formatted).toContain("... (+5 more)");
  });
});

describe("文件与 Git 集成", () => {
  it("非 git 目录静默返回 null；真实会话文件与临时 git 仓库按开关并行采集", async () => {
    expect(await readChangedFiles(tmp)).toBeNull();

    const sessionFile = await writeSession([
      { type: "message", id: "u1", parentId: null, message: { role: "user", content: "看看登录" } },
      { type: "message", id: "a1", parentId: "u1", message: { role: "assistant", content: "在 login.ts" } },
    ]);
    const repo = path.join(tmp, "repo");
    execFileSync("git", ["init", repo], { stdio: "ignore" });
    await writeFile(path.join(repo, "hello.ts"), "export const a = 1;\n", "utf8");

    const both = await buildEnhanceContext({ sessionFile, cwd: repo, includeHistory: true, includeGit: true });
    expect(both.history).toBe("User: 看看登录\nAssistant: 在 login.ts");
    expect(both.gitFiles).toBe("? hello.ts");

    const off = await buildEnhanceContext({ sessionFile, cwd: repo, includeHistory: false, includeGit: false });
    expect(off).toEqual({ history: null, gitFiles: null });
  });
});
