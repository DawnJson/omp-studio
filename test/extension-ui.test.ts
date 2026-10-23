// 后台 rpc-ui 进程上的 extension UI：连接层的常驻默认应答（select / confirm / input / editor / ask 回 cancelled）、
// 登录期间认领应答权（不抢答）、登录里 omp 撤销输入时推 input_closed，以及 builtin-command 执行期间的 extension_error / notice / rpc_frame_error。
// 用假 omp 回放构造的帧；假 omp 的第二个参数记录主进程写给它的每一行。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { OmpConnection } from "../src/main/omp/omp-connection.ts";
import { runCommandText } from "../src/main/service/builtin-command.ts";
import { startLogin } from "../src/main/service/login.ts";

// vi.mock 会被提升到 import 之前：login.ts 拿到的是下面这些替身。
const hoisted = vi.hoisted(() => ({ connection: null as OmpConnection | null, events: [] as unknown[] }));

vi.mock("electron", () => ({ shell: { openExternal: vi.fn() } }));
vi.mock("../src/main/ipc/events.ts", () => ({
  emitEvent: (channel: string, payload: unknown) => hoisted.events.push({ channel, payload }),
}));
vi.mock("../src/main/ipc/validate.ts", () => ({ parseExternalUrl: (url: string) => url }));
vi.mock("../src/main/service/service-omp.ts", () => ({
  serviceOmp: {
    use: (job: (connection: unknown) => Promise<unknown>) => job(hoisted.connection),
    close: async () => {},
  },
}));

const root = path.resolve(import.meta.dirname, "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-omp.ts");
let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio-extui-"));
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
      data: { commands: [{ name: "tools", source: "builtin" }] },
    },
  },
];
const promptAck = {
  kind: "out",
  frame: { type: "response", command: "prompt", id: "p", success: true, data: { agentInvoked: false } },
};

let count = 0;
/** 写回放文件，返回 [假 omp 参数, 输入记录文件]。 */
async function fixture(entries: object[]) {
  const file = path.join(scratch, `f${count}.ndjson`);
  const log = path.join(scratch, `in${count}.log`);
  count++;
  await writeFile(file, [...handshake, ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  await writeFile(log, "");
  return { log, launch: { command: process.execPath, args: [fakeOmp, file, log], cwd: scratch, env: process.env } };
}
async function received(log: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(log, "utf8");
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
const responsesIn = async (log: string) => (await received(log)).filter((f) => f.type === "extension_ui_response");
const uiRequest = (id: string, method: string, extra: object = {}) => ({
  kind: "out",
  frame: { type: "extension_ui_request", id, method, ...extra },
});

describe("连接层的默认应答", () => {
  it("没人认领时 select / confirm / input / editor / ask 回 cancelled，notify / setStatus / setWidget 不回应", async () => {
    const { log, launch } = await fixture([
      uiRequest("u1", "select", { title: "t", options: ["a"] }),
      uiRequest("u2", "confirm", { title: "t", message: "m" }),
      uiRequest("u3", "input", { title: "t" }),
      uiRequest("u4", "editor", { title: "t" }),
      uiRequest("u5", "ask", { questions: [] }),
      uiRequest("u6", "notify", { message: "hi", notifyType: "info" }),
      uiRequest("u7", "setStatus", { statusKey: "k", statusText: "x" }),
      uiRequest("u8", "setWidget", { widgetKey: "k", widgetLines: ["x"] }),
      ...Array.from({ length: 5 }, () => ({ kind: "in", frame: { type: "extension_ui_response" } })),
      { kind: "in", frame: { type: "probe" } },
    ]);
    const connection = OmpConnection.spawn(launch);
    try {
      await connection.ready;
      await vi.waitFor(async () => expect((await received(log)).length).toBeGreaterThanOrEqual(6));
      // 呈现类没有应答：第 6 条之后紧跟的必须是 probe，而不是多余的 extension_ui_response。
      connection.send({ type: "probe" } as never);
      await vi.waitFor(async () => expect((await received(log)).at(-1)?.type).toBe("probe"));
      const responses = await responsesIn(log);
      expect(responses).toEqual(
        ["u1", "u2", "u3", "u4", "u5"].map((id) => ({ type: "extension_ui_response", id, cancelled: true })),
      );
    } finally {
      await connection.close();
    }
  });

  it("认领期间不抢答，释放后恢复", async () => {
    const { log, launch } = await fixture([
      { kind: "in", frame: { type: "go" } },
      uiRequest("u1", "select", { title: "t", options: ["a"] }),
      { kind: "in", frame: { type: "go2" } },
      uiRequest("u2", "select", { title: "t", options: ["a"] }),
      { kind: "in", frame: { type: "extension_ui_response" } },
    ]);
    const connection = OmpConnection.spawn(launch);
    try {
      await connection.ready;
      const seen: string[] = [];
      const stop = connection.onFrame((frame) => {
        if (frame.type === "extension_ui_request") seen.push(frame.id);
      });
      const release = connection.claimExtensionUi();
      connection.send({ type: "go" } as never);
      await vi.waitFor(() => expect(seen).toEqual(["u1"]));
      release();
      release(); // 重复释放不会多减
      connection.send({ type: "go2" } as never);
      await vi.waitFor(async () => expect(await responsesIn(log)).toHaveLength(1));
      stop();
      // u1 若被抢答，假 omp 会在 go2 的位置读到 extension_ui_response 而退出；这里只有 u2 的应答。
      expect(await responsesIn(log)).toEqual([{ type: "extension_ui_response", id: "u2", cancelled: true }]);
    } finally {
      await connection.close();
    }
  });
});

describe("登录", () => {
  it("omp 撤销输入时推 input_closed；其它对话框只答一次（不和默认应答重复）", async () => {
    const { log, launch } = await fixture([
      { kind: "in", frame: { type: "login", id: "l" } },
      uiRequest("n1", "notify", { message: "slow down", notifyType: "warning" }),
      uiRequest("i1", "input", { title: "Paste the code", timeout: 600000 }),
      uiRequest("s1", "select", { title: "t", options: ["a"] }),
      { kind: "in", frame: { type: "extension_ui_response" } },
      uiRequest("c1", "cancel", { targetId: "i1" }),
      { kind: "out", frame: { type: "response", command: "login", id: "l", success: true } },
      { kind: "in", frame: { type: "probe" } },
    ]);
    const connection = OmpConnection.spawn(launch);
    hoisted.connection = connection;
    hoisted.events.length = 0;
    try {
      await connection.ready;
      await expect(startLogin("anthropic")).resolves.toEqual({ ok: true, providerId: "anthropic" });
      expect(hoisted.events).toEqual([
        { channel: "login", payload: { type: "progress", level: "warning", message: "slow down" } },
        { channel: "login", payload: { type: "input", inputId: "i1", title: "Paste the code" } },
        { channel: "login", payload: { type: "input_closed", inputId: "i1" } },
      ]);
      connection.send({ type: "probe" } as never);
      await vi.waitFor(async () => expect((await received(log)).at(-1)?.type).toBe("probe"));
      expect(await responsesIn(log)).toEqual([{ type: "extension_ui_response", id: "s1", cancelled: true }]);
    } finally {
      hoisted.connection = null;
      await connection.close();
    }
  });
});

describe("builtin-command 执行期间的帧", () => {
  const run = async (entries: object[]) => {
    const { launch } = await fixture([
      ...commandList,
      { kind: "in", frame: { type: "prompt", id: "p" } },
      ...entries,
      promptAck,
    ]);
    const connection = OmpConnection.spawn(launch);
    try {
      await connection.ready;
      return await runCommandText(connection, "/tools");
    } finally {
      await connection.close();
    }
  };

  it("extension_error 以原文报错", async () => {
    await expect(
      run([
        { kind: "out", frame: { type: "command_output", text: "partial" } },
        {
          kind: "out",
          frame: { type: "extension_error", extensionPath: "/x.ts", event: "input", error: "boom: bad hook" },
        },
      ]),
    ).rejects.toThrow("boom: bad hook");
  });

  it("rpc_frame_error（输出超限被丢）报错，不再静默返回空", async () => {
    await expect(
      run([
        {
          kind: "out",
          frame: {
            type: "rpc_frame_error",
            error: "frame too large: 2000000 > 1048576",
            originalType: "command_output",
          },
        },
      ]),
    ).rejects.toThrow("frame too large: 2000000 > 1048576");
  });

  it("notice 附在输出后面", async () => {
    await expect(
      run([
        { kind: "out", frame: { type: "command_output", text: "* read" } },
        { kind: "out", frame: { type: "notice", level: "warning", message: "session is not persisted" } },
      ]),
    ).resolves.toBe("* read\nsession is not persisted");
  });
});
