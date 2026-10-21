// runBuiltinOn：只放行 get_available_commands 里 source 为 builtin 的命令，agentInvoked:true 当失败，收集 command_output；
// ProjectOmpPool：每个目录一个进程、空闲后关、close 全部关掉。回放文件是按 omp 18.12.5 实测（native-ui-plan §2.2）的帧手写的。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OmpConnection } from "../src/main/omp/omp-connection.ts";
import { runBuiltinOn, runCommandText } from "../src/main/service/builtin-command.ts";
import { IdleOmp } from "../src/main/service/idle-omp.ts";
import { ProjectOmpPool } from "../src/main/service/project-omp.ts";

const root = path.resolve(import.meta.dirname, "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-omp.ts");
let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio-builtin-"));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const handshake = [
  {
    kind: "out",
    frame: {
      type: "ready",
      protocolVersion: 1,
      supportedProtocolVersions: [1, 2],
      maxFrameBytes: 1048576,
      maxReassembledFrameBytes: 67108864,
    },
  },
  { kind: "in", frame: { type: "negotiate_protocol", id: "n" } },
  {
    kind: "out",
    frame: { type: "response", command: "negotiate_protocol", id: "n", success: true, data: { protocolVersion: 2 } },
  },
];
const commandList = [
  { kind: "in", frame: { type: "get_available_commands", id: "c" } },
  {
    kind: "out",
    frame: {
      type: "response",
      command: "get_available_commands",
      id: "c",
      success: true,
      data: {
        commands: [
          { name: "tools", source: "builtin" },
          { name: "unpin", source: "skill" },
        ],
      },
    },
  },
];
const promptReply = (id: string, agentInvoked: boolean) => [
  { kind: "in", frame: { type: "prompt", id } },
  { kind: "out", frame: { type: "response", command: "prompt", id, success: true, data: { agentInvoked } } },
];

let count = 0;
async function fixture(entries: object[]): Promise<string> {
  const file = path.join(scratch, `f${count++}.ndjson`);
  await writeFile(file, [...handshake, ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  return file;
}
const launch = (file: string, cwd = scratch) => ({
  command: process.execPath,
  args: [fakeOmp, file],
  cwd,
  env: process.env,
});

describe("runBuiltinOn", () => {
  it("收集 command_output（去 ANSI），agentInvoked:false 时返回文本", async () => {
    const file = await fixture([
      ...commandList,
      { kind: "in", frame: { type: "prompt", id: "p" } },
      { kind: "out", frame: { type: "command_output", text: "* read\n\u001b[2m- lsp\u001b[0m" } },
      {
        kind: "out",
        frame: { type: "response", command: "prompt", id: "p", success: true, data: { agentInvoked: false } },
      },
    ]);
    const connection = OmpConnection.spawn(launch(file));
    try {
      await connection.ready;
      await expect(runBuiltinOn(connection, { kind: "tools" })).resolves.toBe("* read\n- lsp");
    } finally {
      await connection.close();
    }
  });

  it("应答 agentInvoked:true（会调模型）时 reject", async () => {
    const file = await fixture([...commandList, ...promptReply("p", true)]);
    const connection = OmpConnection.spawn(launch(file));
    try {
      await connection.ready;
      await expect(runBuiltinOn(connection, { kind: "tools" })).rejects.toThrow(/not a builtin command/);
    } finally {
      await connection.close();
    }
  });

  it("不在列表里或 source 不是 builtin 的命令名不发 prompt", async () => {
    // 回放里没有任何 prompt：发了就会因为期望不符让假 omp 退出，测试失败。
    const file = await fixture([...commandList, ...commandList.map((entry) => ({ ...entry }))]);
    const connection = OmpConnection.spawn(launch(file));
    try {
      await connection.ready;
      await expect(runCommandText(connection, "/unpin")).rejects.toThrow(/not an omp builtin command/);
      await expect(runCommandText(connection, "/nosuch")).rejects.toThrow(/not an omp builtin command/);
    } finally {
      await connection.close();
    }
  });
});

describe("ProjectOmpPool", () => {
  const poolFor = (file: string, idleMs: number) =>
    new ProjectOmpPool({ launch: async (cwd) => launch(file, cwd), assignJob: () => {} }, idleMs, (dir) => dir);
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const until = async (check: () => boolean) => {
    const deadline = Date.now() + 10_000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error("timed out");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  it("同一目录复用一个进程，空闲后关掉并丢掉条目", async () => {
    const pool = poolFor(await fixture([]), 150);
    const first = await pool.use(scratch, async (connection) => connection.pid!);
    const second = await pool.use(scratch, async (connection) => connection.pid!);
    expect(second).toBe(first);
    expect(pool.size).toBe(1);
    await until(() => !alive(first) && pool.size === 0);
    await pool.close();
  });

  it("close 关掉全部进程，之后不再接受操作", async () => {
    const pool = poolFor(await fixture([]), 60_000);
    const pid = await pool.use(scratch, async (connection) => connection.pid!);
    expect(alive(pid)).toBe(true);
    await pool.close();
    expect(alive(pid)).toBe(false);
    await expect(pool.use(scratch, async () => 1)).rejects.toThrow(/closed/);
  });
});

describe("IdleOmp", () => {
  it("放不进 Job Object 的进程不留着", async () => {
    const file = await fixture([]);
    const idle = new IdleOmp({
      cwd: async () => scratch,
      launch: async (cwd) => launch(file, cwd),
      assignJob: () => {
        throw new Error("job failed");
      },
      idleCloseMs: 60_000,
    });
    await expect(idle.use(async () => 1)).rejects.toThrow("job failed");
    await idle.close();
  });
});
