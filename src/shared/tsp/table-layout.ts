// table 节点的列轨道：每一列都有下限宽度。
// 光是 `auto` / `minmax(0, Nfr)` 时，列里的字能在任意位置折行（`wrap: "char"` 的 text），网格算出的最小内容宽度是 1 个字，
// /tools 的第一列（`xd://debug` 这类名字）就被挤成一个字宽、竖着排。下限 = 最长单元格的字数（封顶）× 字宽 + 内边距。

/** 单元格左右内边距合计（`.tsp-tbl-c` 的 `--space-2` × 2 的估计值）。 */
const CELL_PAD_PX = 14;
/** 不撑开的列（`grow` 为 0）下限最多按这么多个字算：再长的内容让它折行，不把别的列挤没。 */
const FIXED_COL_MAX_CHARS = 24;
/** 撑开的列（`grow` > 0）下限最多按这么多个字算。 */
const GROW_COL_MIN_CHARS = 12;

/** 一列里最长单元格（含表头）的字数；没有这个单元格（`null`）不算，空串 / meter 单元格按 `emptyChars` 算。 */
export function columnChars(
  headText: string | null,
  cellTexts: readonly (string | null)[],
  emptyChars: number,
): number {
  let chars = headText === null ? 0 : headText.length;
  for (const text of cellTexts) {
    if (text !== null) chars = Math.max(chars, text.length === 0 ? emptyChars : text.length);
  }
  return chars;
}

/** 这一列的 CSS 轨道：`minmax(下限, auto)`，撑开的列 `minmax(下限, Nfr)`。字宽读 `--tsp-cw`（.tsp-view 上的变量，带单位）。 */
export function columnTrack(grow: number | undefined, chars: number): string {
  const growing = (grow ?? 0) > 0;
  const floorChars = Math.min(chars, growing ? GROW_COL_MIN_CHARS : FIXED_COL_MAX_CHARS);
  const floor = `calc(${floorChars} * var(--tsp-cw, 8px) + ${CELL_PAD_PX}px)`;
  return growing ? `minmax(${floor}, ${grow}fr)` : `minmax(${floor}, auto)`;
}
