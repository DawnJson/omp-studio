import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RpcProtocolError } from "../src/main/omp/frame-decoder.ts";
import { OmpConnection, OmpExitedError, RpcCommandError } from "../src/main/omp/omp-connection.ts";
import type { RpcServerFrame } from "../src/main/omp/wire/rpc-wire.generated.ts";

const root = path.resolve(import.meta.dirname, "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-omp.ts");
// 路径带空格和中文：开发机上就有这种路径。
let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio 测试-"));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function connect(fixture: string, options: { readyTimeoutMs?: number } = {}) {
  return OmpConnection.spawn({ command: process.execPath, args: [fakeOmp, fixture], cwd: scratch, env: process.env }, options);
}

let fixtureCount = 0;
async function inlineFixture(entries: object[]): Promise<string> {
  const file = path.join(scratch, `回放 ${fixtureCount++}.ndjson`);
  await writeFile(file, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  return file;
}

const readyV2 = { kind: "out", frame: { type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2], maxFrameBytes: 1048576, maxReassembledFrameBytes: 67108864 } };
const negotiated = [
  { kind: "in", frame: { type: "negotiate_protocol", id: "n" } },
  { kind: "out", frame: { type: "response", command: "negotiate_protocol", id: "n", success: true, data: { protocolVersion: 2 } } },
];

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("OmpConnection replaying a recorded omp 18.12.0 session", () => {
  it("negotiates v2, streams events, resolves the prompt with its prompt_result, and exits cleanly on close", async () => {
    const connection = connect(path.join(root, "fixtures", "rpc", "bash-tool.ndjson"));
    const types: string[] = [];
    connection.onFrame((frame: RpcServerFrame) => types.push(frame.type));
    await connection.ready;
    expect(connection.protocolVersion).toBe(2);

    const outcome = await connection.prompt({ message: "用 bash 工具运行 echo omp-studio" });
    expect(outcome).toMatchObject({ type: "prompt_result", agentInvoked: true, status: "completed" });
    // 结果在流式事件之后到达：界面拿到 prompt_result 时，这一轮的工具调用和消息已经全部收到。
    expect(types).toContain("tool_execution_end");
    expect(types.indexOf("agent_end")).toBeLessThan(types.indexOf("prompt_result"));
    expect(types).not.toContain("response");

    const exit = await connection.close();
    expect(exit).toMatchObject({ code: 0, killed: false, error: null });
  });
});

describe("OmpConnection failure paths", () => {
  it("stays on protocol v1 when omp does not offer v2", async () => {
    const connection = connect(await inlineFixture([{ kind: "out", frame: { type: "ready" } }]));
    await connection.ready;
    expect(connection.protocolVersion).toBe(1);
    await connection.close();
  });

  it("rejects a command whose response has success: false with the server's message", async () => {
    const connection = connect(
      await inlineFixture([
        readyV2,
        ...negotiated,
        { kind: "in", frame: { type: "get_state", id: "s" } },
        { kind: "out", frame: { type: "response", command: "get_state", id: "s", success: false, error: "no session", code: "no_session" } },
      ]),
    );
    await connection.ready;
    const error = await connection.request("get_state").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcCommandError);
    expect(error).toMatchObject({ message: "no session", code: "no_session" });
    await connection.close();
  });

  it("rejects an in-flight prompt when omp exits before the prompt finishes", async () => {
    const connection = connect(
      await inlineFixture([
        readyV2,
        ...negotiated,
        { kind: "in", frame: { type: "prompt", id: "p" } },
        { kind: "out", frame: { type: "response", command: "prompt", id: "p", success: true, data: null } },
        { kind: "out", frame: { type: "agent_start" } },
        { kind: "exit", code: 7 },
      ]),
    );
    await connection.ready;
    const error = await connection.prompt({ message: "hi" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OmpExitedError);
    expect((error as OmpExitedError).exit.code).toBe(7);
    await expect(connection.request("get_state")).rejects.toBeInstanceOf(OmpExitedError);
  });

  it("returns at the response when omp reports agentInvoked: false", async () => {
    const connection = connect(
      await inlineFixture([
        readyV2,
        ...negotiated,
        { kind: "in", frame: { type: "prompt", id: "p" } },
        { kind: "out", frame: { type: "response", command: "prompt", id: "p", success: true, data: { agentInvoked: false } } },
      ]),
    );
    await connection.ready;
    await expect(connection.prompt({ message: "/help" })).resolves.toEqual({ agentInvoked: false });
    await connection.close();
  });

  it("kills omp, fails pending commands, and reports a protocol error when stdout is not NDJSON", async () => {
    const connection = connect(
      await inlineFixture([readyV2, ...negotiated, { kind: "in", frame: { type: "get_state", id: "s" } }, { kind: "raw", text: "\u001b[2Jnot json" }, { kind: "hang" }]),
    );
    await connection.ready;
    await expect(connection.request("get_state")).rejects.toBeInstanceOf(OmpExitedError);
    const exit = await connection.exited;
    expect(exit.killed).toBe(true);
    expect(exit.error).toBeInstanceOf(RpcProtocolError);
  });

  it("fails the handshake and kills omp when no ready frame arrives in time", async () => {
    const connection = connect(await inlineFixture([{ kind: "hang" }]), { readyTimeoutMs: 300 });
    await expect(connection.ready).rejects.toThrow(/handshake/);
    expect((await connection.exited).killed).toBe(true);
  });

  it("fails the handshake when omp never answers negotiate_protocol", async () => {
    const connection = connect(await inlineFixture([readyV2, { kind: "hang" }]), { readyTimeoutMs: 300 });
    await expect(connection.ready).rejects.toThrow(/handshake/);
    expect((await connection.exited).killed).toBe(true);
  });

  it("rejects a prompt that omp refuses, while its prompt_result still reaches frame listeners", async () => {
    const connection = connect(
      await inlineFixture([
        readyV2,
        ...negotiated,
        { kind: "in", frame: { type: "prompt", id: "p" } },
        { kind: "out", frame: { type: "response", command: "prompt", id: "p", success: false, error: "busy" } },
        { kind: "out", frame: { type: "prompt_result", id: "p", agentInvoked: false, status: "error", sessionSettled: true } },
      ]),
    );
    const results: RpcServerFrame[] = [];
    connection.onFrame((frame) => frame.type === "prompt_result" && results.push(frame));
    await connection.ready;
    await expect(connection.prompt({ message: "hi" })).rejects.toBeInstanceOf(RpcCommandError);
    await connection.close();
    expect(results).toHaveLength(1);
  });

  it("resolves a command whose response arrives as an rpc_chunk sequence", async () => {
    // 连接里命令 id 从 req-1 起递增：negotiate_protocol 是 req-1，get_state 是 req-2。
    const response = { type: "response", command: "get_state", id: "req-2", success: true, data: { note: "分块的应答".repeat(40) } };
    const bytes = Buffer.from(JSON.stringify(response));
    const parts = [bytes.subarray(0, 100), bytes.subarray(100, 333), bytes.subarray(333)];
    const chunks = parts.map((part, index) => ({
      kind: "raw",
      text: JSON.stringify({ type: "rpc_chunk", chunkId: "rpc-1", index, count: parts.length, byteLength: bytes.length, data: part.toString("base64") }),
    }));
    const connection = connect(await inlineFixture([readyV2, ...negotiated, { kind: "in", frame: { type: "get_state" } }, ...chunks]));
    await connection.ready;
    await expect(connection.request("get_state")).resolves.toEqual(response.data);
    await connection.close();
  });

  it("ends the connection with the error when a frame listener throws, instead of crashing the main process", async () => {
    const connection = connect(await inlineFixture([readyV2, ...negotiated, { kind: "out", frame: { type: "agent_start" } }, { kind: "hang" }]));
    const bug = new Error("listener bug");
    connection.onFrame((frame) => {
      if (frame.type === "agent_start") throw bug;
    });
    await connection.ready;
    const exit = await connection.exited;
    expect(exit.error).toBe(bug);
    expect(exit.killed).toBe(true);
  });

  it("force-kills omp and the processes it started when omp does not exit after stdin closes", async () => {
    const connection = connect(await inlineFixture([readyV2, ...negotiated, { kind: "grandchild" }, { kind: "hang" }]));
    const grandchild = Promise.withResolvers<number>();
    connection.onFrame((frame) => {
      const { type, pid } = frame as { type: string; pid?: number };
      if (type === "test_grandchild" && pid !== undefined) grandchild.resolve(pid);
    });
    await connection.ready;
    const pids = [connection.pid!, await grandchild.promise];
    const exit = await connection.close(300);
    expect(exit.killed).toBe(true);
    expect(pids.filter(isAlive)).toEqual([]);
  });
});
