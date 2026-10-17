// 假 omp：按顺序回放一份 RPC 录制，用来在不调真实模型的情况下复现界面和主进程的各种状态。
// 用法：node test/fake-omp/fake-omp.ts <录制文件>
// 录制格式见 docs/architecture/rpc-replay.md。
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

type Entry =
  | { kind: "meta" }
  | { kind: "out"; frame: Record<string, unknown> }
  | { kind: "in"; frame: Record<string, unknown> }
  | { kind: "raw"; text: string }
  | { kind: "exit"; code: number }
  | { kind: "grandchild" }
  | { kind: "hang" };

const fixture = process.argv[2];
if (!fixture) {
  process.stderr.write("usage: fake-omp.ts <fixture.ndjson>\n");
  process.exit(2);
}

const entries: Entry[] = readFileSync(fixture, "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line));

const stdinLines = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
// 录制里的请求 id → 这次运行里主进程实际用的 id。
const ids = new Map<string, string>();
let hang = false;

for (const entry of entries) {
  switch (entry.kind) {
    case "meta":
      break;
    case "out": {
      const frame = { ...entry.frame };
      const recordedId = frame.id;
      if ((frame.type === "response" || frame.type === "prompt_result") && typeof recordedId === "string") {
        frame.id = ids.get(recordedId) ?? recordedId;
      }
      process.stdout.write(JSON.stringify(frame) + "\n");
      break;
    }
    case "raw":
      process.stdout.write(entry.text + "\n");
      break;
    case "in": {
      const next = await stdinLines.next();
      if (next.done) process.exit(0);
      const received: unknown = JSON.parse(next.value);
      if (typeof received !== "object" || received === null || !("type" in received) || received.type !== entry.frame.type) {
        process.stderr.write(`fake-omp: expected ${String(entry.frame.type)}, got ${next.value}\n`);
        process.exit(3);
      }
      if (typeof entry.frame.id === "string" && "id" in received && typeof received.id === "string") ids.set(entry.frame.id, received.id);
      break;
    }
    case "exit":
      // Windows 上写管道是异步的，先等之前的输出写完再退出。
      await new Promise((resolve) => process.stdout.write("", resolve));
      process.exit(entry.code);
    case "grandchild": {
      // 模拟 omp 起的 bash 等子进程：一个不会自己退出的进程，pid 用一个测试专用帧报告出去。
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 60_000)"], { stdio: "ignore", windowsHide: true });
      process.stdout.write(JSON.stringify({ type: "test_grandchild", pid: child.pid }) + "\n");
      break;
    }
    case "hang":
      hang = true;
      break;
  }
}

if (hang) {
  // 模拟关闭 stdin 后不退出的 omp：只能被强制结束。
  setInterval(() => {}, 60_000);
} else {
  // 和真实 omp 一样，stdin 关闭后退出。
  while (!(await stdinLines.next()).done) {}
}
