// TSP 子代理的记录读取（src/main/tsp/subagent-file.ts）：路径在会话目录之内、坏行跳过、文件缺失给 unavailable 而不是抛错。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseSubagentMessages, readSubagentRecord, subagentPaths } from "../src/main/tsp/subagent-file.ts";

let scratch: string;
let sessionFile: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio-subagent-file-"));
  sessionFile = path.join(scratch, "2026-10-21T18-21-04-239Z_01a15fb2.jsonl");
  const dir = path.join(scratch, "2026-10-21T18-21-04-239Z_01a15fb2");
  await mkdir(dir);
  const lines = [
    JSON.stringify({ type: "session", id: "x" }),
    JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "run sleep" }] } }),
    "{broken",
    JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "DONE" }] } }),
    '{"type":"message","message":{"role":"assista', // 写到一半的最后一行
  ];
  await writeFile(path.join(dir, "Beta.jsonl"), lines.join("\n"));
  await writeFile(path.join(dir, "Beta.md"), "DONE\n");
  await writeFile(path.join(dir, "Alpha.jsonl"), lines[1] ?? "");
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("subagentPaths", () => {
  it("会话文件去掉 .jsonl 就是子代理目录", () => {
    const paths = subagentPaths(sessionFile, "Beta");
    expect(paths?.jsonl).toBe(path.join(scratch, "2026-10-21T18-21-04-239Z_01a15fb2", "Beta.jsonl"));
    expect(paths?.md).toBe(path.join(scratch, "2026-10-21T18-21-04-239Z_01a15fb2", "Beta.md"));
    expect(subagentPaths(sessionFile, "Outer-3.Inner")?.jsonl.endsWith("Outer-3.Inner.jsonl")).toBe(true);
  });

  it("名字带路径、不是 .jsonl 的会话文件：null", () => {
    for (const bad of ["../Beta", "a/b", "a\\b", "..", ""]) expect(subagentPaths(sessionFile, bad)).toBeNull();
    expect(subagentPaths(path.join(scratch, "session.txt"), "Beta")).toBeNull();
  });
});

describe("parseSubagentMessages", () => {
  it("只取 message 行，坏行和写到一半的行跳过", () => {
    const messages = parseSubagentMessages(
      ['{"type":"session"}', '{"type":"message","message":{"role":"user"}}', "{x", '{"type":"message","mess'].join(
        "\n",
      ),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: "user" });
  });
});

describe("readSubagentRecord", () => {
  it("读到消息和最终输出", async () => {
    const record = await readSubagentRecord(sessionFile, "Beta");
    expect(record.unavailable).toBeNull();
    expect(record.messages?.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(record.output).toBe("DONE\n");
    expect(record.truncated).toBe(false);
  });

  it("还在跑的子代理没有 .md：messages 有、output 为 null、不报错", async () => {
    const record = await readSubagentRecord(sessionFile, "Alpha");
    expect(record.messages).toHaveLength(1);
    expect(record.output).toBeNull();
    expect(record.unavailable).toBeNull();
  });

  it("没有会话文件、没有这个子代理、名字非法：unavailable + 原因，不抛错", async () => {
    expect((await readSubagentRecord(null, "Beta")).unavailable).toBe("no_session");
    expect((await readSubagentRecord(sessionFile, "Gamma")).unavailable).toBe("no_file");
    const bad = await readSubagentRecord(sessionFile, "../x");
    expect(bad.unavailable).toBe("error");
    expect(bad.error).toContain("invalid subagent name");
  });
});
