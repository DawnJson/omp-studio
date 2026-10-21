// 子代理面板对 omp Agent Hub 的后台驱动（src/main/tasks/tsp-hub-driver.ts）：一个"回放宿主"按 omp 18.12.5 的真实录制
// （hub-steer.jsonl / hub-kill.jsonl）回应事件——驱动发出的事件必须和录制里用户的操作逐字相同才会往下放帧，
// 退出手势（Esc 键 / 聚焦行的 focus:Main）才会放出"关 Hub / 退出聚焦"的那几帧（和真实 omp 一样，不发就一直开着）。
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { findAgentHub, findFocus } from "../src/shared/tsp/agent-hub.ts";
import { applyMessage, createDocument, type TspDocMessage, type TspDocument } from "../src/shared/tsp/document.ts";
import type { TspEvent } from "../src/shared/tsp/tsp.generated.ts";
import { HUB_RESTORE_FAILED, HubDriver, type HubHost } from "../src/main/tasks/tsp-hub-driver.ts";
import { loadTspFixture } from "./tsp-fixtures.ts";

type Entry =
  { kind: "out"; message: TspDocMessage; gated: boolean } | { kind: "in"; event: Record<string, unknown>; nth: number };

/** 回放宿主：`startAt` = 从第几个用户操作（含第一句话，0 起）之前开始，之前的帧全部已应用。`gateIds` 里的节点被删的那些帧要等退出手势。 */
class ReplayHost implements HubHost {
  readonly doc = createDocument();
  readonly accepted: Record<string, unknown>[] = [];
  readonly ignored: Record<string, unknown>[] = [];
  readonly keys: string[] = [];
  readonly driving: boolean[] = [];
  readonly #entries: Entry[] = [];
  #pos = 0;
  #released = false;

  constructor(fixture: string, startAt: number, gateIds: readonly string[]) {
    let nth = 0;
    for (const line of loadTspFixture(fixture)) {
      if (line.dir === "in" && typeof line.body === "object" && line.body !== null) {
        const event = line.body as Record<string, unknown>;
        if (event["ev"] !== "ack") this.#entries.push({ kind: "in", event, nth: nth++ });
      } else if (line.dir === "out" && ["o", "f", "t", "x"].includes(line.verb)) {
        const gated = line.verb === "f" && gateIds.some((id) => JSON.stringify(line.body).includes(`["del","${id}"]`));
        this.#entries.push({ kind: "out", message: { verb: line.verb, body: line.body } as TspDocMessage, gated });
      }
    }
    while (this.#pos < this.#entries.length) {
      const entry = this.#entries[this.#pos]!;
      if (entry.kind === "in" && entry.nth === startAt) break;
      if (entry.kind === "out") applyMessage(this.doc, entry.message);
      this.#pos += 1;
    }
    expect(this.#pos).toBeLessThan(this.#entries.length);
  }

  /** 放帧直到下一个录制的用户操作（或被 gate 住的帧）。 */
  #advance(untilEnd = false): void {
    while (this.#pos < this.#entries.length) {
      const entry = this.#entries[this.#pos]!;
      if (entry.kind === "in") {
        if (!untilEnd) return;
      } else {
        if (entry.gated && !this.#released) return;
        applyMessage(this.doc, entry.message);
      }
      this.#pos += 1;
    }
  }

  document(): TspDocument {
    return this.doc;
  }

  sendEvent(event: TspEvent): void {
    const next = this.#entries[this.#pos];
    if (next?.kind === "in" && isDeepStrictEqual(next.event, event)) {
      this.accepted.push(event as unknown as Record<string, unknown>);
      this.#pos += 1;
      this.#advance();
      return;
    }
    this.ignored.push(event as unknown as Record<string, unknown>);
    if (event.ev === "action" && event.act === "focus:Main") this.#exit();
  }

  sendKeys(data: string): void {
    this.keys.push(data);
    if (data === "\x1b") this.#exit();
  }

  #exit(): void {
    this.#released = true;
    this.#advance(true);
  }

  awaitDocument<T>(check: (document: TspDocument) => T | null, _timeoutMs: number, message: string): Promise<T> {
    try {
      const value = check(this.doc);
      return value === null ? Promise.reject(new Error(message)) : Promise.resolve(value);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  exclusive<T>(job: () => Promise<T>): Promise<T> {
    return job();
  }

  setDriving(on: boolean): void {
    this.driving.push(on);
  }
}

const STEER_TEXT = "Also say PINEAPPLE in your final reply.";

describe("HubDriver · hub-steer.jsonl", () => {
  it("插话：agents.open → activate → 聚焦 → send，事件和录制逐字相同；然后用 focus:Main 退出聚焦，输入框恢复", async () => {
    const host = new ReplayHost("hub-steer", 1, ["j.focus"]);
    await new HubDriver(host).steer("Beta", STEER_TEXT);
    expect(host.accepted).toEqual([
      { ev: "action", sf: "s:1", id: "3.running/agents", act: "agents.open" },
      { ev: "activate", sf: "s:1", id: "w", item: "Beta" },
      { ev: "send", sf: "s:1", id: "j.line/input", text: STEER_TEXT },
    ]);
    expect(host.ignored).toEqual([{ ev: "action", sf: "s:1", id: "j.focus/exit", act: "focus:Main" }]);
    expect(host.keys).toEqual([]);
    expect(findFocus(host.doc)).toBeNull();
    expect(findAgentHub(host.doc)).toBeNull();
    expect(host.driving).toEqual([true, false]);
  });

  it("不是文档里的子代理（含路径）：拒绝，不碰 omp", async () => {
    const host = new ReplayHost("hub-steer", 1, ["j.focus"]);
    const driver = new HubDriver(host);
    for (const name of ["Gamma", "../x", ""])
      await expect(driver.steer(name, "hi")).rejects.toThrow(/unknown subagent/);
    expect(host.accepted).toEqual([]);
    expect(host.ignored).toEqual([]);
    expect(host.driving).toEqual([]);
  });

  it("恢复运行中的子代理：用 omp 给的禁用原因 reject，并把 Hub 用 Esc 关掉", async () => {
    const host = new ReplayHost("hub-steer", 1, ["j.focus"]);
    await expect(new HubDriver(host).revive("Beta")).rejects.toThrow("Only parked or killed agents can be revived");
    expect(host.keys).toEqual(["\x1b"]);
    expect(findAgentHub(host.doc)).toBeNull();
    expect(host.driving).toEqual([true, false]);
  });

  it("聚焦退出不了：失败时给明确的恢复错误（不吞），标志照常复位", async () => {
    const host = new ReplayHost("hub-steer", 1, ["j.focus"]);
    // 退出手势一律无效：把 #exit 放帧的效果去掉（模拟 omp 没反应）。
    host.sendKeys = (data) => void host.keys.push(data);
    const originalSend = host.sendEvent.bind(host);
    host.sendEvent = (event) => {
      if (event.ev === "action" && event.act === "focus:Main") {
        host.ignored.push(event as unknown as Record<string, unknown>);
        return;
      }
      originalSend(event);
    };
    await expect(new HubDriver(host).steer("Beta", STEER_TEXT)).rejects.toThrow(HUB_RESTORE_FAILED);
    expect(host.keys).toEqual(["\x1b"]);
    expect(host.driving).toEqual([true, false]);
  });
});

describe("HubDriver · hub-kill.jsonl（真实 omp）", () => {
  it("结束：agents.open → select → kill，事件和录制逐字相同；没有确认框；Hub 用 Esc 关掉", async () => {
    const host = new ReplayHost("hub-kill", 1, ["u"]);
    await new HubDriver(host).kill("Beta");
    expect(host.accepted.map((event) => [event["ev"], event["act"] ?? event["item"]])).toEqual([
      ["action", "agents.open"],
      ["select", "Beta"],
      ["action", "kill"],
    ]);
    expect(host.ignored).toEqual([]);
    expect(host.keys).toEqual(["\x1b"]);
    expect(findAgentHub(host.doc)).toBeNull();
  });

  it("恢复：Hub 已开着且选中 Beta（上一次操作没关）时直接发 revive，之后 Esc", async () => {
    const host = new ReplayHost("hub-kill", 5, ["u"]);
    await new HubDriver(host).revive("Beta");
    expect(host.accepted).toEqual([{ ev: "action", sf: "s:1", id: "u", act: "revive" }]);
    expect(host.keys).toEqual(["\x1b"]);
    expect(findAgentHub(host.doc)).toBeNull();
  });
});
