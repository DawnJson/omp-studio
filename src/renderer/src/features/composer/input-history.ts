// 输入历史（↑↓ 翻看本任务发过的消息）。只放渲染进程内存，按任务记；第一次用到时用对话里的用户消息做种子。
import type { AgentMessage } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import type { TranscriptItem } from "../../../../shared/transcript.ts";

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

/** 对话里用户发过的文字（旧到新）；合成消息和纯图片消息不算。 */
export function transcriptUserTexts(items: readonly TranscriptItem[]): string[] {
  const texts: string[] = [];
  for (const item of items) {
    if (item.kind !== "message") continue;
    const message: AgentMessage = item.message;
    if (message.role !== "user" || message.synthetic) continue;
    const text =
      typeof message.content === "string"
        ? message.content
        : message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
    if (text.trim() !== "") texts.push(text.trim());
  }
  return texts;
}

// ───── 按任务的内存状态 ─────
const histories = new Map<string, string[]>();
const seeded = new Set<string>();
const cursors = new Map<string, HistoryCursor>();

function seed(taskId: TaskId, items: readonly TranscriptItem[] | null): string[] {
  if (!seeded.has(taskId) && items !== null) {
    seeded.add(taskId);
    const base = transcriptUserTexts(items).reduce<string[]>((acc, text) => pushEntry(acc, text), []);
    // 种子在前：seed 之前就已经记下的本地发送留在后面。
    histories.set(taskId, [...base, ...(histories.get(taskId) ?? [])].slice(-MAX_HISTORY));
  }
  return histories.get(taskId) ?? [];
}

/** 发送前调用：记下这条，并结束翻看。 */
export function recordSent(taskId: TaskId, text: string, items: readonly TranscriptItem[] | null): void {
  histories.set(taskId, pushEntry(seed(taskId, items), text));
  cursors.delete(taskId);
}

/** 草稿被手动编辑：结束翻看（之后再按 ↑ 从最新一条重新开始）。 */
export function resetHistoryCursor(taskId: TaskId): void {
  cursors.delete(taskId);
}

export function isCycling(taskId: TaskId): boolean {
  return cursors.has(taskId);
}

export function hasHistory(taskId: TaskId, items: readonly TranscriptItem[] | null): boolean {
  return seed(taskId, items).length > 0;
}

/** 翻一步；返回要放进输入框的文字，没动返回 null。 */
export function cycleHistory(
  taskId: TaskId,
  current: string,
  direction: HistoryDirection,
  items: readonly TranscriptItem[] | null,
): string | null {
  const step = stepHistory(seed(taskId, items), cursors.get(taskId) ?? null, current, direction);
  if (step === null) return null;
  if (step.cursor === null) cursors.delete(taskId);
  else cursors.set(taskId, step.cursor);
  return step.text;
}
