// 会话旁边的 btw-history/ 读取（src/main/tsp/btw-history.ts）：目录布局和文件内容是 omp 18.12.5 实测的
// （`<会话文件去掉 .jsonl>/btw-history/entry-<话题 id>.json`）。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { btwLimits } from "../src/shared/btw.ts";
import { BTW_ENTRY_MAX_BYTES } from "../src/shared/tsp/btw.ts";
import { btwHistoryDir, readBtwHistory } from "../src/main/tsp/btw-history.ts";

let scratch: string;
beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio-btw-history-"));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const entry = (id: string, createdAt: number, extra: object = {}): string =>
  JSON.stringify({
    question: `q ${id}`,
    answer: "a",
    status: "complete",
    createdAt,
    updatedAt: createdAt,
    id,
    leafId: "leaf",
    ...extra,
  });

describe("readBtwHistory", () => {
  it("会话文件 → btw-history 目录；不是 .jsonl 没有目录", () => {
    expect(btwHistoryDir(path.join("x", "2026_abc.jsonl"))).toBe(path.join("x", "2026_abc", "btw-history"));
    expect(btwHistoryDir("x/session.json")).toBeNull();
    return expect(readBtwHistory("x/session.json")).resolves.toEqual([]);
  });

  it("没问过（目录不存在）是空；读出来从新到旧，别的文件和坏文件跳过，不挡住好的", async () => {
    const file = path.join(scratch, "a.jsonl");
    expect(await readBtwHistory(file)).toEqual([]);
    const dir = path.join(scratch, "a", "btw-history");
    await mkdir(path.join(dir, "sessions"), { recursive: true });
    await writeFile(path.join(dir, "entry-old.json"), entry("old", 1));
    await writeFile(
      path.join(dir, "entry-new.json"),
      entry("new", 3, { followUps: [{ question: "f", answer: "g", status: "complete", createdAt: 4, updatedAt: 4 }] }),
    );
    await writeFile(path.join(dir, "entry-broken.json"), "{ not json");
    await writeFile(path.join(dir, "entry-huge.json"), entry("huge", 2, { answer: "x".repeat(BTW_ENTRY_MAX_BYTES) }));
    await writeFile(path.join(dir, "notes.txt"), "ignored");
    const records = await readBtwHistory(file);
    expect(records.map((record) => record.id)).toEqual(["new", "old"]);
    expect(records[0]!.followUps).toHaveLength(1);
  });

  it("最多读最新的 btwLimits.records 个", async () => {
    const file = path.join(scratch, "b.jsonl");
    const dir = path.join(scratch, "b", "btw-history");
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < btwLimits.records + 3; i += 1)
      await writeFile(path.join(dir, `entry-${i}.json`), entry(String(i), i));
    const records = await readBtwHistory(file);
    expect(records).toHaveLength(btwLimits.records);
    expect(records[0]!.id).toBe(String(btwLimits.records + 2));
  });
});
