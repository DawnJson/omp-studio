// 旁路提问面板的纯逻辑：显示哪个话题、输入框能不能发、问题摘要。
import { isBtwRunning, type BtwHistoryRecord } from "../../../../shared/btw.ts";

/** 面板的选择：`null` = 最新的话题（默认）；`NEW_TOPIC` = 用户点了"新话题"；否则是话题 id。 */
export const NEW_TOPIC = "new";
export type BtwSelection = string | typeof NEW_TOPIC | null;

/**
 * 当前显示的话题；选了"新话题"、选中的话题已不存在或还没有记录时，按规则回退。null = 没有话题可显示。
 * 输入框发出的就是对它的追问（它的 id 作为 recordId），null 时开新话题。
 */
export function activeTopic(records: readonly BtwHistoryRecord[], selection: BtwSelection): BtwHistoryRecord | null {
  if (selection === NEW_TOPIC) return null;
  if (selection !== null) {
    const chosen = records.find((record) => record.id === selection);
    if (chosen) return chosen;
  }
  return records[0] ?? null;
}

/** 输入框能不能发：有内容，并且 omp 没有在跑别的旁路提问（它同一时刻只许一条）。 */
export function canAsk(records: readonly BtwHistoryRecord[], text: string): boolean {
  return text.trim() !== "" && !isBtwRunning(records);
}

/** 话题标签里的一行问题摘要。 */
export function topicLabel(record: BtwHistoryRecord, maxChars = 28): string {
  const line = record.question.trim().split(/\r?\n/)[0] ?? "";
  return line.length > maxChars ? `${line.slice(0, maxChars)}…` : line;
}
