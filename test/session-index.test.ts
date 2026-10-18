// 防的失败：历史列表里会话丢失、标题错乱，或者一个损坏文件让整个列表打不开。
// 数据全部造在临时目录里（路径含空格和中文），不读真实的 ~/.omp。
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Project, ProjectId, TaskId } from "../src/shared/ipc.ts";
import { parseSessionPrefix, resolveAgentDir, SessionIndex } from "../src/main/history/session-index.ts";
import { buildSessionSummaries } from "../src/main/history/session-summaries.ts";

/** 和 omp 一样：标题槽补空格到 255 字节再换行，共 256 字节。 */
function titleSlot(title: string): string {
  const line = JSON.stringify({ type: "title", v: 1, title, source: "auto", updatedAt: "2026-10-18T00:00:00.000Z", pad: "" });
  const missing = 255 - Buffer.byteLength(line);
  return `${line.slice(0, -2)}${" ".repeat(missing)}"}\n`;
}

const header = (id: string, cwd: string, extra: Record<string, unknown> = {}) =>
  `${JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-10-18T00:00:00.000Z", cwd, ...extra })}\n`;

const userMessage = (content: unknown) =>
  `${JSON.stringify({ type: "message", id: "a1b2c3d4", parentId: null, message: { role: "user", content } })}\n`;

let root: string;
let bucket: string;
let index: SessionIndex;
const projectCwd = "E:\\研究 项目\\my app";

async function writeSession(name: string, content: string, mtime?: Date): Promise<string> {
  const file = path.join(bucket, name);
  await writeFile(file, content, "utf8");
  if (mtime) await utimes(file, mtime, mtime);
  return file;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "omp 会话 测试-"));
  bucket = path.join(root, "agent dir", "sessions", "--E--研究 项目-my app--");
  await mkdir(bucket, { recursive: true });
  index = new SessionIndex(path.join(root, "agent dir", "sessions"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("parseSessionPrefix", () => {
  it("标题槽的标题优先于头里的标题，并取第一条用户消息的首行", () => {
    const text = titleSlot("槽里的标题") + header("s1", projectCwd, { title: "头里的标题" }) + userMessage([{ type: "text", text: "  第一行  \n第二行" }]);
    expect(parseSessionPrefix(text, false)).toEqual({ id: "s1", cwd: projectCwd, title: "槽里的标题", firstPrompt: "第一行" });
  });

  it("旧版文件没有标题槽；用户消息内容是字符串也认", () => {
    const text = header("s2", projectCwd, { title: "旧标题" }) + userMessage("hello\r\nworld");
    expect(parseSessionPrefix(text, false)).toEqual({ id: "s2", cwd: projectCwd, title: "旧标题", firstPrompt: "hello" });
  });

  it("前缀被截断时丢掉最后一行，不把半行当损坏", () => {
    const text = header("s3", projectCwd) + userMessage("完整") + '{"type":"message","message":{"role":"user","content":"被截';
    expect(parseSessionPrefix(text, true)?.firstPrompt).toBe("完整");
  });

  it.each([
    ["空文件", ""],
    ["头之前是垃圾", "not json\n" + header("x", projectCwd)],
    ["第一条不是会话头", `${JSON.stringify({ type: "message" })}\n`],
    ["头缺 cwd", `${JSON.stringify({ type: "session", id: "x" })}\n`],
    ["头缺 id", `${JSON.stringify({ type: "session", cwd: projectCwd })}\n`],
  ])("%s → null", (_name, text) => {
    expect(parseSessionPrefix(text, false)).toBeNull();
  });

  it("头之后出现损坏行只跳过那一行", () => {
    const text = header("s4", projectCwd) + "{坏了\n" + userMessage("还能找到");
    expect(parseSessionPrefix(text, false)?.firstPrompt).toBe("还能找到");
  });
});

describe("SessionIndex.scan", () => {
  it("目录不存在时返回空列表", async () => {
    const empty = new SessionIndex(path.join(root, "不存在 的目录"));
    expect(await empty.scan()).toEqual({ sessions: [], skipped: 0 });
  });

  it("路径含空格和中文也能读到，头里的 cwd 原样保留，按修改时间从新到旧", async () => {
    const older = await writeSession("2026-10-17_old.jsonl", titleSlot("旧会话") + header("old", projectCwd), new Date("2026-10-17T00:00:00Z"));
    const newer = await writeSession("2026-10-18_new.jsonl", header("new", projectCwd) + userMessage("新问题"), new Date("2026-10-18T00:00:00Z"));
    const { sessions, skipped } = await index.scan();
    expect(skipped).toBe(0);
    expect(sessions.map((s) => [s.id, s.file, s.cwd, s.title, s.firstPrompt])).toEqual([
      ["new", newer, projectCwd, null, "新问题"],
      ["old", older, projectCwd, "旧会话", null],
    ]);
  });

  it("损坏文件、非会话文件、空文件被跳过并计数，其余会话照常列出", async () => {
    await writeSession("good.jsonl", header("good", projectCwd) + userMessage("ok"));
    await writeSession("garbage.jsonl", "\u0000\u0001 不是 json\n");
    await writeSession("empty.jsonl", "");
    await writeSession("other.jsonl", `${JSON.stringify({ hello: "world" })}\n`);
    await writeSession("note.txt", "不是 jsonl，直接忽略，不计数");
    await mkdir(path.join(bucket, "good"), { recursive: true });
    await writeFile(path.join(bucket, "good", "artifact.jsonl"), header("nested", projectCwd), "utf8");
    const { sessions, skipped } = await index.scan();
    expect(sessions.map((s) => s.id)).toEqual(["good"]);
    expect(skipped).toBe(3);
  });

  it("首条用户消息超过前缀（比如带图片）且没有标题时，放宽读取仍能找到", async () => {
    const big = userMessage([{ type: "image", data: "A".repeat(100 * 1024) }, { type: "text", text: "看图" }]);
    await writeSession("big.jsonl", header("big", projectCwd) + big);
    const { sessions } = await index.scan();
    expect(sessions[0]?.firstPrompt).toBe("看图");
  });

  it("文件变化后重新读取，被删除的文件从列表消失", async () => {
    const file = await writeSession("a.jsonl", header("a", projectCwd) + userMessage("v1"), new Date("2026-10-17T00:00:00Z"));
    expect((await index.scan()).sessions[0]?.firstPrompt).toBe("v1");
    await writeFile(file, header("a", projectCwd) + userMessage("版本二"), "utf8");
    await utimes(file, new Date("2026-10-18T00:00:00Z"), new Date("2026-10-18T00:00:00Z"));
    expect((await index.scan()).sessions[0]?.firstPrompt).toBe("版本二");
    await rm(file);
    expect(await index.scan()).toEqual({ sessions: [], skipped: 0 });
  });

  it("findById 按头里的 id 找，找不到返回 null", async () => {
    await writeSession("a.jsonl", header("the-id", projectCwd) + userMessage("x"));
    expect((await index.findById("the-id"))?.cwd).toBe(projectCwd);
    expect(await index.findById("nope")).toBeNull();
  });
});

describe("buildSessionSummaries", () => {
  const projectA: Project = { id: "pa" as ProjectId, path: projectCwd, name: "my app" };
  const projectB: Project = { id: "pb" as ProjectId, path: "E:\\其它", name: "其它" };
  const sessions = [
    { id: "s1", file: "C:\\x y\\s1.jsonl", cwd: projectCwd, title: "一", firstPrompt: null, modifiedAt: 3, size: 1 },
    { id: "s2", file: "C:\\x y\\s2.jsonl", cwd: "E:\\未加入 的目录", title: null, firstPrompt: "二", modifiedAt: 2, size: 1 },
    { id: "s3", file: "C:\\x y\\s3.jsonl", cwd: projectCwd, title: null, firstPrompt: null, modifiedAt: 1, size: 1 },
  ];
  const links = [{ id: "t1" as TaskId, sessionFile: "C:\\x y\\s1.jsonl" }, { id: "t2" as TaskId, sessionFile: null }];

  it("全部项目：未加入项目的会话 projectId 为 null，已挂任务的带 taskId，空壳会话不列出", () => {
    const result = buildSessionSummaries(sessions, [projectA, projectB], links, null);
    expect(result.map((s) => [s.id, s.projectId, s.taskId])).toEqual([
      ["s1", "pa", "t1"],
      ["s2", null, null],
    ]);
  });

  it("按项目过滤只留 cwd 相同的会话；项目不存在时为空", () => {
    expect(buildSessionSummaries(sessions, [projectA, projectB], links, "pb" as ProjectId)).toEqual([]);
    expect(buildSessionSummaries(sessions, [projectA], links, "pa" as ProjectId).map((s) => s.id)).toEqual(["s1"]);
    expect(buildSessionSummaries(sessions, [projectA], links, "missing" as ProjectId)).toEqual([]);
  });

  it.runIf(process.platform === "win32")("Windows 上路径大小写和斜杠方向不影响匹配", () => {
    const result = buildSessionSummaries(
      [{ ...sessions[0]!, cwd: projectCwd.toLowerCase().replaceAll("\\", "/"), file: "c:/x y/S1.jsonl" }],
      [projectA],
      links,
      null,
    );
    expect(result[0]).toMatchObject({ projectId: "pa", taskId: "t1" });
  });
});

describe("resolveAgentDir", () => {
  it("PI_CODING_AGENT_DIR 优先；否则 home 下的 .omp/agent，PI_CONFIG_DIR 可改目录名", () => {
    expect(resolveAgentDir({ PI_CODING_AGENT_DIR: path.join(root, "自定义 目录") }, "H")).toBe(path.join(root, "自定义 目录"));
    expect(resolveAgentDir({}, "H")).toBe(path.join("H", ".omp", "agent"));
    expect(resolveAgentDir({ PI_CONFIG_DIR: ".omp-dev" }, "H")).toBe(path.join("H", ".omp-dev", "agent"));
  });
});
