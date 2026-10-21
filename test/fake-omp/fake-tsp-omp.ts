// 假 omp（TSP 版）：在伪终端里按录制回放 omp 发出的 TSP 消息，不调真实模型，复现界面和主进程的各种状态。
// 用法：node test/fake-omp/fake-tsp-omp.ts <录制名或路径> [--speed=<倍数>] [--log=<文件>] [--exit-after-end]
//   录制名 = fixtures/tsp/<名字>.jsonl（omp 自己用 PI_TUI_TSP_RECORD 录的双向消息，每行 {t, dir, verb, params?, body}）。
//   录制里 omp 不记按键：需要"等到终端按了某个键才继续回放"时，在录制里手工加一行 {"t":…,"dir":"in","verb":"k","body":"\u001b"}
//   （verb k = 终端写进 pty 的按键，body 是那段字节），回放到这里会等收到同样的按键。
//   --speed：回放速度，录制里的间隔除以它（默认 1；测试用大数，免得等真实的 59 秒）。
//   --log：把收到的每条 TSP 消息、按键原样追加成 JSONL（{kind:"tsp", verb, body} / {kind:"keys", data}），测试据此断言 omp 收到了什么。
//   --exit-after-end：回放完立刻以 0 退出（默认继续活着，和真实 omp 一样等输入）。
// 环境变量：FAKE_TSP_SESSION_FILE（回放开始时发 OSC 1337 SetUserVar=omp_session_file）、FAKE_TSP_TITLE（OSC 0）、
// FAKE_OMP_CWD_FILE / FAKE_OMP_PID_FILE（同 fake-omp.ts，e2e 用）。
// 必须跑在伪终端里（TspSession 总是 node-pty）：往 stdout 写 APC，从 stdin 读终端发来的事件。
//
// 行为：写 hello 查询和 DA1 → 收到 hello 回复后才开始回放 → 按录制的时间间隔写 `out` 消息 → 录制里的 `in`（ack 除外）
// 按顺序等待匹配（事件名和内容都要相同；不匹配的事件忽略，早到的事件留着等回放到它）→ 信用值：未被 ack 的帧达到
// hello 回复里的 credits 就停，收到 ack 再继续（回放里的 ack 不参与匹配，用真实收到的）。
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { isRecord } from "../../src/shared/type-guards.ts";
import { TspStreamParser } from "../../src/main/tsp/stream.ts";

interface Entry {
  t: number;
  dir: "out" | "in";
  verb: string;
  params?: Record<string, string>;
  body: unknown;
}

/** 规范：一个消息体最大 65 536 字节，更大的分块发。留一点余量。 */
const CHUNK_BYTES = 60_000;
const ESC = "\x1b";
const ST = `${ESC}\\`;

const root = path.resolve(import.meta.dirname, "..", "..");
const args = process.argv.slice(2);
const fixtureArg = args.find((arg) => !arg.startsWith("--"));
if (!fixtureArg) {
  process.stderr.write("usage: fake-tsp-omp.ts <fixture name or path> [--speed=N] [--log=file] [--exit-after-end]\n");
  process.exit(2);
}
const flag = (name: string): string | undefined =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const speed = Number(flag("speed") ?? "1");
const logFile = flag("log");
const exitAfterEnd = args.includes("--exit-after-end");
const fixturePath = /[\\/]|\.jsonl$/.test(fixtureArg)
  ? fixtureArg
  : path.join(root, "fixtures", "tsp", `${fixtureArg}.jsonl`);

if (process.env["FAKE_OMP_CWD_FILE"]) appendFileSync(process.env["FAKE_OMP_CWD_FILE"], `${process.cwd()}\n`);
if (process.env["FAKE_OMP_PID_FILE"]) appendFileSync(process.env["FAKE_OMP_PID_FILE"], `${process.pid}\n`);

const entries: Entry[] = readFileSync(fixturePath, "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line) as Entry);

function log(record: object): void {
  if (logFile) appendFileSync(logFile, `${JSON.stringify(record)}\n`);
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** 一条回放消息 → 写到 stdout 的字节（超过 CHUNK_BYTES 的分块，切点按规范选：下一个字节不是 [A-Za-z0-9_-]）。 */
function encode(entry: Entry): Buffer[] {
  const params = Object.entries(entry.params ?? {})
    .map(([key, value]) => `${key}=${value};`)
    .join("");
  const body = Buffer.from(typeof entry.body === "string" ? entry.body : JSON.stringify(entry.body), "utf8");
  const head = `${ESC}_tsp;${entry.verb};`;
  if (body.length <= CHUNK_BYTES) return [Buffer.concat([Buffer.from(`${head}${params}`), body, Buffer.from(ST)])];
  const parts: Buffer[] = [];
  const id = `k${entry.t}`;
  for (let from = 0; from < body.length;) {
    let to = Math.min(from + CHUNK_BYTES, body.length);
    // 切点：下一个字节不是 [A-Za-z0-9_-]（规范：否则下一块的开头会被当成参数），也不是 UTF-8 的后续字节（0x80–0xBF）。
    // 规范允许切在字符中间，但 ConPTY 会把被切开的字符重写成 U+FFFD，真实的 omp 在 Windows 上只能在字符边界切；
    // 切在字符中间由 tsp-stream.test.ts 直接喂字节覆盖。
    while (
      to < body.length &&
      (/[A-Za-z0-9_-]/.test(String.fromCharCode(body[to] as number)) || ((body[to] as number) & 0xc0) === 0x80)
    )
      to -= 1;
    // 整段都是单词字符（不会发生在 JSON 里）：放弃安全切点，照切。
    if (to <= from) to = Math.min(from + CHUNK_BYTES, body.length);
    const more = to < body.length;
    // 第一块带原来的参数；每块都带 c，除最后一块外带 m=1。
    const chunkParams = `${from === 0 ? params : ""}c=${id};${more ? "m=1;" : ""}`;
    parts.push(Buffer.concat([Buffer.from(`${head}${chunkParams}`), body.subarray(from, to), Buffer.from(ST)]));
    from = to;
  }
  return parts;
}

// ───── 终端 → 程序 ─────

const helloReplied = Promise.withResolvers<{ credits: number }>();
const received: Record<string, unknown>[] = [];
const receivedKeyData: string[] = [];
const waiters = new Set<() => void>();
const unacked: { sf: string; s: number }[] = [];

const parser = new TspStreamParser((event) => {
  if (event.type !== "tsp") return;
  let body: unknown;
  try {
    body = JSON.parse(event.body);
  } catch {
    return;
  }
  log({ kind: "tsp", verb: event.verb, body });
  if (!isRecord(body)) return;
  if (event.verb === "r" && body["r"] === "hello") {
    helloReplied.resolve({ credits: typeof body["credits"] === "number" ? body["credits"] : 2 });
    return;
  }
  if (event.verb !== "e") return;
  const { sf, s } = body;
  if (body["ev"] === "ack" && typeof sf === "string" && typeof s === "number") {
    for (let i = unacked.length - 1; i >= 0; i -= 1) {
      const frame = unacked[i];
      if (frame && frame.sf === sf && frame.s <= s) unacked.splice(i, 1);
    }
  } else {
    received.push(body);
  }
  for (const waiter of waiters) waiter();
});

if (process.stdin.isTTY) process.stdin.setRawMode(true);
// 一个数据块里可能同时有 TSP 消息（ack 等）和按键（负载高时 pty 会把它们合在一起）：去掉完整的 TSP 消息，剩下的才是按键。
// JSON 体里的控制字符都被转义，所以消息体里不会出现 ESC。
const TSP_MESSAGE = new RegExp(String.raw`\x1b_tsp[^\x1b]*\x1b\\|\x1b\]877[^\x07\x1b]*(?:\x07|\x1b\\)`, "g");
process.stdin.on("data", (chunk: Buffer) => {
  const text = chunk.toString("utf8");
  // DA1 应答单独记：它和 hello 回复可能在同一个数据块里，按块判断会把它吞掉；顺序以 TSP 消息处理之后为准。
  const da1 = text.includes(`${ESC}[?62;22c`);
  const rest = text.replace(TSP_MESSAGE, "").replaceAll(`${ESC}[?62;22c`, "");
  // 分块到下一个数据块的 TSP 消息（没收尾）不算按键。
  const keys = rest.includes(`${ESC}_tsp`) || rest.includes(`${ESC}]877`) ? "" : rest;
  if (keys !== "") {
    log({ kind: "keys", data: keys });
    receivedKeyData.push(keys);
    for (const waiter of waiters) waiter();
  }
  parser.write(chunk);
  if (da1) log({ kind: "da1-reply" });
});

/** 等到 `ready()` 为真（每次收到终端消息时重新检查）。 */
function until(ready: () => boolean): Promise<void> {
  if (ready()) return Promise.resolve();
  const { promise, resolve } = Promise.withResolvers<void>();
  const check = () => {
    if (!ready()) return;
    waiters.delete(check);
    resolve();
  };
  waiters.add(check);
  return promise;
}

// ───── 握手和回放 ─────

process.stdout.write(
  `${ESC}_tsp;q;${JSON.stringify({ q: "hello", v: [1], app: "omp", features: ["edit", "undo", "send"] })}${ST}${ESC}[c`,
);
const { credits } = await helloReplied.promise;

const sessionFile = process.env["FAKE_TSP_SESSION_FILE"];
if (sessionFile)
  process.stdout.write(`${ESC}]1337;SetUserVar=omp_session_file=${Buffer.from(sessionFile).toString("base64")}\x07`);
if (process.env["FAKE_TSP_TITLE"]) process.stdout.write(`${ESC}]0;${process.env["FAKE_TSP_TITLE"]}\x07`);

let lastT = entries[0]?.t ?? 0;
for (const entry of entries) {
  if (entry.dir === "in") {
    if (entry.verb === "k") {
      const key = String(entry.body);
      await until(() => receivedKeyData.some((data) => data.includes(key)));
      receivedKeyData.splice(
        receivedKeyData.findIndex((data) => data.includes(key)),
        1,
      );
      lastT = entry.t;
      continue;
    }
    // ack 由我们按真实收到的为准；其余事件按顺序等匹配。
    if (isRecord(entry.body) && entry.body["ev"] === "ack") continue;
    const matches = (event: Record<string, unknown>) => isDeepStrictEqual(event, entry.body);
    await until(() => received.some(matches));
    received.splice(received.findIndex(matches), 1);
    lastT = entry.t;
    continue;
  }
  await sleep(Math.max(0, entry.t - lastT) / speed);
  lastT = entry.t;
  if (entry.verb === "f" && isRecord(entry.body)) {
    const { sf, s } = entry.body;
    await until(() => unacked.length < credits);
    if (typeof sf === "string" && typeof s === "number") unacked.push({ sf, s });
  }
  for (const part of encode(entry)) process.stdout.write(part);
}

// 等最后几帧都被确认、写完再退出：pty 里 stdout 是异步的，直接 exit 会丢掉最后一批，终端也来不及回 ack。
if (exitAfterEnd) {
  await until(() => unacked.length === 0);
  process.stdout.write("", () => process.exit(0));
}
