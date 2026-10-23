// 评审里"按行暂存 / 取消暂存 / 丢弃"的行选择：点击切换、Shift 点击选到这一行、Shift+↑↓ 逐行扩展。
// 纯函数；行用 hunk.lines 的下标，`changed[i]` 表示第 i 行是新增或删除行（上下文行不能选）。

export interface LinePick {
  hunk: number;
  /** Shift 选区的起点和当前端点（可以落在上下文行上，选中的只有两者之间的改动行）。 */
  anchor: number;
  cursor: number;
  /** 选中的行下标，升序。 */
  lines: number[];
}

function between(changed: readonly boolean[], from: number, to: number): number[] {
  const out: number[] = [];
  for (let at = Math.min(from, to); at <= Math.max(from, to); at++) if (changed[at]) out.push(at);
  return out;
}

function sameHunk(current: LinePick | null, hunk: number): LinePick | null {
  return current !== null && current.hunk === hunk ? current : null;
}

/** 点击一行：切换它是否选中（别的 hunk 里的选择先丢掉）；上下文行不处理。 */
export function toggleLine(
  current: LinePick | null,
  hunk: number,
  index: number,
  changed: readonly boolean[],
): LinePick | null {
  if (!changed[index]) return current;
  const base = sameHunk(current, hunk);
  if (base === null) return { hunk, anchor: index, cursor: index, lines: [index] };
  const lines = base.lines.includes(index)
    ? base.lines.filter((line) => line !== index)
    : [...base.lines, index].sort((a, b) => a - b);
  return lines.length === 0 ? null : { hunk, anchor: index, cursor: index, lines };
}

/** Shift 点击：从起点选到这一行（没有起点就从这一行开始）。 */
export function extendToLine(
  current: LinePick | null,
  hunk: number,
  index: number,
  changed: readonly boolean[],
): LinePick | null {
  const base = sameHunk(current, hunk);
  if (base === null) return toggleLine(null, hunk, index, changed);
  const lines = between(changed, base.anchor, index);
  return lines.length === 0 ? null : { hunk, anchor: base.anchor, cursor: index, lines };
}

/**
 * Shift+↑/↓：把端点移动一行并重新选出起点到端点之间的改动行。还没有选择时从 hunk 里第一个（向下）/ 最后一个（向上）改动行开始。
 * 没有可选的行返回 null。
 */
export function moveSelection(
  current: LinePick | null,
  hunk: number,
  delta: 1 | -1,
  changed: readonly boolean[],
): LinePick | null {
  const base = sameHunk(current, hunk);
  if (base === null) {
    const start = delta === 1 ? changed.indexOf(true) : changed.lastIndexOf(true);
    return start === -1 ? null : { hunk, anchor: start, cursor: start, lines: [start] };
  }
  const cursor = Math.min(Math.max(base.cursor + delta, 0), changed.length - 1);
  const lines = between(changed, base.anchor, cursor);
  return lines.length === 0 ? { ...base, cursor } : { hunk, anchor: base.anchor, cursor, lines };
}
