// 预览面板标签列表的纯逻辑（preview-store.ts 用；单测 test/preview-tabs.test.ts）：开一个、切到一个、关一个，
// 超过上限时挤掉最久没看的那个。标签只要有不重复的 id。

export const maxPreviewTabs = 5;

export interface TabList<T extends { id: number }> {
  /** 标签条上从左到右的顺序（新开的接在最右）。 */
  tabs: readonly T[];
  /** 当前标签的 id。 */
  active: number;
  /** 看过的顺序（标签 id），最近的在前。 */
  recent: readonly number[];
}

export function activateTab<T extends { id: number }>(list: TabList<T>, id: number): TabList<T> {
  return { ...list, active: id, recent: [id, ...list.recent.filter((other) => other !== id)] };
}

/** 新标签接在最右并成为当前标签；超过上限时去掉最久没看的（不会是刚开的这个）。 */
export function addTab<T extends { id: number }>(list: TabList<T> | undefined, tab: T): TabList<T> {
  let tabs = [...(list?.tabs ?? []), tab];
  let recent = [tab.id, ...(list?.recent ?? [])];
  if (tabs.length > maxPreviewTabs) {
    const oldest = recent.at(-1);
    tabs = tabs.filter((candidate) => candidate.id !== oldest);
    recent = recent.slice(0, -1);
  }
  return { tabs, active: tab.id, recent };
}

/** 关掉一个标签：关的是当前的就换到它右边那个（没有就左边）；关掉最后一个返回 null。 */
export function removeTab<T extends { id: number }>(list: TabList<T>, id: number): TabList<T> | null {
  const at = list.tabs.findIndex((tab) => tab.id === id);
  if (at === -1) return list;
  const tabs = list.tabs.filter((tab) => tab.id !== id);
  if (tabs.length === 0) return null;
  const recent = list.recent.filter((other) => other !== id);
  if (list.active !== id) return { tabs, active: list.active, recent };
  return activateTab({ tabs, active: list.active, recent }, (tabs[at] ?? tabs[at - 1])!.id);
}
