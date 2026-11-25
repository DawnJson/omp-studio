import { describe, expect, it } from "vitest";
import {
  activateTab,
  addTab,
  maxPreviewTabs,
  removeTab,
  type TabList,
} from "../src/renderer/src/features/file-preview/preview-tabs.ts";

type Tab = { id: number };

function open(...ids: number[]): TabList<Tab> {
  return ids.reduce<TabList<Tab> | undefined>((list, id) => addTab(list, { id }), undefined)!;
}

const ids = (list: TabList<Tab> | null) => list?.tabs.map((tab) => tab.id);

describe("预览标签", () => {
  it("新开的接在最右并成为当前标签", () => {
    const list = open(1, 2, 3);
    expect(ids(list)).toEqual([1, 2, 3]);
    expect(list.active).toBe(3);
  });

  it("超过上限时挤掉最久没看的，不按开的先后", () => {
    const base = open(...Array.from({ length: maxPreviewTabs }, (_, i) => i + 1));
    // 回头看过 1：最久没看的变成 2。
    const list = addTab(activateTab(base, 1), { id: 99 });
    expect(list.tabs).toHaveLength(maxPreviewTabs);
    expect(ids(list)).not.toContain(2);
    expect(ids(list)).toContain(1);
    expect(list.active).toBe(99);
  });

  it("关掉当前标签换到右边那个，最右的关掉换到左边", () => {
    const list = activateTab(open(1, 2, 3), 2);
    const middleClosed = removeTab(list, 2)!;
    expect(ids(middleClosed)).toEqual([1, 3]);
    expect(middleClosed.active).toBe(3);
    const lastClosed = removeTab(middleClosed, 3)!;
    expect(lastClosed.active).toBe(1);
  });

  it("关掉别的标签不换当前；关掉最后一个返回 null", () => {
    const list = open(1, 2);
    expect(removeTab(list, 1)?.active).toBe(2);
    expect(removeTab(removeTab(list, 1)!, 2)).toBeNull();
  });
});
