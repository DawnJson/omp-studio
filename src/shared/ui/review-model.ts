// 评审界面的纯逻辑：文件分组、行选择（评论范围）、评论队列的整理。不碰 DOM，test/review-model.test.ts 覆盖。
import type { GitChangeKind, GitDiffArea, GitDiffLine, GitFileChange, ReviewComment } from "../git.ts";

// ───────── 文件树 ─────────

export interface ReviewEntry {
  /** `${area}:${path}`：同一个文件可以同时出现在"已暂存"和"未暂存"两组，所以键要带上哪一侧。 */
  key: string;
  path: string;
  oldPath: string | null;
  area: GitDiffArea;
  kind: GitChangeKind;
}

export interface ReviewGroup {
  area: GitDiffArea;
  entries: ReviewEntry[];
}

export const REVIEW_AREAS: readonly GitDiffArea[] = ["staged", "unstaged", "untracked"];

export function entryKey(area: GitDiffArea, path: string): string {
  return `${area}:${path}`;
}

/**
 * 把 git 状态分成 已暂存 / 未暂存 / 未跟踪 三组（空组省略），组内按路径排序。
 * 一个路径两侧都有改动时在两组各出现一次；冲突文件只放"未暂存"（两侧都是 conflicted，重复显示没有意义）。
 */
export function groupChanges(files: readonly GitFileChange[]): ReviewGroup[] {
  const buckets: Record<GitDiffArea, ReviewEntry[]> = { staged: [], unstaged: [], untracked: [] };
  for (const file of files) {
    const conflicted = file.staged === "conflicted" || file.unstaged === "conflicted";
    if (file.staged !== null && !conflicted) {
      buckets.staged.push({
        key: entryKey("staged", file.path),
        path: file.path,
        oldPath: file.oldPath,
        area: "staged",
        kind: file.staged,
      });
    }
    if (file.unstaged !== null) {
      const area: GitDiffArea = file.unstaged === "untracked" ? "untracked" : "unstaged";
      buckets[area].push({
        key: entryKey(area, file.path),
        path: file.path,
        oldPath: null,
        area,
        kind: file.unstaged,
      });
    }
  }
  return REVIEW_AREAS.flatMap((area) => {
    const entries = buckets[area].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return entries.length > 0 ? [{ area, entries }] : [];
  });
}

export function flattenGroups(groups: readonly ReviewGroup[]): ReviewEntry[] {
  return groups.flatMap((group) => group.entries);
}

/** 当前选中的条目消失（暂存后换了一组、文件被还原）时选谁：同一个位置上的下一个，没有就取最后一个。 */
export function resolveSelection(
  entries: readonly ReviewEntry[],
  selectedKey: string | null,
  lastIndex: number,
): ReviewEntry | null {
  if (entries.length === 0) return null;
  return (
    entries.find((entry) => entry.key === selectedKey) ??
    entries[Math.min(Math.max(lastIndex, 0), entries.length - 1)] ??
    null
  );
}

/** j / k：在条目间移动，不循环。 */
export function stepEntry(
  entries: readonly ReviewEntry[],
  currentKey: string | null,
  delta: 1 | -1,
): ReviewEntry | null {
  if (entries.length === 0) return null;
  const at = entries.findIndex((entry) => entry.key === currentKey);
  if (at === -1) return entries[0] ?? null;
  return entries[Math.min(Math.max(at + delta, 0), entries.length - 1)] ?? null;
}

/** n / p：在 hunk 间移动，不循环；没有当前 hunk 时 n 取第一个、p 取最后一个。count 为 0 返回 null。 */
export function stepHunk(count: number, current: number | null, delta: 1 | -1): number | null {
  if (count === 0) return null;
  if (current === null) return delta === 1 ? 0 : count - 1;
  return Math.min(Math.max(current + delta, 0), count - 1);
}

// ───────── 行选择与评论范围 ─────────

/** diff 里的一个可评论位置：旧版本（被删除的行）或新版本的行号。 */
export interface LineRef {
  side: "old" | "new";
  line: number;
}

export interface LineSelection {
  side: "old" | "new";
  start: number;
  end: number;
}

/** 删除行评论旧版本的行号；新增行和上下文行评论新版本的行号（agent 手里的文件就是新版本）。 */
export function lineRef(line: GitDiffLine): LineRef | null {
  if (line.kind === "del") return line.oldNo === null ? null : { side: "old", line: line.oldNo };
  return line.newNo === null ? null : { side: "new", line: line.newNo };
}

export function sameRef(a: LineRef, b: LineRef): boolean {
  return a.side === b.side && a.line === b.line;
}

/** 从锚点到目标的选区（两端含，顺序无关）。跨旧/新两侧没有意义，返回 null，由调用方改为从目标重新开始。 */
export function selectRange(anchor: LineRef, target: LineRef): LineSelection | null {
  if (anchor.side !== target.side) return null;
  return { side: anchor.side, start: Math.min(anchor.line, target.line), end: Math.max(anchor.line, target.line) };
}

export function selectionOf(ref: LineRef): LineSelection {
  return { side: ref.side, start: ref.line, end: ref.line };
}

export function inSelection(selection: LineSelection, ref: LineRef): boolean {
  return selection.side === ref.side && ref.line >= selection.start && ref.line <= selection.end;
}

// ───────── 评论队列 ─────────

/** 队列里的评论：area 记它是在哪一侧的 diff 里写的（暂存区和工作区的行号可能不同），发送时去掉。 */
export interface QueuedComment extends ReviewComment {
  id: string;
  area: GitDiffArea;
}

export type CommentDraft = Omit<QueuedComment, "id">;

export function commentCovers(comment: QueuedComment, file: string, area: GitDiffArea, ref: LineRef): boolean {
  return (
    comment.file === file &&
    comment.area === area &&
    comment.side === ref.side &&
    ref.line >= comment.startLine &&
    ref.line <= comment.endLine
  );
}

/** 评论框画在范围最后一行的下面：返回结束于这一行的评论。 */
export function commentsEndingAt(
  comments: readonly QueuedComment[],
  file: string,
  area: GitDiffArea,
  ref: LineRef,
): QueuedComment[] {
  return comments.filter(
    (comment) =>
      comment.file === file && comment.area === area && comment.side === ref.side && comment.endLine === ref.line,
  );
}

/** "12" 或 "12–16"。 */
export function rangeText(startLine: number, endLine: number): string {
  return startLine === endLine ? String(startLine) : `${startLine}–${endLine}`;
}

/** 按文件第一次出现的顺序、文件内按起始行排序（与 formatReviewComments 的发送顺序一致），队列面板用。 */
export function sortComments(comments: readonly QueuedComment[]): QueuedComment[] {
  const order = new Map<string, number>();
  for (const comment of comments) if (!order.has(comment.file)) order.set(comment.file, order.size);
  return [...comments].sort(
    (a, b) =>
      (order.get(a.file) ?? 0) - (order.get(b.file) ?? 0) ||
      a.startLine - b.startLine ||
      a.endLine - b.endLine ||
      (a.side === b.side ? 0 : a.side === "old" ? -1 : 1),
  );
}

/** 发给 sendReviewComments 的内容：去掉界面字段，正文去掉首尾空白；空正文的评论不发。 */
export function toReviewComments(comments: readonly QueuedComment[]): ReviewComment[] {
  return comments.flatMap((comment) => {
    const body = comment.body.trim();
    return body === ""
      ? []
      : [{ file: comment.file, startLine: comment.startLine, endLine: comment.endLine, side: comment.side, body }];
  });
}
