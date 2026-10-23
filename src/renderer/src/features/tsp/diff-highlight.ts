// diff 的语法高亮数据整理（纯函数）：一个 hunk 拆成"旧侧"（上下文 + 删）和"新侧"（上下文 + 增）两段源码分别高亮，
// 再把每行的 token 取回来；词级强调（WordRange）叠在 token 上，在边界处切开。
import type { DiffLine, WordRange } from "./diff-parse.ts";

export interface DiffSides {
  oldCode: string;
  newCode: string;
  /** 行 → 它在对应侧源码里的行号（0 起）。ctx 行两侧都有，add 只在新侧，del 只在旧侧。 */
  oldAt: ReadonlyMap<DiffLine, number>;
  newAt: ReadonlyMap<DiffLine, number>;
}

export function diffSides(lines: readonly DiffLine[]): DiffSides {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  const oldAt = new Map<DiffLine, number>();
  const newAt = new Map<DiffLine, number>();
  for (const line of lines) {
    if (line.kind !== "add") {
      oldAt.set(line, oldLines.length);
      oldLines.push(line.text);
    }
    if (line.kind !== "del") {
      newAt.set(line, newLines.length);
      newLines.push(line.text);
    }
  }
  return { oldCode: oldLines.join("\n"), newCode: newLines.join("\n"), oldAt, newAt };
}

interface TextToken {
  readonly text: string;
}

/** 一行的 token：删 / 上下文取旧侧，增取新侧；高亮还没出来、或 token 拼回去和原行对不上就返回 undefined（画纯文本）。 */
export function lineTokens<T extends TextToken>(
  line: DiffLine,
  sides: DiffSides,
  oldTokens: readonly (readonly T[])[] | null,
  newTokens: readonly (readonly T[])[] | null,
): readonly T[] | undefined {
  const fromNew = line.kind === "add";
  const tokens = fromNew ? newTokens : oldTokens;
  const index = (fromNew ? sides.newAt : sides.oldAt).get(line);
  const found = index === undefined ? undefined : tokens?.[index];
  if (!found) return undefined;
  return found.map((token) => token.text).join("") === line.text ? found : undefined;
}

export interface EmphasisPiece<T> {
  token: T;
  /** 落在词级强调范围里。 */
  em: boolean;
}

/** token 序列按词级范围切开：范围内的片段 em = true；没有范围就原样返回。 */
export function applyRange<T extends TextToken>(tokens: readonly T[], range: WordRange | null): EmphasisPiece<T>[] {
  const out: EmphasisPiece<T>[] = [];
  const live = range !== null && range.from < range.to;
  let at = 0;
  for (const token of tokens) {
    const start = at;
    const end = at + token.text.length;
    at = end;
    if (token.text === "") continue;
    if (!live || range.to <= start || range.from >= end) {
      out.push({ token, em: false });
      continue;
    }
    const from = Math.max(range.from, start) - start;
    const to = Math.min(range.to, end) - start;
    if (from > 0) out.push({ token: { ...token, text: token.text.slice(0, from) }, em: false });
    out.push({ token: { ...token, text: token.text.slice(from, to) }, em: true });
    if (to < token.text.length) out.push({ token: { ...token, text: token.text.slice(to) }, em: false });
  }
  return out;
}
