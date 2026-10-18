// 假 omp：按顺序回放一份 RPC 录制，用来在不调真实模型的情况下复现界面和主进程的各种状态。
// 用法：node test/fake-omp/fake-omp.ts <录制文件> [输入记录文件]
// 给了第二个参数就把收到的每一行（主进程写给 omp 的帧）原样追加进去，测试据此断言 omp 收到了什么。
// 录制格式见 docs/architecture/rpc-replay.md。
import { appendFileSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

type Entry =
  | { kind: "meta" }
  | { kind: "out"; frame: Record<string, unknown> }
  | { kind: "in"; frame: Record<string, unknown> }
  | { kind: "raw"; text: string }
  | { kind: "exit"; code: number }
  | { kind: "grandchild" }
  | { kind: "hang" }
  | { kind: "delay"; ms: number };

/**
 * 幂等查询：主进程会在不固定的时刻发（上下文使用率节流后的 get_state 等），不能占回放顺序。
 * 它们不在"下一条期望的 in"时，直接按录制里最近一次的应答立即回，不消耗录制条目。
 */
const IDEMPOTENT: Record<string, true> = {
  get_state: true,
  get_available_thinking_levels: true,
  get_available_models: true,
  get_available_commands: true,
  get_session_stats: true,
};

/**
 * 子代理命令：详情面板和干预按钮在不固定的时刻发，同样不占回放顺序（不在"下一条期望的 in"时才就地应答）。
 * get_subagent_messages 按 subagentId 回录制里那个子代理的应答；steer / cancel 直接答成功（cancel 答 cancelled: true）。
 */
const SUBAGENT_ACKS: Record<string, unknown> = { steer_subagent: undefined, cancel_subagent: { cancelled: true } };

const fixture = process.argv[2];
const inputLog = process.argv[3];
if (!fixture) {
  process.stderr.write("usage: fake-omp.ts <fixture.ndjson>\n");
  process.exit(2);
}

// e2e 用：把启动时的工作目录追加写进这个文件，断言任务确实在 worktree 里运行。
if (process.env["FAKE_OMP_CWD_FILE"]) appendFileSync(process.env["FAKE_OMP_CWD_FILE"], `${process.cwd()}\n`);

// e2e 用：把自己的 pid 追加写进这个文件，断言应用退出后 omp 进程确实没有残留。
if (process.env["FAKE_OMP_PID_FILE"]) appendFileSync(process.env["FAKE_OMP_PID_FILE"], `${process.pid}\n`);

const entries: Entry[] = readFileSync(fixture, "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line));

// 命令 → 最近一次录制的应答 data。先用整份录制里第一次出现的值垫底，回放过程中随 `out` 更新。
const latestData = new Map<string, unknown>();
{
  const commandById = new Map<string, string>();
  for (const entry of entries) {
    if (entry.kind === "in" && typeof entry.frame.id === "string" && typeof entry.frame.type === "string")
      commandById.set(entry.frame.id, entry.frame.type);
    // 斜杠命令目录：录制里没有 get_available_commands 的应答，用启动时推送的 available_commands_update 垫底。
    if (
      entry.kind === "out" &&
      entry.frame.type === "available_commands_update" &&
      !latestData.has("get_available_commands")
    )
      latestData.set("get_available_commands", { commands: entry.frame.commands });
    if (entry.kind === "out" && entry.frame.type === "response" && typeof entry.frame.id === "string") {
      const command = commandById.get(entry.frame.id);
      if (command && IDEMPOTENT[command] && !latestData.has(command)) latestData.set(command, entry.frame.data);
    }
  }
}

// 子代理的查询和干预（get_subagent_messages / steer_subagent / cancel_subagent）是录制脚本在特定时刻发的，回放时由界面在不固定的时刻发：
// 这几条 `in` 和它们的应答 `out` 不占回放顺序，应答由 nextFrame 就地给。get_subagent_messages 的应答按录制里请求的 subagentId 索引。
interface RecordedMessages {
  nextByte: number;
  entries: unknown[];
  messages: unknown[];
}
const subagentMessages = new Map<string, RecordedMessages>();
const unsequenced = new Set<string>();
{
  const subagentById = new Map<string, string>();
  for (const entry of entries) {
    if (entry.kind === "in" && typeof entry.frame.id === "string") {
      if (entry.frame.type === "get_subagent_messages")
        subagentById.set(entry.frame.id, String(entry.frame.subagentId));
      if (entry.frame.type === "get_subagent_messages" || Object.hasOwn(SUBAGENT_ACKS, String(entry.frame.type)))
        unsequenced.add(entry.frame.id);
    }
    if (entry.kind === "out" && entry.frame.type === "response" && typeof entry.frame.id === "string") {
      const subagent = subagentById.get(entry.frame.id);
      if (subagent !== undefined) subagentMessages.set(subagent, entry.frame.data as RecordedMessages);
    }
  }
}

const stdinLines = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
// 录制里的请求 id → 这次运行里主进程实际用的 id。
const ids = new Map<string, string>();
let hang = false;

/** 读下一行；幂等查询（且不是下一条期望的）就地应答后继续读。stdin 关闭返回 null。 */
async function nextFrame(expectedType: string | null): Promise<{ raw: string; frame: Record<string, unknown> } | null> {
  for (;;) {
    const next = await stdinLines.next();
    if (next.done) return null;
    const frame: unknown = JSON.parse(next.value);
    if (typeof frame !== "object" || frame === null) return { raw: next.value, frame: {} };
    const received = frame as Record<string, unknown>;
    if (typeof received.type === "string" && received.type !== expectedType) {
      const reply = { type: "response", command: received.type, id: received.id };
      if (received.type === "get_subagent_messages") {
        const data = subagentMessages.get(String(received.subagentId));
        const fromByte = typeof received.fromByte === "number" ? received.fromByte : 0;
        // 和真实 omp 一样按字节续读：从录制里的 nextByte 往后没有新内容。
        const body =
          data !== undefined && fromByte >= data.nextByte
            ? { ...data, fromByte, nextByte: data.nextByte, entries: [], messages: [] }
            : data;
        process.stdout.write(
          JSON.stringify(
            body === undefined
              ? { ...reply, success: false, error: `unknown subagent ${String(received.subagentId)}` }
              : { ...reply, success: true, data: body },
          ) + "\n",
        );
        continue;
      }
      if (Object.hasOwn(SUBAGENT_ACKS, received.type)) {
        const data = SUBAGENT_ACKS[received.type];
        process.stdout.write(JSON.stringify({ ...reply, success: true, ...(data !== undefined && { data }) }) + "\n");
        continue;
      }
    }
    if (typeof received.type === "string" && IDEMPOTENT[received.type] && received.type !== expectedType) {
      const data = latestData.get(received.type);
      process.stdout.write(
        JSON.stringify({
          type: "response",
          command: received.type,
          id: received.id,
          success: true,
          ...(data !== undefined && { data }),
        }) + "\n",
      );
      continue;
    }
    return { raw: next.value, frame: received };
  }
}

for (const entry of entries) {
  if ("frame" in entry && typeof entry.frame.id === "string" && unsequenced.has(entry.frame.id)) {
    if (entry.kind === "in" || (entry.kind === "out" && entry.frame.type === "response")) continue;
  }
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
      const received = await nextFrame(typeof entry.frame.type === "string" ? entry.frame.type : null);
      if (!received) process.exit(0);
      if (inputLog) appendFileSync(inputLog, `${received.raw}\n`);
      if (received.frame.type !== entry.frame.type) {
        process.stderr.write(`fake-omp: expected ${String(entry.frame.type)}, got ${received.raw}\n`);
        process.exit(3);
      }
      if (typeof entry.frame.id === "string" && typeof received.frame.id === "string")
        ids.set(entry.frame.id, received.frame.id);
      break;
    }
    case "exit":
      // Windows 上写管道是异步的，先等之前的输出写完再退出。
      await new Promise((resolve) => process.stdout.write("", resolve));
      process.exit(entry.code);
    case "grandchild": {
      // 模拟 omp 起的 bash 等子进程：一个不会自己退出的进程，pid 用一个测试专用帧报告出去。
      // detached：Node 非 detached 的子进程会进 fake-omp 自己的 libuv Job，fake-omp 一死就跟着没了；
      // 真实 omp 的孙进程（bash、ping）不受这个 job 管（problem.md 第 4 题：omp 被杀后 PING.EXE 留下），要模拟的是这种。
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 60_000)"], {
        stdio: "ignore",
        windowsHide: true,
        detached: true,
      });
      child.unref();
      process.stdout.write(JSON.stringify({ type: "test_grandchild", pid: child.pid }) + "\n");
      break;
    }
    case "hang":
      hang = true;
      break;
    case "delay":
      // 慢速回放：在这一步之前等一会，用来复现"已工作 N 秒"这类依赖真实时间的界面。
      await new Promise((resolve) => setTimeout(resolve, entry.ms));
      break;
  }
  // 回放中录制的幂等应答要刷新"最近一次应答"。
  if (entry.kind === "out" && entry.frame.type === "response" && typeof entry.frame.id === "string") {
    const command = entry.frame.command;
    if (typeof command === "string" && IDEMPOTENT[command]) latestData.set(command, entry.frame.data);
  }
}

if (hang) {
  // 模拟关闭 stdin 后不退出的 omp：只能被强制结束。
  setInterval(() => {}, 60_000);
}
// stdin 关闭后：和真实 omp 一样退出（hang 时不退出）；期间幂等查询照常应答。
while (await nextFrame(null)) {}
if (hang) await new Promise(() => {});
