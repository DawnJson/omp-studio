// TspSession + 假 TSP omp（test/fake-omp/fake-tsp-omp.ts）：真实的 node-pty（Windows 上是自带的 ConPTY），
// 假 omp 在里面按录制回放，验证握手、ack、批次、快照与增量一致、被拒的 op、分块、OSC、按键和关闭。
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMessage, createDocument, snapshotDocument } from "../src/shared/tsp/document.ts";
import { deriveTaskStatus } from "../src/shared/tsp/task-status.ts";
import { TSP_KINDS, type TspEvent } from "../src/shared/tsp/tsp.generated.ts";
import {
  buildTspEnv,
  TspExitedError,
  TspHandshakeError,
  TspSession,
  type TspPtyLaunch,
  type TspSessionBatch,
  type TspSessionExit,
  type TspSessionOptions,
} from "../src/main/tsp/tsp-session.ts";
import { loadTspFixture, recordedUserEvents, tspDocMessages } from "./tsp-fixtures.ts";

const root = path.resolve(import.meta.dirname, "..");
const fakeTsp = path.join(root, "test", "fake-omp", "fake-tsp-omp.ts");
let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio-tsp-"));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

type LogRecord = { kind: string; verb?: string; body?: Record<string, unknown>; data?: string };

function readLog(file: string): LogRecord[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as LogRecord);
}

/** 轮询假 omp 的收件记录，直到满足条件（事件驱动做不到：它在另一个进程里）。 */
async function waitForLog(file: string, predicate: (records: LogRecord[]) => boolean): Promise<LogRecord[]> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const records = readLog(file);
    if (predicate(records)) return records;
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for the fake omp's log: ${JSON.stringify(records).slice(0, 2000)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

let counter = 0;

interface Run {
  session: TspSession;
  batches: TspSessionBatch[];
  exit: Promise<TspSessionExit>;
  log: string;
  titles: string[];
  sessionFiles: (string | null)[];
}

async function run(
  fixture: string,
  options: { env?: Record<string, string>; extraArgs?: string[]; session?: Partial<TspSessionOptions> } = {},
): Promise<Run> {
  counter += 1;
  const log = path.join(scratch, `log-${counter}.jsonl`);
  const batches: TspSessionBatch[] = [];
  const titles: string[] = [];
  const sessionFiles: (string | null)[] = [];
  const exited = Promise.withResolvers<TspSessionExit>();
  const launch: TspPtyLaunch = {
    command: process.execPath,
    args: [fakeTsp, fixture, "--speed=100", `--log=${log}`, ...(options.extraArgs ?? [])],
    cwd: scratch,
    env: { ...buildTspEnv(process.env, "9.9.9"), ...options.env },
  };
  const session = await TspSession.start({
    launch,
    cols: 100,
    appVersion: "9.9.9",
    appearance: { dark: true, reduceMotion: false },
    assignJob: () => () => undefined,
    onBatch: (batch) => batches.push(batch),
    onExit: (exit) => exited.resolve(exit),
    onTitle: (title) => titles.push(title),
    onSessionFile: (file) => sessionFiles.push(file),
    ...options.session,
  });
  return { session, batches, exit: exited.promise, log, titles, sessionFiles };
}

/** 回放器：把批次应用到一份新文档。 */
function replayBatches(batches: TspSessionBatch[]) {
  const doc = createDocument();
  for (const batch of batches) for (const message of batch.messages) applyMessage(doc, message);
  return doc;
}

describe("TspSession + 假 omp：整份录制回放", () => {
  it("approval：握手（hello、DA1）、按信用值 ack、批次连续、快照和增量一致、状态逐步推进", async () => {
    const lines = loadTspFixture("approval");
    const expected = tspDocMessages(lines);
    const { session, batches, exit, log } = await run("approval", { extraArgs: ["--exit-after-end"] });
    await session.ready;
    // 录制里的两个用户操作（发消息、点 Approve）：假 omp 会留着早到的事件，回放到它们时才匹配。
    for (const { event } of recordedUserEvents(lines)) session.sendEvent(event as unknown as TspEvent);
    const result = await exit;
    expect(result.closing).toBe(false);

    const records = readLog(log);
    // hello 回复：全部节点种类、我们处理得了的特性、apc 上限、信用值、列数和外观。
    const hello = records.find((record) => record.kind === "tsp" && record.verb === "r")?.body;
    expect(hello).toMatchObject({
      r: "hello",
      v: 1,
      term: "omp-studio",
      ver: "9.9.9",
      apc: 65536,
      credits: 2,
      cols: 100,
      dark: true,
      reduceMotion: false,
    });
    expect(hello?.["kinds"]).toEqual([...TSP_KINDS]);
    expect(hello?.["features"]).toEqual(["blobs", "settle", "adopt", "dock", "program-palette", "reduce-motion"]);
    // DA1 应答在 hello 回复之后。
    expect(records.findIndex((record) => record.kind === "da1-reply")).toBeGreaterThan(
      records.findIndex((record) => record.kind === "tsp" && record.verb === "r"),
    );

    // ack：假 omp 未被确认的帧到信用值就停，所以能回放完说明确认是及时的；最后一帧一定被确认了。
    const acks = records
      .filter((record) => record.verb === "e" && record.body?.["ev"] === "ack")
      .map((record) => record.body);
    const lastFrame = expected.findLast((entry) => entry.message.verb === "f")!.message;
    expect(acks.at(-1)).toEqual({ ev: "ack", sf: "s:1", s: lastFrame.verb === "f" ? lastFrame.body.s : -1 });

    // 批次：序号连续，合起来就是录制里的全部消息，快照和增量应用的结果一致。
    let seq = 0;
    for (const batch of batches) {
      expect(batch.firstSeq).toBe(seq + 1);
      seq += batch.messages.length;
    }
    expect(seq).toBe(expected.length);
    const direct = createDocument();
    for (const { message } of expected) applyMessage(direct, message);
    const snapshot = session.snapshot();
    expect(snapshot.seq).toBe(expected.length);
    expect(snapshot.document).toEqual(snapshotDocument(direct));
    expect(snapshotDocument(replayBatches(batches))).toEqual(snapshot.document);
    expect(deriveTaskStatus(session.document).status).toBe("idle");
  }, 60_000);

  it("被拒的 op 回 error 事件（带帧号和 op 序号），其余照常应用；超过 apc 上限的消息分块发来，按字节拼接", async () => {
    const big = "你好世界".repeat(20_000); // 240 KB：分成 4+ 块（切点在字符边界：ConPTY 会重写被切开的字符，字节级拼接见 tsp-stream.test.ts）
    const fixture = path.join(scratch, "reject-and-chunk.jsonl");
    const entries = [
      { t: 0, dir: "out", verb: "o", body: { id: "s:1", mode: "inline", role: "omp.session" } },
      {
        t: 1,
        dir: "out",
        verb: "f",
        body: {
          sf: "s:1",
          s: 1,
          ops: [
            ["add", "main", "s:1", null, { id: "main", k: "col" }],
            ["set", "ghost", { x: 1 }],
            ["add", "big", "main", null, { id: "big", k: "md", p: { text: big } }],
          ],
        },
      },
    ];
    await writeFile(fixture, entries.map((entry) => JSON.stringify(entry)).join("\n"));
    const sessionFile = path.join(scratch, "项目 一", "a.jsonl");
    const { session, batches, exit, log, titles, sessionFiles } = await run(fixture, {
      extraArgs: ["--exit-after-end"],
      env: { FAKE_TSP_SESSION_FILE: sessionFile, FAKE_TSP_TITLE: "标题 title" },
    });
    await exit;
    const records = readLog(log);
    expect(records.some((record) => record.body?.["ev"] === "error" && record.body["op"] === 1)).toBe(true);
    expect(records.find((record) => record.body?.["ev"] === "error")?.body).toEqual({
      ev: "error",
      sf: "s:1",
      s: 1,
      op: 1,
      msg: "unknown id ghost",
    });
    expect(records.some((record) => record.body?.["ev"] === "ack" && record.body["s"] === 1)).toBe(true);
    const node = session.document.surfaces.get("s:1")?.nodes.get("big");
    expect(node?.p["text"]).toBe(big);
    // 批次里的消息和文档一致（被拒的 op 在渲染进程那边也一样被拒）。
    const rebuilt = replayBatches(batches);
    expect(rebuilt.surfaces.get("s:1")?.nodes.get("big")?.p["text"]).toBe(big);
    // OSC：会话文件（base64 里是中文和空格）和标题。
    expect(sessionFiles).toEqual([sessionFile]);
    expect(titles).toContain("标题 title");
  }, 60_000);

  it("OSC 7 / 7501 / 不带 = 的 SetUserVar 回调给调用方（假 omp 回放 osc 行）", async () => {
    const fixture = path.join(scratch, "osc.jsonl");
    const cwdUri = "file://HOST/C:/Users/某人/omp%20work/%E7%9B%AE%E5%BD%95%20two";
    const entries = [
      { t: 0, dir: "out", verb: "o", body: { id: "s:1", mode: "inline" } },
      { t: 1, dir: "out", verb: "osc", body: `7;${cwdUri}` },
      { t: 2, dir: "out", verb: "osc", body: "7501;state=working:app=omp" },
      { t: 3, dir: "out", verb: "osc", body: "1337;SetUserVar=omp_session_file" },
      {
        t: 4,
        dir: "out",
        verb: "osc",
        body: `7501;state=error:app=omp:msg=${Buffer.from("出错了 boom").toString("base64")}`,
      },
    ];
    await writeFile(fixture, entries.map((entry) => JSON.stringify(entry)).join("\n"));
    const cwds: string[] = [];
    const statuses: unknown[] = [];
    const files: (string | null)[] = [];
    const { exit } = await run(fixture, {
      extraArgs: ["--exit-after-end"],
      session: {
        onCwd: (cwd) => cwds.push(cwd),
        onRunStatus: (status) => statuses.push(status),
        onSessionFile: (file) => files.push(file),
      },
    });
    await exit;
    // 盘符写法只在 Windows 上换成反斜杠路径（osc7.ts）。
    if (process.platform === "win32") expect(cwds).toEqual(["C:\\Users\\某人\\omp work\\目录 two"]);
    expect(statuses).toEqual([
      { state: "working", kind: null, msg: null },
      { state: "error", kind: null, msg: "出错了 boom" },
    ]);
    expect(files).toEqual([null]);
  }, 60_000);

  it("setAppearance：深浅主题和减少动效变了才给 omp 发 theme / motion 事件", async () => {
    const idle = path.join(scratch, "appearance.jsonl");
    await writeFile(idle, JSON.stringify({ t: 0, dir: "out", verb: "o", body: { id: "s:1", mode: "inline" } }) + "\n");
    const { session, log } = await run(idle);
    await session.ready;
    session.setAppearance({ dark: true, reduceMotion: false });
    session.setAppearance({ dark: false, reduceMotion: false });
    session.setAppearance({ dark: false, reduceMotion: true });
    const records = await waitForLog(log, (found) => found.some((record) => record.body?.["ev"] === "motion"));
    const events = records
      .filter((record) => record.body?.["ev"] === "theme" || record.body?.["ev"] === "motion")
      .map((record) => record.body);
    expect(events).toEqual([
      { ev: "theme", dark: false },
      { ev: "motion", reduce: true },
    ]);
    await session.close();
  }, 60_000);

  it("hello 回复之前的 resize / 外观变化不发事件，由 hello 回复带过去（omp 刚起来时写进 pty 的 APC 会被拆成按键）", async () => {
    const idle = path.join(scratch, "before-hello.jsonl");
    await writeFile(idle, JSON.stringify({ t: 0, dir: "out", verb: "o", body: { id: "s:1", mode: "inline" } }) + "\n");
    const { session, log } = await run(idle);
    session.resize(130);
    session.setAppearance({ dark: false, reduceMotion: true });
    await session.ready;
    session.resize(140);
    const records = await waitForLog(log, (found) => found.some((record) => record.body?.["ev"] === "resize"));
    expect(records.find((record) => record.body?.["r"] === "hello")?.body).toMatchObject({
      cols: 130,
      dark: false,
      reduceMotion: true,
    });
    const events = records.filter((record) => ["resize", "theme", "motion"].includes(String(record.body?.["ev"])));
    expect(events.map((record) => record.body)).toEqual([{ ev: "resize", cols: 140 }]);
    expect(records.filter((record) => record.kind === "keys")).toEqual([]);
    await session.close();
  }, 60_000);
});

describe("TspSession：操作和关闭", () => {
  it("按键、事件、resize 都写进伪终端；关闭结束进程，之后不能再写", async () => {
    const fixture = path.join(scratch, "idle.jsonl");
    await writeFile(
      fixture,
      JSON.stringify({ t: 0, dir: "out", verb: "o", body: { id: "s:1", mode: "inline" } }) + "\n",
    );
    const { session, exit, log } = await run(fixture);
    await session.ready;
    // 先等按键到达：它和紧跟着的 APC 事件可能被 pty 合成一个数据块，假 omp 就把含 APC 的块整个当事件处理了。
    session.sendKeys("\x1b");
    await waitForLog(log, (found) => found.some((record) => record.kind === "keys" && record.data === "\x1b"));
    session.sendEvent({ ev: "focus", sf: "s:1", id: "j.line/input" });
    session.resize(120);
    const records = await waitForLog(log, (found) => found.some((record) => record.body?.["ev"] === "resize"));
    expect(records.some((record) => record.body?.["ev"] === "focus" && record.body["id"] === "j.line/input")).toBe(
      true,
    );
    expect(records.find((record) => record.body?.["ev"] === "resize")?.body).toEqual({ ev: "resize", cols: 120 });

    await session.close();
    const result = await exit;
    expect(result.closing).toBe(true);
    expect(session.hasExited).toBe(true);
    expect(() => session.sendKeys("x")).toThrow(/exited/);
  }, 60_000);

  it("进程没进入 TSP 就退出：ready 以 TspExitedError 失败，带上它打在终端上的文字", async () => {
    counter += 1;
    const session = await TspSession.start({
      launch: {
        command: process.execPath,
        args: ["-e", "console.log('boom: no tsp here')"],
        cwd: scratch,
        env: buildTspEnv(process.env, "9.9.9"),
      },
      cols: 100,
      appVersion: "9.9.9",
      appearance: { dark: false, reduceMotion: false },
      assignJob: () => () => undefined,
      onBatch: () => undefined,
      onExit: () => undefined,
    });
    const failure = await session.ready.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TspExitedError);
    expect((failure as TspExitedError).exit.textTail).toContain("boom: no tsp here");
  }, 30_000);

  it("进程活着但一直不发 hello：超时后 ready 以 TspHandshakeError 失败，close() 能结束它", async () => {
    const session = await TspSession.start({
      launch: {
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 60000)"],
        cwd: scratch,
        env: buildTspEnv(process.env, "9.9.9"),
      },
      cols: 100,
      appVersion: "9.9.9",
      appearance: { dark: false, reduceMotion: false },
      assignJob: () => () => undefined,
      helloTimeoutMs: 300,
      onBatch: () => undefined,
      onExit: () => undefined,
    });
    await expect(session.ready).rejects.toBeInstanceOf(TspHandshakeError);
    await session.close();
    expect(session.hasExited).toBe(true);
  }, 30_000);
});
