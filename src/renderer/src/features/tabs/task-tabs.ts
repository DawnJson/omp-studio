// 任务标签列表的纯逻辑（tabs-store.ts 用；单测 test/task-tabs.test.ts）：开、关、轮换、丢掉不在了的任务。
// 标签里只有任务 id；新任务草稿不进列表（它是"没有选中任务"，界面上单独画一个草稿标签）。

/** 选中一个任务：已经开着就不动，否则加在最右。 */
export function withTab<T>(tabs: readonly T[], id: T): readonly T[] {
  return tabs.includes(id) ? tabs : [...tabs, id];
}

/** Ctrl Tab / Ctrl Shift Tab：从 current 往右（1）或往左（-1）一个，首尾相接；current 不在列表里（草稿）时右到第一个、左到最后一个。 */
export function cycleTab<T>(tabs: readonly T[], current: T | null, step: 1 | -1): T | null {
  if (tabs.length === 0) return null;
  const at = current === null ? -1 : tabs.indexOf(current);
  if (at < 0) return step === 1 ? tabs[0]! : tabs[tabs.length - 1]!;
  return tabs[(at + step + tabs.length) % tabs.length]!;
}

/** 只留还存在的任务（删除、归档后任务从任务表里消失）；没变时返回原数组。 */
export function keepExisting<T>(tabs: readonly T[], exists: (id: T) => boolean): readonly T[] {
  return tabs.every(exists) ? tabs : tabs.filter(exists);
}

/** 拖动换位置：把 id 挪到第 to 个（按挪走它之后的列表算，0 起，超出就夹到两端）。 */
export function moveTab<T>(tabs: readonly T[], id: T, to: number): readonly T[] {
  if (!tabs.includes(id)) return tabs;
  const rest = tabs.filter((tab) => tab !== id);
  rest.splice(Math.max(0, Math.min(rest.length, to)), 0, id);
  return rest.every((tab, index) => tab === tabs[index]) ? tabs : rest;
}

/**
 * 一次关掉几个（关闭其他 / 右侧 / 全部）：返回剩下的列表和该切去的标签。current 没被关就还是它；
 * 被关了就切到它右边最近的剩下的，没有就左边最近的，都没有 = null（回到草稿）。
 */
export function withoutTabs<T>(
  tabs: readonly T[],
  ids: readonly T[],
  current: T | null,
): { tabs: readonly T[]; next: T | null } {
  const closing = new Set(ids);
  const rest = tabs.filter((tab) => !closing.has(tab));
  if (rest.length === tabs.length) return { tabs, next: current };
  if (current === null || !closing.has(current)) return { tabs: rest, next: current };
  const at = tabs.indexOf(current);
  const right = tabs.slice(at + 1).find((tab) => !closing.has(tab));
  const left = tabs.slice(0, at).findLast((tab) => !closing.has(tab));
  return { tabs: rest, next: right ?? left ?? null };
}
