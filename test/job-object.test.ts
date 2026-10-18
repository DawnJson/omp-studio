import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assignToAppJob, isInAppJob } from "../src/main/platform/win32/job-object.ts";

const root = path.resolve(import.meta.dirname, "..");
const host = path.join(root, "test", "fake-omp", "job-host.ts");
let scratch: string;
let fixture: string;

const frames = [
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
  { kind: "grandchild" },
  { kind: "hang" },
];

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio 强杀-"));
  fixture = path.join(scratch, "孙进程.ndjson");
  await writeFile(fixture, frames.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// 轮询的是操作系统里进程的真实存亡，没有可 await 的事件，这是需要真实时钟的集成测试。
async function waitUntil(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return condition();
}

/** 起一个"主进程"，等它报告 omp 和孙进程的 pid，然后把它强杀（TerminateProcess，不给任何清理机会）。 */
async function killHostAndReport(mode: "job" | "nojob"): Promise<{ omp: number; grandchild: number }> {
  const child = spawn(process.execPath, [host, fixture, mode], {
    stdio: ["ignore", "pipe", "inherit"],
    windowsHide: true,
  });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const first = await lines.next();
  if (first.done) throw new Error("job-host exited before reporting pids");
  const pids = JSON.parse(first.value) as { omp: number; grandchild: number };
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  return pids;
}

describe.skipIf(process.platform !== "win32")("Job Object：主进程被强杀后不留残留进程", () => {
  it("放进 Job 的 omp 和它的孙进程都随主进程一起结束", async () => {
    const pids = await killHostAndReport("job");
    const gone = await waitUntil(() => !isAlive(pids.omp) && !isAlive(pids.grandchild), 5_000);
    if (!gone) for (const pid of [pids.omp, pids.grandchild]) if (isAlive(pid)) process.kill(pid, "SIGKILL");
    expect(gone).toBe(true);
  });

  it("对照：不放进 Job 时孙进程会留下（libuv 的全局 job 只管直接子进程，孙进程静默脱离）", async () => {
    const pids = await killHostAndReport("nojob");
    const ompGone = await waitUntil(() => !isAlive(pids.omp), 5_000);
    const grandchildAlive = isAlive(pids.grandchild);
    if (grandchildAlive) process.kill(pids.grandchild, "SIGKILL");
    if (isAlive(pids.omp)) process.kill(pids.omp, "SIGKILL");
    expect(ompGone).toBe(true);
    expect(grandchildAlive).toBe(true);
  });

  it("assignToAppJob 之后 IsProcessInJob 为真，没分配的进程为假", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 60_000)"], {
      stdio: "ignore",
      windowsHide: true,
    });
    const bystander = spawn(process.execPath, ["-e", "setInterval(() => {}, 60_000)"], {
      stdio: "ignore",
      windowsHide: true,
    });
    try {
      expect(assignToAppJob(child.pid)).toBe(true);
      expect(isInAppJob(child.pid!)).toBe(true);
      expect(isInAppJob(bystander.pid!)).toBe(false);
    } finally {
      child.kill("SIGKILL");
      bystander.kill("SIGKILL");
    }
  });
});
