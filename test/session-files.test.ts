// 会话文件的共用读取（src/main/tsp/session-files.ts）：任务 runner（token 合计、脚注）和按模型用量查同一个文件时
// 共用一个读取器，每行只 JSON.parse 一次；结果和各自整份文本解析的一样（fixtures/omp-session，omp 18.12.5 真实产出）。
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeSessionUsage } from "../src/main/history/session-usage.ts";
import { parseSession } from "../src/main/tsp/session-extras.ts";
import { holdSessionFile, readSessionFile, readSessionUsage } from "../src/main/tsp/session-files.ts";

const fixtures = path.resolve(import.meta.dirname, "..", "fixtures", "omp-session");

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "omp 会话 共用读取 "));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** 读取期间解析了几行会话文件（别的 JSON.parse 不算）。 */
function parsedLines(parse: { mock: { calls: unknown[][] } }, lines: readonly string[]): number {
  return parse.mock.calls.filter(([line]) => lines.includes(String(line))).length;
}

describe("会话文件的共用读取", () => {
  for (const name of ["branched", "compacted"]) {
    it(`${name}：runner 和用量共用一遍读取，追加后只解析新的行，结果不变`, async () => {
      const lines = (await readFile(path.join(fixtures, `${name}.jsonl`), "utf8")).trimEnd().split("\n");
      const texts = [lines.slice(0, 6).join("\n"), lines.join("\n")];
      // 开始数 JSON.parse 之前先算好各自整份文本解析的结果。
      const wanted = texts.map((text) => ({ usage: summarizeSessionUsage(text), extras: parseSession(text) }));
      const file = path.join(dir, `${name}.jsonl`);
      await writeFile(file, `${texts[0]}\n`, "utf8");
      const release = holdSessionFile(file);
      const parse = vi.spyOn(JSON, "parse");

      const results = [];
      for (const [index, count] of [6, lines.length].entries()) {
        if (index === 1) await appendFile(file, `${lines.slice(6).join("\n")}\n`, "utf8");
        const runner = await readSessionFile(file);
        results.push({
          runner: { usage: runner.usage.summary(), extras: runner.extras.result() },
          usage: await readSessionUsage(file),
        });
        expect(parsedLines(parse, lines)).toBe(count);
      }
      release();

      results.forEach((result, index) => {
        expect(result.runner).toEqual(wanted[index]);
        expect(result.usage).toEqual(wanted[index]!.usage);
      });
    });
  }

  it("任务占住的文件不被别的文件挤出缓存：再查不从头读", async () => {
    const text = await readFile(path.join(fixtures, "linear.jsonl"), "utf8");
    const lines = text.trimEnd().split("\n");
    const want = summarizeSessionUsage(text);
    const held = path.join(dir, "任务的.jsonl");
    await writeFile(held, text, "utf8");
    const release = holdSessionFile(held);
    await readSessionUsage(held);
    for (let index = 0; index < 6; index++) {
      const other = path.join(dir, `别的-${index}.jsonl`);
      await writeFile(other, text, "utf8");
      await readSessionUsage(other);
    }
    const parse = vi.spyOn(JSON, "parse");
    const usage = await readSessionUsage(held);
    expect(parsedLines(parse, lines)).toBe(0);
    release();
    expect(usage).toEqual(want);
  });
});
