// 命令面板的模糊匹配：空白分词，每个词都要出现在文本里（连续子串优先，其次按顺序的子序列）。
// 返回要高亮的字符下标和得分（越大越靠前）。纯函数，中英文通用。

export interface FuzzyMatch {
  score: number;
  /** text 里被匹配的字符下标，升序、不重复。 */
  indices: number[];
}

function matchWord(word: string, lower: string): { score: number; indices: number[] } | null {
  const at = lower.indexOf(word);
  if (at !== -1) {
    const atWordStart = at === 0 || /[\s/\\\-_.]/.test(lower.charAt(at - 1));
    return {
      // 连续命中比零散命中强得多；开头、词首命中再加分；越靠前越好。
      score: 100 + word.length * 4 + (atWordStart ? 20 : 0) - Math.min(at, 50) / 5,
      indices: Array.from({ length: word.length }, (_, offset) => at + offset),
    };
  }
  const indices: number[] = [];
  let from = 0;
  for (const char of word) {
    const found = lower.indexOf(char, from);
    if (found === -1) return null;
    indices.push(found);
    from = found + 1;
  }
  const spread = (indices[indices.length - 1] as number) - (indices[0] as number) + 1;
  return { score: Math.max(1, 40 - (spread - word.length)), indices };
}

/** query 为空（或只有空白）时匹配一切、得分 0、不高亮。 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");
  if (words.length === 0) return { score: 0, indices: [] };
  const lower = text.toLowerCase();
  let score = 0;
  const hit = new Set<number>();
  for (const word of words) {
    const match = matchWord(word, lower);
    if (match === null) return null;
    score += match.score;
    for (const index of match.indices) hit.add(index);
  }
  return { score, indices: [...hit].sort((a, b) => a - b) };
}
