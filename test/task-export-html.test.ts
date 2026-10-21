// 导出 HTML：runner 经 RPC export_html 把对话写到主进程给的绝对路径（真实 omp 实测：照写给定路径、缺的目录会建、
// 不补扩展名、不传路径时写进 cwd 的 omp-session-*.html、相对路径按 omp 的 cwd 解析，所以主进程必须自己给绝对路径）。
// 另测默认文件名的清理函数。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { StudioSettings, TaskId, TaskState } from "../src/shared/ipc.ts";
import { exportFileName, sanitizeFileStem } from "../src/main/tasks/export-name.ts";
import { TaskPool } from "../src/main/tasks/task-pool.ts";
import { TaskRegistry } from "../src/main/tasks/task-registry.ts";

const root = path.resolve(import.meta.dirname, "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-omp.ts");
let scratch: string;
let projectDir: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio export-"));
  projectDir = path.join(scratch, "项目");
  await mkdir(projectDir);
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const settings: StudioSettings = {
  locale: "zh-CN",
  theme: "system",
  maxLiveProcesses: 6,
  reduceMotion: false,
  enterWhileRunning: "steer",
  notifyOnGate: true,
  copyOnSelect: true,
  taskEngine: "rpc",
  yoloConfirmed: false,
};

type Entry = Record<string, unknown>;
interface RecordedLine extends Entry {
  frame?: { type?: string };
}

/** 握手部分取 simple-reply 录制里 prompt 之前的条目，后面接这条测试自己的往返。 */
async function fixtureWith(tail: Entry[]): Promise<string> {
  const lines = (await readFile(path.join(root, "fixtures", "rpc", "simple-reply.ndjson"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line): RecordedLine => JSON.parse(line));
  const promptAt = lines.findIndex((entry) => entry.frame?.type === "prompt");
  const file = path.join(await mkdtemp(path.join(scratch, "fx-")), "export.ndjson");
  const entries = [...lines.slice(0, promptAt), ...tail];
  await writeFile(file, entries.map((entry) => JSON.stringify(entry)).join("\n"));
  return file;
}

const response = (id: string, extra: Entry): Entry => ({
  kind: "out",
  frame: { id, type: "response", command: "export_html", ...extra },
});

const pools: TaskPool[] = [];
async function start(fixture: string): Promise<{ pool: TaskPool; id: TaskId; inputLog: string }> {
  const inputLog = path.join(path.dirname(fixture), "input.log");
  const states: TaskState[] = [];
  const pool = new TaskPool({
    registry: new TaskRegistry(path.join(path.dirname(fixture), "tasks.json")),
    getSettings: async () => settings,
    buildLaunch: async (_record, project) => ({
      command: process.execPath,
      args: [fakeOmp, fixture, inputLog],
      cwd: project.path,
      env: process.env,
    }),
    assignJob: () => {},
    events: {
      state: (state) => states.push(state),
      transcript: () => {},
      notice: () => {},
      taskRemoved: () => {},
      slashCommands: () => {},
      subagents: () => {},
    },
  });
  pools.push(pool);
  await pool.init();
  const project = await pool.ensureProject(projectDir);
  const created = await pool.createTask({ projectId: project.id });
  await vi.waitFor(() => expect(states.findLast((s) => s.id === created.id)?.status).toBe("idle"), { timeout: 15_000 });
  return { pool, id: created.id, inputLog };
}
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.shutdown()));
});

const sentFrames = async (inputLog: string): Promise<{ type: string; outputPath?: string }[]> =>
  (await readFile(inputLog, "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

describe("exportTaskHtml：发 RPC export_html，写到给定的绝对路径", () => {
  it("把 outputPath 原样发给 omp，返回 omp 应答里的路径", async () => {
    const target = path.join(scratch, "别处", "对话 一.html");
    const fixture = await fixtureWith([
      { kind: "in", frame: { type: "export_html", outputPath: target, id: "e1" } },
      response("e1", { success: true, data: { path: target } }),
    ]);
    const { pool, id, inputLog } = await start(fixture);
    await expect(pool.exportTaskHtml(id, target)).resolves.toBe(target);
    expect((await sentFrames(inputLog)).find((frame) => frame.type === "export_html")?.outputPath).toBe(target);
  });

  it("omp 拒绝（失败应答）时抛出 omp 的错误", async () => {
    const target = path.join(scratch, "x.html");
    const fixture = await fixtureWith([
      { kind: "in", frame: { type: "export_html", outputPath: target, id: "e1" } },
      response("e1", { success: false, error: "disk full" }),
    ]);
    const { pool, id } = await start(fixture);
    await expect(pool.exportTaskHtml(id, target)).rejects.toThrow(/disk full/);
  });

  it("相对路径不发给 omp（omp 会按自己的 cwd 解析，把文件写进项目目录）", async () => {
    const { pool, id, inputLog } = await start(await fixtureWith([]));
    await expect(pool.exportTaskHtml(id, "out.html")).rejects.toThrow(/absolute/);
    expect((await sentFrames(inputLog)).map((frame) => frame.type)).not.toContain("export_html");
  });

  it("任务不存在时抛错；taskTitle 给出默认文件名要用的标题", async () => {
    const { pool, id } = await start(await fixtureWith([]));
    expect(() => pool.taskTitle("nope" as TaskId)).toThrow(/unknown task/);
    expect(typeof pool.taskTitle(id)).toBe("string");
  });
});

describe("导出的默认文件名", () => {
  it("去掉 Windows 非法字符和路径分隔符，折叠空白", () => {
    expect(sanitizeFileStem('修复 a/b:c*d?"e"<f>|g\\h')).toBe("修复 a b c d e f g h");
    expect(sanitizeFileStem("line1\r\nline2\tend")).toBe("line1 line2 end");
  });

  it("去首尾的点和空格；全是非法字符或空标题时用 omp-session", () => {
    expect(sanitizeFileStem("  ..name.. ")).toBe("name");
    expect(sanitizeFileStem("")).toBe("omp-session");
    expect(sanitizeFileStem("///:::***")).toBe("omp-session");
    expect(sanitizeFileStem("...")).toBe("omp-session");
  });

  it("Windows 保留设备名后补下划线（含大小写）", () => {
    expect(sanitizeFileStem("con")).toBe("con_");
    expect(sanitizeFileStem("NUL")).toBe("NUL_");
    expect(sanitizeFileStem("com1")).toBe("com1_");
    expect(sanitizeFileStem("console")).toBe("console");
  });

  it("按码点限长 80，不劈开代理对，截断后露出的结尾空白和点也去掉", () => {
    const emoji = "😀".repeat(100);
    const cut = sanitizeFileStem(emoji);
    expect([...cut]).toHaveLength(80);
    expect(cut).not.toContain("\ufffd");
    expect(sanitizeFileStem(`${"a".repeat(79)}. tail`)).toBe("a".repeat(79));
  });

  it("文件名 = <标题>-<本地日期>.html", () => {
    expect(exportFileName("修 bug: 登录", new Date(2026, 9, 5, 23, 59))).toBe("修 bug 登录-2026-10-05.html");
    expect(exportFileName("", new Date(2026, 0, 31))).toBe("omp-session-2026-01-31.html");
  });
});
