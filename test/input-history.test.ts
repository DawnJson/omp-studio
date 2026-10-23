// 输入历史（studio 自己持久化）：落盘按项目分开、重启（新实例）读得回来、条数和单条长度有上限、路径带空格和中文；Ctrl+R 的搜索规则。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_HISTORY, MAX_HISTORY_CHARS, pushEntry, searchHistory } from "../src/shared/input-history.ts";
import { InputHistoryStore } from "../src/main/tasks/input-history-store.ts";

describe("pushEntry", () => {
  it("空的、与上一条相同的、太长的不记；超限丢最旧", () => {
    expect(pushEntry([], "  ")).toEqual([]);
    expect(pushEntry(["a"], "a")).toEqual(["a"]);
    expect(pushEntry(["a"], " b ")).toEqual(["a", "b"]);
    expect(pushEntry(["a"], "x".repeat(MAX_HISTORY_CHARS + 1))).toEqual(["a"]);
    const full = Array.from({ length: MAX_HISTORY }, (_, i) => `m${i}`);
    const next = pushEntry(full, "new");
    expect(next).toHaveLength(MAX_HISTORY);
    expect(next[0]).toBe("m1");
    expect(next.at(-1)).toBe("new");
  });
});

describe("searchHistory（Ctrl+R）", () => {
  const entries = ["fix the login bug", "write README", "Fix Login redirect", "fix the login bug", "/compact"];
  it("最新的在前，同一条只留最新的；空查询返回全部", () => {
    expect(searchHistory(entries, "")).toEqual(["/compact", "fix the login bug", "Fix Login redirect", "write README"]);
  });
  it("不分大小写，每个词都要出现，顺序随意", () => {
    expect(searchHistory(entries, "LOGIN fix")).toEqual(["fix the login bug", "Fix Login redirect"]);
    expect(searchHistory(entries, "redirect login")).toEqual(["Fix Login redirect"]);
    expect(searchHistory(entries, "nothing")).toEqual([]);
  });
  it("中文也按子串匹配", () => {
    expect(searchHistory(["修复登录问题", "写文档"], "登录")).toEqual(["修复登录问题"]);
  });
});

describe("InputHistoryStore", () => {
  let dir: string;
  let file: string;
  beforeEach(async () => {
    // 路径带空格和中文。
    dir = await mkdtemp(path.join(os.tmpdir(), "omp studio 输入历史 "));
    file = path.join(dir, "用户 数据", "input-history.json");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  });

  it("按项目分开记；新实例（重启）读得回来；重复的不记", async () => {
    const store = new InputHistoryStore(file);
    await store.record("p1", "第一条");
    await store.record("p1", "第一条");
    await store.record("p1", "second");
    await store.record("p2", "other project");
    expect(await store.get("p1")).toEqual(["第一条", "second"]);
    expect(await store.get("p2")).toEqual(["other project"]);
    expect(await store.get("nope")).toEqual([]);
    const reopened = new InputHistoryStore(file);
    expect(await reopened.get("p1")).toEqual(["第一条", "second"]);
  });

  it("每个项目最多 MAX_HISTORY 条：丢最旧的；落盘的就是这些", async () => {
    const store = new InputHistoryStore(file);
    for (let i = 0; i < MAX_HISTORY + 5; i++) await store.record("p", `msg ${i}`);
    const saved = JSON.parse(await readFile(file, "utf8")) as Record<string, string[]>;
    expect(saved["p"]).toHaveLength(MAX_HISTORY);
    expect(saved["p"]?.[0]).toBe("msg 5");
    expect(saved["p"]?.at(-1)).toBe(`msg ${MAX_HISTORY + 4}`);
  });

  it("单条太长（整段粘贴）、空白不记，也不写文件", async () => {
    const store = new InputHistoryStore(file);
    await store.record("p", "x".repeat(MAX_HISTORY_CHARS + 1));
    await store.record("p", "   ");
    expect(await store.get("p")).toEqual([]);
    await expect(readFile(file, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("文件里形状不对的项目（不是字符串数组）被忽略，好的照读", async () => {
    await store0(file, JSON.stringify({ bad: [1, 2], worse: "x", good: ["a", "b"] }));
    const store = new InputHistoryStore(file);
    expect(await store.get("bad")).toEqual([]);
    expect(await store.get("good")).toEqual(["a", "b"]);
  });

  it("文件损坏（不是 JSON）时读取报错，不会被下一次保存悄悄覆盖成空的", async () => {
    await store0(file, "{ not json");
    const store = new InputHistoryStore(file);
    await expect(store.get("p")).rejects.toThrow();
    await expect(store.record("p", "x")).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("{ not json");
  });
});

async function store0(target: string, content: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}
