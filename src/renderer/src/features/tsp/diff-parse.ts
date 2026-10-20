// diff 节点的数据整理（纯函数）：统一 diff 文本或 hunks → 带新旧行号的行；成对的删/增行算出改动的那一段。
import type { TspDiffHunk } from "../../../../shared/tsp/tsp.generated.ts";

export interface DiffLine {
  kind: "ctx" | "add" | "del";
  text: string;
  old: number | null;
  new: number | null;
}

export interface DiffHunkRows {
  oldStart: number;
  newStart: number;
  oldCount: number;
  newCount: number;
  /** `@@` 行后面的函数名（第一个 hunk 的不画）。 */
  fn: string;
  lines: DiffLine[];
}

/** 一组 `+` / `-` / 空格开头的行 → 带行号的行。`\ No newline` 行和空行（空行当上下文）按规范处理。 */
function rowsFrom(raw: readonly string[], oldStart: number, newStart: number): DiffHunkRows {
  let oldNo = oldStart;
  let newNo = newStart;
  const lines: DiffLine[] = [];
  for (const line of raw) {
    if (line.startsWith("\\")) continue;
    const mark = line[0];
    if (mark === "+") lines.push({ kind: "add", text: line.slice(1), old: null, new: newNo++ });
    else if (mark === "-") lines.push({ kind: "del", text: line.slice(1), old: oldNo++, new: null });
    else lines.push({ kind: "ctx", text: mark === " " ? line.slice(1) : line, old: oldNo++, new: newNo++ });
  }
  return {
    oldStart,
    newStart,
    oldCount: oldNo - oldStart,
    newCount: newNo - newStart,
    fn: "",
    lines,
  };
}

export function hunksFromProps(hunks: readonly TspDiffHunk[]): DiffHunkRows[] {
  return hunks.map((h) => rowsFrom(h.lines, h.oldStart ?? 1, h.newStart ?? 1));
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/;

/** 统一 diff 文本。`diff --git` / `---` / `+++` / `index` 头忽略；完全没有 `@@` 的当成一个 hunk。 */
export function parseDiff(text: string): DiffHunkRows[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const hunks: DiffHunkRows[] = [];
  let current: { oldStart: number; newStart: number; fn: string; raw: string[] } | null = null;
  let sawHeader = false;
  const flush = (): void => {
    if (!current) return;
    const rows = rowsFrom(current.raw, current.oldStart, current.newStart);
    rows.fn = current.fn;
    hunks.push(rows);
    current = null;
  };
  for (const line of lines) {
    const header = HUNK_HEADER.exec(line);
    if (header) {
      flush();
      sawHeader = true;
      current = { oldStart: Number(header[1]), newStart: Number(header[2]), fn: header[3] ?? "", raw: [] };
    } else if (current) {
      current.raw.push(line);
    } else if (!sawHeader && !/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(line)) {
      current = { oldStart: 1, newStart: 1, fn: "", raw: [line] };
    }
  }
  flush();
  return hunks;
}

export interface WordRange {
  from: number;
  to: number;
}

/** 成对的一删一增：公共前缀和后缀之外的那一段（字符范围）是改动的词；两边几乎全改了就不标。 */
export function changedRange(a: string, b: string): [WordRange, WordRange] | null {
  if (a.length > 1000 || b.length > 1000 || a === b) return null;
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const keptA = a.length - (endA - start);
  const keptB = b.length - (endB - start);
  // 大部分都改了（保留的不到一半）：整行都是改动，不再强调。
  if (keptA * 2 < a.length && keptB * 2 < b.length) return null;
  return [
    { from: start, to: endA },
    { from: start, to: endB },
  ];
}

export interface DiffRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

/** 并排模式的行：一段连续的删和随后的增按顺序配对，多出来的一侧留空。 */
export function splitRows(lines: readonly DiffLine[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.kind === "ctx") {
      rows.push({ left: line, right: line });
      i += 1;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i]!.kind === "del") dels.push(lines[i++]!);
    while (i < lines.length && lines[i]!.kind === "add") adds.push(lines[i++]!);
    for (let k = 0; k < Math.max(dels.length, adds.length); k += 1) {
      rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
    }
  }
  return rows;
}
