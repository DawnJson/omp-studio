// 输入历史（↑↓ 翻看发过的消息，像终端里的命令历史；Ctrl+R 搜索用同一份条目）的纯逻辑。
// 条目 = 会话里的用户消息（omp 文档里的，含恢复的会话、草稿页发出的第一句）合并 studio 自己记下的（项目范围、落盘在 userData，
// 见 history-store.ts 和主进程 tasks/input-history-store.ts：斜杠命令、排队中、刚发还没回显的、别的任务发的也在里面）。
// 翻看的游标按任务记在内存里。
import type { TaskId } from "../../../../shared/ipc.ts";

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

// ───── 按任务的翻看游标 ─────
const cursors = new Map<string, HistoryCursor>();

/** 结束翻看（草稿被手动编辑、发送、从 Ctrl+R 选了一条）：之后再按 ↑ 从最新一条重新开始。 */
export function resetHistoryCursor(taskId: TaskId): void {
  cursors.delete(taskId);
}

export function isCycling(taskId: TaskId): boolean {
  return cursors.has(taskId);
}

/** 翻一步；返回要放进输入框的文字，没动返回 null。`entries` 从旧到新（mergeEntries 的结果）。 */
export function cycleHistory(
  taskId: TaskId,
  entries: readonly string[],
  current: string,
  direction: HistoryDirection,
): string | null {
  const step = stepHistory(entries, cursors.get(taskId) ?? null, current, direction);
  if (step === null) return null;
  if (step.cursor === null) cursors.delete(taskId);
  else cursors.set(taskId, step.cursor);
  return step.text;
}
