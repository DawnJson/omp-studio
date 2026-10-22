// 侧栏列表的展开与截断规则（spec §4.3–§4.5）：纯函数，Sidebar 用它算键盘导航的可见项，行组件用它决定画哪些行。
import type { TaskId } from "../../../../shared/ipc.ts";
import type { SidebarFolder, SidebarItem } from "../../../../shared/ui/sidebar-model.ts";

/** 按时间排列时先显示几行。 */
export const initialByTime = 40;
/** 按文件夹排列时，一个展开的文件夹先显示几行。 */
export const initialPerFolder = 5;
/** "显示更多"每次多露出几行。 */
export const showMoreStep = 20;
/** 时间排列的"显示更多"状态键（文件夹用它自己的 key）。 */
export const timeLimitKey = "\u0000time";

export const folderNavId = (folder: SidebarFolder) => `folder:${folder.key}`;
export const moreNavId = (key: string) => `more:${key}`;

/** 选中的任务、正在跑或等你确认的任务不能被"显示更多"藏起来。 */
function pinned(item: SidebarItem, selectedTaskId: TaskId | null): boolean {
  return (
    item.kind === "task" &&
    (item.task.id === selectedTaskId || item.task.status === "running" || item.task.status === "needs_you")
  );
}

/** 默认展开：文件夹里有选中的任务，或有正在跑/等你确认的任务；其余折叠。 */
export function defaultOpen(folder: SidebarFolder, selectedTaskId: TaskId | null): boolean {
  return folder.items.some((item) => pinned(item, selectedTaskId));
}

/** 取前 limit 行；limit 之后有需要露出的行时，上限抬到它为止。 */
export function visibleItems(
  items: readonly SidebarItem[],
  limit: number,
  selectedTaskId: TaskId | null,
): { shown: readonly SidebarItem[]; remaining: number } {
  let last = -1;
  items.forEach((item, index) => {
    if (pinned(item, selectedTaskId)) last = index;
  });
  const shown = items.slice(0, Math.max(limit, last + 1));
  return { shown, remaining: items.length - shown.length };
}
