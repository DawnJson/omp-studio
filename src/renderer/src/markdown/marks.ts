// 文字里的"字面标记"（TSP md.marks：用户消息里的 @文件、技能、提及）：把 text 按标记切成 普通 / 标记 片段（纯函数）。
// 同一位置多个标记可匹配时取最长的；不重叠、按出现顺序，空标记忽略。

export interface TextMark {
  /** 要匹配的字面文字。 */
  readonly t: string;
  /** 命中时包的 span 的类名。 */
  readonly className: string;
}

export interface MarkPiece {
  readonly text: string;
  /** 命中标记时的类名；普通文字为 undefined。 */
  readonly className?: string;
}

export function splitMarks(text: string, marks: readonly TextMark[]): MarkPiece[] {
  const live = marks.filter((mark) => mark.t !== "").sort((a, b) => b.t.length - a.t.length);
  if (live.length === 0 || text === "") return [{ text }];
  const pieces: MarkPiece[] = [];
  let plainFrom = 0;
  let at = 0;
  while (at < text.length) {
    const hit = live.find((mark) => text.startsWith(mark.t, at));
    if (!hit) {
      at += 1;
      continue;
    }
    if (at > plainFrom) pieces.push({ text: text.slice(plainFrom, at) });
    pieces.push({ text: hit.t, className: hit.className });
    at += hit.t.length;
    plainFrom = at;
  }
  if (plainFrom < text.length) pieces.push({ text: text.slice(plainFrom) });
  return pieces;
}
