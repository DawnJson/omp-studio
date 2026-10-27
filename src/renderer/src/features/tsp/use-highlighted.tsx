// 过程区的语法高亮：语言怎么定（lang 优先，没有就看 path 扩展名）、token → span。code / diff / tool 命令共用，
// 异步高亮的 hook 是 markdown/highlight.ts 的 useHighlighted（同一个高亮器）。
import type { HighlightToken } from "../../markdown/highlight.ts";
import { resolveLanguage } from "../../markdown/highlight-languages.ts";

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
