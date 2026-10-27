// 一个 hunk 的语法高亮：旧版本（上下文 + 删除）和新版本（上下文 + 新增）各高亮一次，再按行对回 hunk.lines。
// 用 markdown/highlight.ts 的 useHighlighted（异步，语言包按需加载）：两边都高亮完才着色，之前先显示纯文本。
import { useMemo } from "react";
import type { GitDiffHunk } from "../../../../shared/git.ts";
import { useHighlighted, type HighlightToken } from "../../markdown/highlight.ts";
import { resolveLanguage } from "../../markdown/highlight-languages.ts";

export type LineTokens = (HighlightToken[] | null)[];

/** 显示和高亮都去掉 CRLF 文件里行尾的 \r（留着它在 pre-wrap 里会多出一个换行）。 */
export const displayText = (text: string): string => (text.endsWith("\r") ? text.slice(0, -1) : text);

export function languageOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name.toLowerCase() === "dockerfile") return "dockerfile";
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? null : resolveLanguage(name.slice(dot + 1));
}

export function useHunkTokens(hunk: GitDiffHunk, lang: string | null): LineTokens | null {
  const { oldCode, newCode } = useMemo(
    () => ({
      oldCode: hunk.lines
        .filter((line) => line.kind !== "add")
        .map((line) => displayText(line.text))
        .join("\n"),
      newCode: hunk.lines
        .filter((line) => line.kind !== "del")
        .map((line) => displayText(line.text))
        .join("\n"),
    }),
    [hunk],
  );
  const old = useHighlighted(oldCode, lang);
  const next = useHighlighted(newCode, lang);

  return useMemo(() => {
    if (old === null || next === null) return null;
    let oldAt = 0;
    let newAt = 0;
    return hunk.lines.map((line) => {
      if (line.kind === "del") return old[oldAt++] ?? null;
      if (line.kind === "add") return next[newAt++] ?? null;
      oldAt += 1;
      return next[newAt++] ?? null;
    });
  }, [old, next, hunk]);
}
