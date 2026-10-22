// 输入历史（↑↓ 翻看本任务发过的消息，像终端里的命令历史）：会话里的用户消息（omp 文档里的，含恢复的会话、草稿页发出的第一句）
// 加上 studio 记下但 omp 没画成用户消息的（斜杠命令、排队中、刚发还没回显的）。studio 记的那部分只放渲染进程内存，按任务记。
import type { TaskId } from "../../../../shared/ipc.ts";

export const MAX_HISTORY = 100;

/** 正在翻看：index 指向 entries；stash 是翻看之前的草稿，翻过最新一条时放回。 */
export interface HistoryCursor {
  index: number;
  stash: string;
}

export interface HistoryStep {
  text: string;
  cursor: HistoryCursor | null;
}

export type HistoryDirection = "up" | "down";

/** 追加一条：空的、和上一条相同的不记；超过上限丢最旧的。 */
export function pushEntry(entries: readonly string[], text: string): string[] {
  const trimmed = text.trim();
  if (trimmed === "" || entries[entries.length - 1] === trimmed) return [...entries];
  return [...entries, trimmed].slice(-MAX_HISTORY);
}

/**
 * 合并会话里的用户消息和 studio 记下的发送：以会话为准；studio 记的不在会话里的，插在它前一条已回显消息的后面（没有就放最前），
 * 保持发送顺序。相邻重复只留一条。
 */
export function mergeEntries(session: readonly string[], recorded: readonly string[]): string[] {
  const merged = session.map((text) => text.trim());
  let at = 0;
  for (const text of recorded) {
    const seen = merged.indexOf(text, at);
    if (seen >= 0) {
      at = seen + 1;
      continue;
    }
    merged.splice(at, 0, text);
    at += 1;
  }
  return merged.filter((text, index) => text !== "" && text !== merged[index - 1]);
}

/**
 * 这次 ↑/↓ 该不该由历史接管（否则交给文本框移动光标）。
 * 没在翻看时：只有 ↑，且输入框为空或光标在最开头；翻看中：↑ 要光标在第一行，↓ 要光标在最后一行。
 */
export function shouldCycle(
  direction: HistoryDirection,
  text: string,
  caret: number,
  cycling: boolean,
  hasEntries: boolean,
): boolean {
  if (!hasEntries) return false;
  if (!cycling) return direction === "up" && (text === "" || caret === 0);
  return direction === "up" ? !text.slice(0, caret).includes("\n") : !text.slice(caret).includes("\n");
}

/** 走一步；到头（最旧一条再按 ↑、没在翻看时按 ↓）返回 null，保持原样。 */
export function stepHistory(
  entries: readonly string[],
  cursor: HistoryCursor | null,
  current: string,
  direction: HistoryDirection,
): HistoryStep | null {
  if (direction === "up") {
    if (entries.length === 0) return null;
    const index = cursor === null ? entries.length - 1 : cursor.index - 1;
    if (index < 0) return null;
    return { text: entries[index] ?? "", cursor: { index, stash: cursor?.stash ?? current } };
  }
  if (cursor === null) return null;
  if (cursor.index >= entries.length - 1) return { text: cursor.stash, cursor: null };
  const index = cursor.index + 1;
  return { text: entries[index] ?? "", cursor: { index, stash: cursor.stash } };
}

// ───── 按任务的内存状态 ─────
const histories = new Map<string, string[]>();
const cursors = new Map<string, HistoryCursor>();

/** 发送前调用：记下这条，并结束翻看。 */
export function recordSent(taskId: TaskId, text: string): void {
  histories.set(taskId, pushEntry(histories.get(taskId) ?? [], text));
  cursors.delete(taskId);
}

/** 草稿被手动编辑：结束翻看（之后再按 ↑ 从最新一条重新开始）。 */
export function resetHistoryCursor(taskId: TaskId): void {
  cursors.delete(taskId);
}

/** 本任务能翻的全部条目；`session` 是会话里的用户消息（userMessageTexts）。 */
function entriesOf(taskId: TaskId, session: readonly string[]): string[] {
  return mergeEntries(session, histories.get(taskId) ?? []);
}

export function isCycling(taskId: TaskId): boolean {
  return cursors.has(taskId);
}

export function hasHistory(taskId: TaskId, session: readonly string[]): boolean {
  return entriesOf(taskId, session).length > 0;
}

/** 翻一步；返回要放进输入框的文字，没动返回 null。 */
export function cycleHistory(
  taskId: TaskId,
  session: readonly string[],
  current: string,
  direction: HistoryDirection,
): string | null {
  const step = stepHistory(entriesOf(taskId, session), cursors.get(taskId) ?? null, current, direction);
  if (step === null) return null;
  if (step.cursor === null) cursors.delete(taskId);
  else cursors.set(taskId, step.cursor);
  return step.text;
}
