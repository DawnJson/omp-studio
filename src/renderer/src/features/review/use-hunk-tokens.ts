// 一个 hunk 的语法高亮：旧版本（上下文 + 删除）和新版本（上下文 + 新增）各高亮一次，再按行对回 hunk.lines。
// 复用 markdown/highlight.ts 的 Shiki（异步，语言包按需加载）：没加载完时先显示纯文本，加载完只改颜色。
import { useEffect, useMemo, useState } from "react";
import type { GitDiffHunk } from "../../../../shared/git.ts";
import { cachedHighlight, highlight, type HighlightToken } from "../../markdown/highlight.ts";
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
  const [done, setDone] = useState<{
    old: HighlightToken[][];
    next: HighlightToken[][];
    oldCode: string;
    newCode: string;
  } | null>(() => {
    const old = lang === null ? null : cachedHighlight(oldCode, lang);
    const next = lang === null ? null : cachedHighlight(newCode, lang);
    return old && next ? { old, next, oldCode, newCode } : null;
  });

  useEffect(() => {
    if (lang === null) return;
    let current = true;
    Promise.all([highlight(oldCode, lang), highlight(newCode, lang)]).then(
      ([old, next]) => current && old && next && setDone({ old, next, oldCode, newCode }),
      () => undefined, // 高亮失败只是没有颜色
    );
    return () => {
      current = false;
    };
  }, [oldCode, newCode, lang]);

  return useMemo(() => {
    if (done === null || done.oldCode !== oldCode || done.newCode !== newCode) return null;
    let oldAt = 0;
    let newAt = 0;
    return hunk.lines.map((line) => {
      if (line.kind === "del") return done.old[oldAt++] ?? null;
      if (line.kind === "add") return done.next[newAt++] ?? null;
      oldAt += 1;
      return done.next[newAt++] ?? null;
    });
  }, [done, hunk, oldCode, newCode]);
}
