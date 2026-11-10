// 设置页格子的排法（features/settings/Cells.tsx 用；spec §4.19）。纯函数。
// 每格按不折行时的宽占 1..cols 列；按原顺序逐个放进第一个还放得下的行（先填前面行的空位），放不下就开新行。
// 这样顺序只在"宽的格子这一行放不下"时往后挪，行里不留空位（除了最后一行的尾巴）。

export interface CellPacking {
  /** 每格占几列，下标是原顺序。 */
  readonly spans: readonly number[];
  /** 排好后的顺序：原顺序的下标，逐行从左到右。 */
  readonly order: readonly number[];
  readonly rows: number;
  /** 第一行用了几列（只有一行时，就是整组占的列数）。 */
  readonly used: number;
}

export function cellSpan(width: number, cols: number, colWidth: number, gap: number): number {
  if (colWidth <= 0) return 1;
  return Math.min(cols, Math.max(1, Math.ceil((width + gap) / (colWidth + gap) - 1e-6)));
}

export function packCells(widths: readonly number[], cols: number, colWidth: number, gap: number): CellPacking {
  const spans = widths.map((width) => cellSpan(width, cols, colWidth, gap));
  const rows: number[][] = [];
  const free: number[] = [];
  spans.forEach((span, index) => {
    const row = free.findIndex((left) => left >= span);
    if (row === -1) {
      rows.push([index]);
      free.push(cols - span);
    } else {
      rows[row]!.push(index);
      free[row]! -= span;
    }
  });
  return { spans, order: rows.flat(), rows: rows.length, used: cols - (free[0] ?? cols) };
}
