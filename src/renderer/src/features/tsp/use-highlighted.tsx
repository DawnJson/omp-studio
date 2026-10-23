// 过程区的语法高亮：语言怎么定（lang 优先，没有就看 path 扩展名）、异步高亮的 hook、token → span。code / diff / tool 命令共用，
// 底下是 markdown/highlight.ts 的同一个高亮器。
import { useEffect, useState } from "react";
import { cachedHighlight, highlight, resolveLanguage, type HighlightToken } from "../../markdown/highlight.ts";

const EXTENSION_LANG = /\.([A-Za-z0-9+]+)$/;

/** `lang` 优先，没有就按 `path` 的扩展名 / 文件名；认不出来是 null（画纯文本）。 */
export function codeLanguage(p: Readonly<Record<string, unknown>>): string | null {
  if (typeof p.lang === "string") return resolveLanguage(p.lang);
  if (typeof p.path === "string") {
    const ext = EXTENSION_LANG.exec(p.path)?.[1];
    if (ext) return resolveLanguage(ext);
    return resolveLanguage(p.path.split(/[\\/]/).pop() ?? "");
  }
  return null;
}

/** 没加载完 / 没有语言时是 null，调用方先画纯文本，加载完只改颜色。 */
export function useHighlighted(code: string, lang: string | null): HighlightToken[][] | null {
  const [tokens, setTokens] = useState<HighlightToken[][] | null>(() => (lang ? cachedHighlight(code, lang) : null));
  useEffect(() => {
    if (!lang) {
      setTokens(null);
      return;
    }
    const cached = cachedHighlight(code, lang);
    if (cached) {
      setTokens(cached);
      return;
    }
    let alive = true;
    highlight(code, lang).then(
      (result) => alive && setTokens(result),
      () => alive && setTokens(null),
    );
    return () => {
      alive = false;
    };
  }, [code, lang]);
  return lang ? tokens : null;
}

export function tokenStyle(token: HighlightToken): { color?: string; fontStyle?: string; fontWeight?: string } {
  return {
    ...(token.color !== undefined && { color: token.color }),
    ...(token.italic && { fontStyle: "italic" }),
    ...(token.bold && { fontWeight: "var(--fw-strong)" }),
  };
}

export function Tokens({ tokens, fallback }: { tokens: readonly HighlightToken[] | undefined; fallback: string }) {
  if (!tokens) return <>{fallback}</>;
  return (
    <>
      {tokens.map((token, index) => (
        <span key={index} style={tokenStyle(token)}>
          {token.text}
        </span>
      ))}
    </>
  );
}
