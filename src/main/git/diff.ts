// unified diff 的解析和单个 hunk 的补丁重建。纯函数，不碰磁盘。
// 文件内容不一定是 UTF-8，所以先按 latin1 切（字节和字符一一对应），拼回补丁时原样还原成字节；
// 只有给界面看的 text 才把每一行按 UTF-8 解码。
import type { GitDiffHunk, GitDiffLine, GitFileDiff } from "../../shared/git.ts";

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** 切开的原始 diff：header 是第一个 @@ 之前的全部行；每个 hunk 含它的 @@ 行，每行以 \n 结尾。都是 latin1 字符串。 */
export interface RawDiff {
  header: string;
  hunks: string[];
}

const utf8 = (latin1: string) => Buffer.from(latin1, "latin1").toString("utf8");

/** 切开 `git diff` 的单文件输出；二进制文件（header 里是 "Binary files … differ"）返回 null。 */
export function splitRawDiff(raw: Buffer): RawDiff | null {
  const lines = raw.toString("latin1").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  let header = "";
  const hunks: string[] = [];
  let current: string | null = null;
  for (const line of lines) {
    if (HUNK_RE.test(line)) {
      if (current !== null) hunks.push(current);
      current = `${line}\n`;
    } else if (current === null) {
      if (line.startsWith("Binary files ") || line === "GIT binary patch") return null;
      header += `${line}\n`;
    } else {
      current += `${line}\n`;
    }
  }
  if (current !== null) hunks.push(current);
  return { header, hunks };
}

function parseHunk(raw: string): GitDiffHunk {
  const lines = raw.split("\n");
  lines.pop(); // 末尾的空串（最后一行以 \n 结尾）
  const headerLine = lines.shift() ?? "";
  const match = HUNK_RE.exec(headerLine);
  if (!match) throw new Error("not a hunk");
  const oldStart = Number(match[1]);
  const newStart = Number(match[3]);
  const out: GitDiffLine[] = [];
  let oldNo = oldStart;
  let newNo = newStart;
  for (const line of lines) {
    const mark = line[0];
    const text = utf8(line.slice(1));
    if (mark === "+") out.push({ kind: "add", oldNo: null, newNo: newNo++, text });
    else if (mark === "-") out.push({ kind: "del", oldNo: oldNo++, newNo: null, text });
    else if (mark === "\\") {
      const last = out[out.length - 1];
      if (last) last.noEol = true;
    } else out.push({ kind: "context", oldNo: oldNo++, newNo: newNo++, text });
  }
  return {
    header: utf8(headerLine),
    oldStart,
    oldLines: match[2] === undefined ? 1 : Number(match[2]),
    newStart,
    newLines: match[4] === undefined ? 1 : Number(match[4]),
    lines: out,
  };
}

export function toFileDiff(raw: RawDiff | null): GitFileDiff {
  if (raw === null) return { kind: "binary" };
  const hunks = raw.hunks.map(parseHunk);
  let added = 0;
  let removed = 0;
  for (const hunk of hunks)
    for (const line of hunk.lines) {
      if (line.kind === "add") added++;
      else if (line.kind === "del") removed++;
    }
  return { kind: "text", hunks, added, removed };
}

/** 单个 hunk 的可 `git apply` 的补丁：原 header + 这个 hunk。 */
export function buildHunkPatch(raw: RawDiff, index: number): Buffer {
  const hunk = raw.hunks[index];
  if (hunk === undefined) throw new Error(`hunk ${index} does not exist`);
  return Buffer.from(raw.header + hunk, "latin1");
}

/** 按行补丁的方向：forward = 把选中的改动应用到 diff 的旧侧（暂存工作区改动）；reverse = 把选中的改动从 diff 的新侧撤掉（取消暂存、丢弃）。 */
export type LinePatchDirection = "forward" | "reverse";

interface PatchRow {
  mark: " " | "+" | "-";
  body: string;
  /** 紧跟在这一行后面的 "\ No newline at end of file"（含行尾 \n）。 */
  marker: string | null;
}

/**
 * 只含选中行的补丁（等价于 `git add -p` 的 e 编辑）：
 * - forward（`apply --cached` 用工作区 diff）：没选中的删除行变成上下文（索引里还有它），没选中的新增行丢掉；
 * - reverse（`apply [--cached] -R` 用暂存区 / 工作区 diff）：没选中的新增行变成上下文（现状里有它），没选中的删除行丢掉。
 * `selected` 是 hunk 里不含 "\ No newline" 行的行下标，和 `GitDiffHunk.lines` 一致。行内容原样保留（含 CRLF 的 \r）。
 */
export function buildLinePatch(
  raw: RawDiff,
  index: number,
  selected: ReadonlySet<number>,
  direction: LinePatchDirection,
): Buffer {
  const hunk = raw.hunks[index];
  if (hunk === undefined) throw new Error(`hunk ${index} does not exist`);
  const rows = hunk.split("\n");
  rows.pop();
  const headerRow = rows.shift() ?? "";
  const match = HUNK_RE.exec(headerRow);
  if (!match) throw new Error("not a hunk");
  const entries: PatchRow[] = [];
  for (const row of rows) {
    if (row[0] === "\\") {
      const last = entries[entries.length - 1];
      if (last) last.marker = `${row}\n`;
    } else entries.push({ mark: row[0] === "+" ? "+" : row[0] === "-" ? "-" : " ", body: row.slice(1), marker: null });
  }
  for (const at of selected) {
    const entry = entries[at];
    if (!Number.isInteger(at) || entry === undefined || entry.mark === " ")
      throw new Error("only added or removed lines can be selected");
  }
  if (selected.size === 0) throw new Error("no lines selected");

  const turnIntoContext = direction === "forward" ? "-" : "+";
  const keep = (entry: PatchRow, at: number): PatchRow | null => {
    if (entry.mark === " " || selected.has(at)) return entry;
    return entry.mark === turnIntoContext ? { ...entry, mark: " " } : null;
  };
  // 一组改动（git 先列一串删除、再列一串新增）里，第 i 个删除和第 i 个新增成对交错写出：
  // 只挑一对"改第 4 行"时，新行落在旧行的位置，而不是挪到这组没选中的行（变成上下文）后面去。
  const kept: PatchRow[] = [];
  let at = 0;
  while (at < entries.length) {
    const entry = entries[at]!;
    if (entry.mark === " ") {
      kept.push(entry);
      at += 1;
      continue;
    }
    const removed: number[] = [];
    const added: number[] = [];
    while (at < entries.length && entries[at]!.mark === "-") removed.push(at++);
    while (at < entries.length && entries[at]!.mark === "+") added.push(at++);
    for (let i = 0; i < Math.max(removed.length, added.length); i += 1) {
      for (const row of [removed[i], added[i]]) {
        if (row === undefined) continue;
        const next = keep(entries[row]!, row);
        if (next !== null) kept.push(next);
      }
    }
  }

  // "\ No newline" 说的是这一侧文件的最后一行：这一行之后同一侧不能再有行（挑出的行拼不出这样的文件时拒绝，而不是写出坏补丁）。
  kept.forEach((entry, at) => {
    if (entry.marker === null) return;
    const later = kept.slice(at + 1);
    const clash =
      entry.mark === " " ? later.length > 0 : later.some((next) => next.mark === " " || next.mark === entry.mark);
    if (clash)
      throw new Error(
        "these lines cannot be applied on their own because of the missing newline at the end of the file",
      );
  });

  const oldCount = kept.filter((entry) => entry.mark !== "+").length;
  const newCount = kept.filter((entry) => entry.mark !== "-").length;
  // 补丁单独对一个文件状态应用：没动的那一侧（forward 是旧侧，reverse 是新侧）起始行不变，另一侧从同一行开始。
  // 行数为 0 的一侧，起始行写成前一行（git 的约定）。
  const originalOldCount = match[2] === undefined ? 1 : Number(match[2]);
  const originalNewCount = match[4] === undefined ? 1 : Number(match[4]);
  const firstLine =
    direction === "forward"
      ? Number(match[1]) + (originalOldCount === 0 ? 1 : 0)
      : Number(match[3]) + (originalNewCount === 0 ? 1 : 0);
  const startOf = (count: number) => (count === 0 ? firstLine - 1 : firstLine);
  const section = headerRow.slice(match[0].length);
  const header = `@@ -${startOf(oldCount)},${oldCount} +${startOf(newCount)},${newCount} @@${section}\n`;
  const body = kept.map((entry) => `${entry.mark}${entry.body}\n${entry.marker ?? ""}`).join("");
  return Buffer.from(raw.header + header + body, "latin1");
}

/** 文件头部 8000 字节里有 NUL 就当二进制（git 自己用的判据）。 */
export function looksBinary(content: Buffer): boolean {
  return content.subarray(0, 8000).includes(0);
}

/** 未跟踪文件：整个文件是一个全新增的 hunk。调用方先排除二进制和过大文件。 */
export function diffOfNewFile(content: Buffer): GitFileDiff {
  const text = content.toString("utf8");
  if (text === "") return { kind: "text", hunks: [], added: 0, removed: 0 };
  const endsWithNewline = text.endsWith("\n");
  const lines = text.split("\n");
  if (endsWithNewline) lines.pop();
  const out: GitDiffLine[] = lines.map((line, i) => ({ kind: "add", oldNo: null, newNo: i + 1, text: line }));
  if (!endsWithNewline) {
    const last = out[out.length - 1];
    if (last) last.noEol = true;
  }
  const hunk: GitDiffHunk = {
    header: `@@ -0,0 +1${out.length === 1 ? "" : `,${out.length}`} @@`,
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: out.length,
    lines: out,
  };
  return { kind: "text", hunks: [hunk], added: out.length, removed: 0 };
}
