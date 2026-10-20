// TSP 测试共用：读 omp 自己录的 fixtures/tsp/<名字>.jsonl，按录制顺序拿到会改文档的消息。
import { readFileSync } from "node:fs";
import path from "node:path";
import type { TspDocMessage } from "../src/shared/tsp/document.ts";

export interface TspRecordLine {
  t: number;
  dir: "out" | "in";
  verb: string;
  params?: Record<string, string>;
  body: unknown;
}

export const tspFixtureDir = path.resolve(import.meta.dirname, "..", "fixtures", "tsp");

export function loadTspFixture(name: string): TspRecordLine[] {
  return readFileSync(path.join(tspFixtureDir, `${name}.jsonl`), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as TspRecordLine);
}

/** `out` 里 o / t / f / x / b 消息（按录制顺序）和它们的录制时间。 */
export function tspDocMessages(lines: readonly TspRecordLine[]): { t: number; message: TspDocMessage }[] {
  const out: { t: number; message: TspDocMessage }[] = [];
  for (const line of lines) {
    if (line.dir !== "out") continue;
    if (line.verb === "b")
      out.push({
        t: line.t,
        message: {
          verb: "b",
          id: line.params?.["id"] ?? "",
          mime: line.params?.["mime"] ?? null,
          data: String(line.body),
        },
      });
    else if (line.verb === "o" || line.verb === "f" || line.verb === "t" || line.verb === "x")
      out.push({ t: line.t, message: { verb: line.verb, body: line.body } as TspDocMessage });
  }
  return out;
}

/** 录制里终端发给 omp 的、不是 ack 的事件（用户操作）。 */
export function recordedUserEvents(lines: readonly TspRecordLine[]): { t: number; event: Record<string, unknown> }[] {
  const out: { t: number; event: Record<string, unknown> }[] = [];
  for (const line of lines) {
    if (line.dir !== "in" || typeof line.body !== "object" || line.body === null) continue;
    const event = line.body as Record<string, unknown>;
    if (event["ev"] !== "ack") out.push({ t: line.t, event });
  }
  return out;
}

/** 把一条 TSP 消息编成 pty 上的 APC 字节（params 按 `k=v;` 排在 body 前面）。 */
export function apc(verb: string, body: string, params: Record<string, string> = {}): Buffer {
  const head = Object.entries(params)
    .map(([key, value]) => `${key}=${value};`)
    .join("");
  return Buffer.from(`\x1b_tsp;${verb};${head}${body}\x1b\\`, "utf8");
}
