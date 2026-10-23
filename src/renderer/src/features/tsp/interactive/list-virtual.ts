// `list.virtual: true` 的纯逻辑：等高行的可见下标范围、选中行要滚多少才进视野。可见范围复用 picker 的 visibleRange。
import { visibleRange } from "./picker-model.ts";

/** 子项少于这个数不虚拟化：全量渲染更简单，也不会因行高估算偏差出现滚动跳动。 */
export const VIRTUAL_MIN_ITEMS = 100;
/** 窗口上下各多画几行。 */
export const VIRTUAL_OVERSCAN = 8;
/** 还没量到真实行高时的估计（一行 item：`--lh-sm` + 内边距）。 */
export const VIRTUAL_ROW_ESTIMATE = 30;

/** 要画的子项下标 [from, to)：`offset` 是列表顶部被滚走的高度，`viewport` 是可见高度。 */
export function listWindow(
  count: number,
  rowHeight: number,
  offset: number,
  viewport: number,
  overscan: number = VIRTUAL_OVERSCAN,
): [number, number] {
  if (count <= 0 || rowHeight <= 0) return [0, 0];
  const rows = Array.from({ length: count }, (_, index) => ({ top: index * rowHeight, height: rowHeight }));
  return visibleRange(rows, offset, viewport, overscan);
}

/** 一行（视口坐标的上 / 下边）要让滚动容器再滚多少（正 = 往下）才进视野；`where` 同 reveal：start / end 对齐边，nearest 最小滚动。 */
export function scrollDelta(
  rowTop: number,
  rowBottom: number,
  viewTop: number,
  viewBottom: number,
  where: "start" | "end" | "nearest",
): number {
  if (where === "start") return rowTop - viewTop;
  if (where === "end") return rowBottom - viewBottom;
  if (rowTop < viewTop) return rowTop - viewTop;
  if (rowBottom > viewBottom) return rowBottom - viewBottom;
  return 0;
}
