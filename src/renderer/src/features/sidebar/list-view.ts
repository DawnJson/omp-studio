// 侧栏列表的展开与截断规则（spec §4.3–§4.5）：常量和文件夹默认展开；一个列表画哪些行（收起的分叉、"显示更多"）在 sidebar-model 的 visibleItems。
import type { TaskId } from "../../../../shared/ipc.ts";
import { pinnedItem, type SidebarFolder } from "../../../../shared/ui/sidebar-model.ts";

/** "对话"和"归档"平铺列表先显示几行。 */
export const initialFlat = 40;
/** 按文件夹排列时，一个展开的文件夹先显示几行。 */
export const initialPerFolder = 5;
/** "显示更多"每次多露出几行。 */
export const showMoreStep = 20;
/** 平铺列表的"显示更多"状态键（文件夹用它自己的 key）。 */
export const flatLimitKey = "\u0000flat";

export const folderNavId = (folder: SidebarFolder) => `folder:${folder.key}`;
export const moreNavId = (key: string) => `more:${key}`;

/** 默认展开：文件夹里有选中的任务，或有正在跑/等你确认的任务；其余折叠。 */
export function defaultOpen(folder: SidebarFolder, selectedTaskId: TaskId | null): boolean {
  return folder.items.some((item) => pinnedItem(item, selectedTaskId));
}
