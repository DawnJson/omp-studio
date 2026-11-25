import { describe, expect, it } from "vitest";
import { cycleTab, keepExisting, moveTab, withoutTabs, withTab } from "../src/renderer/src/features/tabs/task-tabs.ts";

describe("任务标签列表", () => {
  it("选中已开着的任务不动列表，新的加在最右", () => {
    const tabs = ["a", "b"];
    expect(withTab(tabs, "a")).toBe(tabs);
    expect(withTab(tabs, "c")).toEqual(["a", "b", "c"]);
  });

  it("Ctrl Tab 首尾相接；在草稿上时右到第一个、左到最后一个；没有标签时不动", () => {
    expect(cycleTab(["a", "b", "c"], "c", 1)).toBe("a");
    expect(cycleTab(["a", "b", "c"], "a", -1)).toBe("c");
    expect(cycleTab(["a", "b"], null, 1)).toBe("a");
    expect(cycleTab(["a", "b"], null, -1)).toBe("b");
    expect(cycleTab([], null, 1)).toBeNull();
  });

  it("任务删除 / 归档后标签去掉，都还在时原样返回", () => {
    const tabs = ["a", "b"];
    expect(keepExisting(tabs, () => true)).toBe(tabs);
    expect(keepExisting(tabs, (id) => id !== "a")).toEqual(["b"]);
  });

  it("拖动换位置：按挪走它之后的列表放到第 to 个，越界夹到两端，位置没变时原样返回", () => {
    const tabs = ["a", "b", "c"];
    expect(moveTab(tabs, "c", 0)).toEqual(["c", "a", "b"]);
    expect(moveTab(tabs, "a", 2)).toEqual(["b", "c", "a"]);
    expect(moveTab(tabs, "a", 99)).toEqual(["b", "c", "a"]);
    expect(moveTab(tabs, "b", 1)).toBe(tabs);
    expect(moveTab(tabs, "x", 0)).toBe(tabs);
  });

  it("一次关几个：当前没被关就不切；被关了切到右边最近剩下的，没有就左边，都没有回草稿", () => {
    const tabs = ["a", "b", "c", "d"];
    expect(withoutTabs(tabs, ["a", "c"], "b")).toEqual({ tabs: ["b", "d"], next: "b" });
    expect(withoutTabs(tabs, ["b", "c"], "b")).toEqual({ tabs: ["a", "d"], next: "d" });
    expect(withoutTabs(tabs, ["c", "d"], "c")).toEqual({ tabs: ["a", "b"], next: "b" });
    expect(withoutTabs(tabs, tabs, "a")).toEqual({ tabs: [], next: null });
    expect(withoutTabs(tabs, [], "a").tabs).toBe(tabs);
  });
});
