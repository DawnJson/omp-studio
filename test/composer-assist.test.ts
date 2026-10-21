import { describe, expect, it } from "vitest";
import type { AvailableSlashCommand } from "../src/shared/omp-wire/rpc-wire.generated.ts";
import type { TaskId } from "../src/shared/ipc.ts";
import { applyFileCompletion, atReference } from "../src/renderer/src/features/composer/file-complete.ts";
import {
  MAX_HISTORY,
  cycleHistory,
  hasHistory,
  pushEntry,
  recordSent,
  shouldCycle,
  stepHistory,
} from "../src/renderer/src/features/composer/input-history.ts";
import { decideSlashSend, leadingSlashName } from "../src/renderer/src/features/composer/slash-guard.ts";
import { matchSlash } from "../src/renderer/src/features/composer/slash-match.ts";

const commands: AvailableSlashCommand[] = [
  { name: "compact", source: "builtin", aliases: ["c"] },
  { name: "model", source: "builtin" },
];

describe("斜杠守卫", () => {
  it("提取开头的 /名称；路径和普通文字不算", () => {
    expect(leadingSlashName("/plan")).toBe("plan");
    expect(leadingSlashName("  /plan do it")).toBe("plan");
    expect(leadingSlashName("/usr/bin/ls")).toBeNull();
    expect(leadingSlashName("hi /plan")).toBeNull();
    expect(leadingSlashName("/")).toBeNull();
  });
  it("列表里有（含别名、不分大小写）放行", () => {
    expect(decideSlashSend("/compact", commands)).toEqual({ kind: "send" });
    expect(decideSlashSend("/C now", commands)).toEqual({ kind: "send" });
    expect(decideSlashSend("hello", commands)).toEqual({ kind: "send" });
  });
  it("列表里没有：终端独有的命令标 terminal，其余未知命令只提示", () => {
    expect(decideSlashSend("/plan", commands)).toEqual({ kind: "warn", name: "plan", terminal: true });
    expect(decideSlashSend("/Hotkeys x", commands)).toEqual({ kind: "warn", name: "Hotkeys", terminal: true });
    expect(decideSlashSend("/nope", commands)).toEqual({ kind: "warn", name: "nope", terminal: false });
  });
  it("命令列表还没载入（空）时不拦", () => {
    expect(decideSlashSend("/plan", [])).toEqual({ kind: "send" });
  });
});

describe("斜杠菜单不再截断到 8 条", () => {
  it("匹配全部命令，由菜单滚动", () => {
    const many: AvailableSlashCommand[] = Array.from({ length: 20 }, (_, i) => ({
      name: `cmd${i}`,
      source: "builtin" as const,
    }));
    expect(matchSlash(many, "cmd")).toHaveLength(20);
  });
});

describe("输入历史", () => {
  it("pushEntry：空的、与上一条相同的不记，超限丢最旧", () => {
    expect(pushEntry([], "  ")).toEqual([]);
    expect(pushEntry(["a"], "a")).toEqual(["a"]);
    expect(pushEntry(["a"], " b ")).toEqual(["a", "b"]);
    const full = Array.from({ length: MAX_HISTORY }, (_, i) => `m${i}`);
    const next = pushEntry(full, "new");
    expect(next).toHaveLength(MAX_HISTORY);
    expect(next[0]).toBe("m1");
    expect(next.at(-1)).toBe("new");
  });

  it("stepHistory：最新的在前，翻过最新一条放回草稿，到最旧停住", () => {
    const entries = ["one", "two", "three"];
    const s1 = stepHistory(entries, null, "draft", "up");
    expect(s1).toEqual({ text: "three", cursor: { index: 2, stash: "draft" } });
    const s2 = stepHistory(entries, s1?.cursor ?? null, "three", "up");
    expect(s2?.text).toBe("two");
    const s3 = stepHistory(entries, s2?.cursor ?? null, "two", "up");
    expect(s3?.text).toBe("one");
    expect(stepHistory(entries, s3?.cursor ?? null, "one", "up")).toBeNull();
    const back = stepHistory(entries, s3?.cursor ?? null, "one", "down");
    expect(back?.text).toBe("two");
    const top = stepHistory(entries, { index: 2, stash: "draft" }, "three", "down");
    expect(top).toEqual({ text: "draft", cursor: null });
    expect(stepHistory(entries, null, "x", "down")).toBeNull();
    expect(stepHistory([], null, "", "up")).toBeNull();
  });

  it("shouldCycle：没在翻看时只有空框或光标在最开头的 ↑；翻看中要光标在首/末行", () => {
    expect(shouldCycle("up", "", 0, false, true)).toBe(true);
    expect(shouldCycle("up", "abc", 0, false, true)).toBe(true);
    expect(shouldCycle("up", "abc", 3, false, true)).toBe(false);
    expect(shouldCycle("down", "", 0, false, true)).toBe(false);
    expect(shouldCycle("up", "", 0, false, false)).toBe(false);
    expect(shouldCycle("up", "a\nb", 3, true, true)).toBe(false);
    expect(shouldCycle("up", "a\nb", 1, true, true)).toBe(true);
    expect(shouldCycle("down", "a\nb", 0, true, true)).toBe(false);
    expect(shouldCycle("down", "a\nb", 3, true, true)).toBe(true);
  });

  it("按任务记：发送追加，cycleHistory 走完后恢复草稿", () => {
    const id = "history-task" as TaskId;
    expect(hasHistory(id)).toBe(false);
    recordSent(id, "second");
    recordSent(id, "third");
    expect(hasHistory(id)).toBe(true);
    expect(cycleHistory(id, "wip", "up")).toBe("third");
    expect(cycleHistory(id, "third", "up")).toBe("second");
    expect(cycleHistory(id, "second", "down")).toBe("third");
    expect(cycleHistory(id, "third", "down")).toBe("wip");
    expect(cycleHistory(id, "wip", "down")).toBeNull();
    expect(hasHistory("other-task" as TaskId)).toBe(false);
  });
});

describe("@ 文件引用补全", () => {
  it("光标前的词以 @ 开头（文本开头或空白之后）才算", () => {
    expect(atReference("@src/ma", 7)).toEqual({ start: 0, query: "src/ma" });
    expect(atReference("look at @a", 10)).toEqual({ start: 8, query: "a" });
    expect(atReference("look at @", 9)).toEqual({ start: 8, query: "" });
    expect(atReference("mail a@b.com", 12)).toBeNull();
    expect(atReference("@a done", 7)).toBeNull();
    expect(atReference("@a rest", 2)).toEqual({ start: 0, query: "a" });
  });
  it("插入 @路径 加空格，光标落在后面；替换光标后残留的半个词", () => {
    const text = "see @sr tail";
    const ref = atReference(text, 7);
    expect(ref).not.toBeNull();
    if (!ref) return;
    expect(applyFileCompletion(text, 7, ref, "src/a.ts")).toEqual({ text: "see @src/a.ts tail", caret: 14 });
    expect(applyFileCompletion("see @sr", 7, { start: 4, query: "sr" }, "src/a.ts")).toEqual({
      text: "see @src/a.ts ",
      caret: 14,
    });
    const mid = "see @srXYZ tail";
    const midRef = atReference(mid, 7);
    if (midRef) expect(applyFileCompletion(mid, 7, midRef, "src/a.ts").text).toBe("see @src/a.ts tail");
  });
});
