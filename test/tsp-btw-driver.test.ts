// TSP 任务的旁路提问控制器（src/main/tasks/tsp-btw.ts）：一个"回放宿主"按 omp 18.12.5 的真实录制（btw.jsonl / btw-error.jsonl）回应事件——
// 和 fake-tsp-omp 一样：录制里用户的操作要逐字相同才会往下放帧，早到的事件留着等回放走到它（所以"回答收尾后自动关弹窗"这类
// 反应式事件即使比录制里的手动操作早发也行）。控制器发出的每个事件都必须能在录制里对上，对不上的留在 `leftover` 里，测试断言它为空。
// 磁盘上的话题（btw-history/entry-*.json）由测试在 omp "收到问题"那一刻写，和真实 omp 一样。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyBtwEvent, isBtwRunning, latestTurn, type BtwHistoryRecord, type BtwUiEvent } from "../src/shared/btw.ts";
import { applyMessage, createDocument, type TspDocMessage, type TspDocument } from "../src/shared/tsp/document.ts";
import type { TspEvent } from "../src/shared/tsp/tsp.generated.ts";
import { findBtwView } from "../src/shared/tsp/btw.ts";
import { BTW_STILL_RUNNING, TspBtw, type BtwHost } from "../src/main/tasks/tsp-btw.ts";
import { loadTspFixture } from "./tsp-fixtures.ts";

type Entry = { kind: "out"; message: TspDocMessage } | { kind: "in"; event: Record<string, unknown>; nth: number };

const ids = {
  pong: "15af3d5a2937f9fd",
  ping: "15af3d67d7b7f9ff",
  essay: "15af3d7a2c37fa00",
} as const;

let scratch: string;
beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio-btw-"));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

class ReplayHost implements BtwHost {
  readonly doc = createDocument();
  readonly accepted: Record<string, unknown>[] = [];
  readonly driving: boolean[] = [];
  readonly emitted: BtwUiEvent[] = [];
  readonly #entries: Entry[] = [];
  readonly #received: Record<string, unknown>[] = [];
  #pos = 0;
  #advancing = false;
  btw!: TspBtw;
  sessionFilePath: string | null = null;
  /** 控制器的事件被录制接受时调用（写磁盘上的话题）。 */
  onAccepted: (event: Record<string, unknown>) => Promise<void> | void = () => {};

  constructor(fixture: string, startAt: number) {
    let nth = 0;
    for (const line of loadTspFixture(fixture)) {
      if (line.dir === "in" && typeof line.body === "object" && line.body !== null) {
        const event = line.body as Record<string, unknown>;
        if (event["ev"] !== "ack") this.#entries.push({ kind: "in", event, nth: nth++ });
      } else if (line.dir === "out" && ["o", "f", "t", "x"].includes(line.verb)) {
        this.#entries.push({ kind: "out", message: { verb: line.verb, body: line.body } as TspDocMessage });
      }
    }
    while (this.#pos < this.#entries.length) {
      const entry = this.#entries[this.#pos]!;
      if (entry.kind === "in" && entry.nth === startAt) break;
      if (entry.kind === "out") applyMessage(this.doc, entry.message);
      this.#pos += 1;
    }
  }

  get leftover(): Record<string, unknown>[] {
    return this.#received;
  }

  #advance(): void {
    if (this.#advancing) return;
    this.#advancing = true;
    try {
      while (this.#pos < this.#entries.length) {
        const entry = this.#entries[this.#pos]!;
        if (entry.kind === "in") {
          const index = this.#received.findIndex((event) => isDeepStrictEqual(event, entry.event));
          if (index === -1) return;
          const [event] = this.#received.splice(index, 1);
          this.accepted.push(event!);
          void this.onAccepted(event!);
        } else {
          applyMessage(this.doc, entry.message);
          this.btw.sync(findBtwView(this.doc));
        }
        this.#pos += 1;
      }
    } finally {
      this.#advancing = false;
    }
  }

  // ───── BtwHost ─────

  document(): TspDocument {
    return this.doc;
  }

  sendEvent(event: TspEvent): void {
    this.#received.push(event as unknown as Record<string, unknown>);
    this.#advance();
  }

  awaitDocument<T>(check: (document: TspDocument) => T | null, _timeoutMs: number, message: string): Promise<T> {
    try {
      const value = check(this.doc);
      return value === null ? Promise.reject(new Error(message)) : Promise.resolve(value);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  composer(): Promise<{ sf: string; id: string }> {
    return Promise.resolve({ sf: "s:1", id: "j.line/input" });
  }

  exclusive<T>(job: () => Promise<T>): Promise<T> {
    return job();
  }

  sessionFile(): string | null {
    return this.sessionFilePath;
  }

  emit(event: BtwUiEvent): void {
    this.emitted.push(event);
  }

  setDriving(on: boolean): void {
    this.driving.push(on);
  }
}

function make(fixture: string, startAt: number, withDisk: boolean): ReplayHost {
  const host = new ReplayHost(fixture, startAt);
  host.btw = new TspBtw(host);
  if (withDisk) {
    const dir = path.join(scratch, `s-${Math.random().toString(36).slice(2)}`);
    host.sessionFilePath = `${dir}.jsonl`;
    host.onAccepted = async (event) => {
      const text = event["text"];
      const wanted =
        text === "/btw Reply with exactly the word: pong"
          ? (["pong", ids.pong, "pong"] as const)
          : text === "/btw Reply with exactly the word: ping"
            ? (["ping", ids.ping, "ping"] as const)
            : text === "/btw Write a 400 word essay about trees."
              ? (["essay", ids.essay, ""] as const)
              : null;
      if (!wanted) return;
      const history = path.join(dir, "btw-history");
      await mkdir(history, { recursive: true });
      const now = Date.now();
      const question = typeof text === "string" ? text.slice("/btw ".length) : "";
      await writeFile(
        path.join(history, `entry-${wanted[1]}.json`),
        JSON.stringify({
          question,
          answer: wanted[2],
          status: "running",
          createdAt: now,
          updatedAt: now,
          id: wanted[1],
          leafId: "leaf",
        }),
      );
    };
  }
  return host;
}

/** 渲染进程按事件推进的镜像（和 btw-store 同一条规则）。 */
function projection(host: ReplayHost): readonly BtwHistoryRecord[] {
  return host.emitted.reduce<readonly BtwHistoryRecord[]>((records, event) => applyBtwEvent(records, event), []);
}

/** 录制里终端发给 omp 的 ack（不是用户操作）。 */
const isAck = (body: unknown): boolean =>
  typeof body === "object" && body !== null && "ev" in body && body.ev === "ack";

const stripTimes = (records: readonly BtwHistoryRecord[]): unknown =>
  JSON.parse(JSON.stringify(records, (key, value: unknown) => (key === "updatedAt" ? 0 : value)));

describe("TspBtw · btw.jsonl（真实 omp，主轮运行中提问）", () => {
  it("提问 → 再问 → 对第一个话题追问 → 取消一个长回答：事件和录制逐字相同、话题 id 是磁盘上的真 id、镜像和渲染进程的投影一致", async () => {
    // startAt 1：跳过第一句主轮消息（它和旁路提问无关）。
    const host = make("btw", 1, true);
    const { btw } = host;

    const pong = await btw.ask("Reply with exactly the word: pong", undefined);
    expect(pong).toBe(ids.pong);
    expect(btw.records.map((record) => [record.id, record.status, record.answer])).toEqual([
      [ids.pong, "complete", "pong"],
    ]);
    // 收尾后自动关掉 omp 的弹窗。
    expect(host.accepted.map((event) => event["act"] ?? event["ev"])).toEqual(["send", "close"]);

    const ping = await btw.ask("Reply with exactly the word: ping", undefined);
    expect(ping).toBe(ids.ping);
    expect(btw.records.map((record) => record.id)).toEqual([ids.ping, ids.pong]);

    // 追问第一个话题：裸 /btw 打开历史（选中的是最新的 ping）→ select pong → follow-up → edit → send。
    expect(await btw.ask("Say gamma", ids.pong)).toBe(ids.pong);
    const first = btw.records.find((record) => record.id === ids.pong)!;
    expect(first.followUps).toHaveLength(1);
    expect(first.followUps![0]).toMatchObject({ question: "Say gamma", answer: "gamma", status: "complete" });
    expect(host.accepted.map((event) => event["act"] ?? event["ev"])).toEqual([
      "send",
      "close",
      "send",
      "close",
      "send",
      "select",
      "follow-up",
      "edit",
      "send",
      "close",
    ]);

    // 长回答：提问返回时还在回答中；再问会被拒绝；cancel 的 recordId 不对 → false；点 stop → 已取消，之后自动关弹窗。
    const essay = await btw.ask("Write a 400 word essay about trees.", undefined);
    expect(essay).toBe(ids.essay);
    expect(isBtwRunning(btw.records)).toBe(true);
    expect(latestTurn(btw.records[0]!).answer.startsWith("# Trees")).toBe(true);
    await expect(btw.ask("another", undefined)).rejects.toThrow(BTW_STILL_RUNNING);
    expect(btw.cancel(ids.pong)).toBe(false);
    expect(btw.cancel(undefined)).toBe(true);
    expect(btw.records[0]).toMatchObject({ id: ids.essay, status: "cancelled" });
    expect(isBtwRunning(btw.records)).toBe(false);
    expect(btw.cancel(undefined)).toBe(false);

    const recorded = loadTspFixture("btw")
      .filter((line) => line.dir === "in" && !isAck(line.body))
      .slice(1)
      .map((line) => line.body);
    expect(host.accepted).toEqual(recorded);
    expect(host.leftover).toEqual([]);
    expect(host.driving).toEqual([true, false, true, false, true, false, true, false]);
    // 渲染进程按事件推进出来的镜像等于主进程的（delta 不带 updatedAt，别的字段一致）。
    expect(stripTimes(projection(host))).toEqual(stripTimes(btw.records));
    expect(host.emitted.some((event) => event.type === "delta")).toBe(true);
  });

  it("history()：读会话旁边的 btw-history，没问过（目录不存在）是空；临时 id 没有磁盘记录时保持临时", async () => {
    const host = make("btw", 1, false);
    expect(await host.btw.history()).toEqual([]);
    const pong = await host.btw.ask("Reply with exactly the word: pong", undefined);
    // 没有会话文件：用临时 id，不空等。
    expect(pong).toMatch(/^live:\d+$/);
    expect(host.btw.records[0]).toMatchObject({ id: pong, status: "complete", answer: "pong", leafId: null });
  });

  it("不认识的话题 / 空问题：本地拒绝，不给 omp 发任何事件", async () => {
    const host = make("btw", 1, false);
    await expect(host.btw.ask("hi", "nope")).rejects.toThrow("Unknown /btw topic: nope");
    await expect(host.btw.ask("   ", undefined)).rejects.toThrow("btw requires a non-empty question");
    expect(host.accepted).toEqual([]);
    expect(host.leftover).toEqual([]);
    expect(host.driving).toEqual([]);
  });

  it("omp 没有打开弹窗（比如被拒绝）：以明确的错误 reject，驱动标志复位", async () => {
    const host = make("btw", 1, false);
    // 这条问题和录制里的不同：录制不会为它放弹窗的帧。
    await expect(host.btw.ask("something else", undefined)).rejects.toThrow("omp did not open the side question");
    expect(host.driving).toEqual([true, false]);
    expect(host.leftover).toEqual([{ ev: "send", sf: "s:1", id: "j.line/input", text: "/btw something else" }]);
  });

  it("进程退出：还在回答的一问标成 interrupted 并推 records", async () => {
    // startAt 11：直接从录制里长回答的那次提问开始。
    const host = make("btw", 11, false);
    await host.btw.ask("Write a 400 word essay about trees.", undefined);
    expect(isBtwRunning(host.btw.records)).toBe(true);
    host.btw.reset();
    expect(host.btw.records[0]).toMatchObject({ status: "interrupted" });
    expect(host.emitted.at(-1)).toMatchObject({ type: "records" });
  });
});

describe("TspBtw · btw-stop.jsonl（真实 omp，回答中停止）", () => {
  it("yieldToMain：回答中的旁路提问 stop → close → 等弹窗撤掉；没有弹窗时什么也不发", async () => {
    // startAt 2：录制里第三个用户操作（stop）之前，弹窗正在流式回答。
    const host = make("btw-stop", 2, false);
    expect(findBtwView(host.doc)?.turns[0]).toMatchObject({ status: "running" });
    await host.btw.yieldToMain();
    expect(host.accepted.map((event) => event["act"])).toEqual(["stop", "close"]);
    expect(findBtwView(host.doc)).toBeNull();
    expect(host.leftover).toEqual([]);
    const before = host.accepted.length;
    await host.btw.yieldToMain();
    expect(host.accepted).toHaveLength(before);
  });
});

describe("TspBtw · btw-error.jsonl（无效 API key）", () => {
  it("提问失败：状态 error、带 omp 的错误文字，仍然自动关弹窗；对失败的话题追问：再开历史、填字、发送，第二问也是 error", async () => {
    const host = make("btw-error", 0, false);
    const id = await host.btw.ask("Reply with exactly the word: pong", undefined);
    expect(host.btw.records[0]).toMatchObject({ id, status: "error" });
    expect(host.btw.records[0]!.error).toMatch(/^401 Authentication Fails/);
    expect(await host.btw.ask("again", id)).toBe(id);
    const record = host.btw.records[0]!;
    expect(record.followUps).toHaveLength(1);
    expect(record.followUps![0]).toMatchObject({ question: "again", status: "error" });
    expect(host.accepted.map((event) => event["act"] ?? event["ev"])).toEqual([
      "send",
      "close",
      "send",
      "follow-up",
      "edit",
      "send",
      "close",
    ]);
    expect(host.leftover).toEqual([]);
  });
});
