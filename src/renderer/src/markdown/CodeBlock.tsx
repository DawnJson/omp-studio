// 代码块（spec 4.10）：头部语言名 + 复制；围栏闭合后才高亮（只改颜色）；全文显示（omp 的 md 节点不限行数）。
import { memo, useEffect, useState } from "react";
import { useT } from "../i18n/use-t.ts";
import { Check, CopyIcon } from "../icons.tsx";
import { cachedHighlight, highlight, resolveLanguage, type HighlightToken } from "./highlight.ts";

function useHighlighted(code: string, lang: string, enabled: boolean): HighlightToken[][] | null {
  const [tokens, setTokens] = useState<HighlightToken[][] | null>(() => (enabled ? cachedHighlight(code, lang) : null));
  useEffect(() => {
    if (!enabled || !resolveLanguage(lang)) return;
    let cancelled = false;
    highlight(code, lang).then(
      (result) => {
        if (!cancelled) setTokens(result);
      },
      (error: unknown) => console.error("代码高亮失败", error),
    );
    return () => {
      cancelled = true;
    };
  }, [code, lang, enabled]);
  return enabled ? tokens : null;
}

function lineClass(line: string, isDiff: boolean): string {
  if (!isDiff) return "md-line";
  if (line.startsWith("+") && !line.startsWith("+++")) return "md-line md-diff-add";
  if (line.startsWith("-") && !line.startsWith("---")) return "md-line md-diff-del";
  return "md-line";
}

interface CodeBlockProps {
  code: string;
  lang: string;
  closed: boolean;
}

export const CodeBlock = memo(function CodeBlock({ code, lang, closed }: CodeBlockProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const tokens = useHighlighted(code, lang, closed);
  const lines = code.split("\n");
  const isDiff = resolveLanguage(lang) === "diff";

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    navigator.clipboard.writeText(code).then(
      () => setCopied(true),
      (error: unknown) => console.error("复制失败", error),
    );
  };

  return (
    <div className="md-codeblock" data-anchor data-testid="codeblock">
      <div className="md-codehead">
        <span className="md-codelang">{lang === "" ? "text" : lang}</span>
        <button type="button" className="md-codecopy" onClick={copy} aria-label={t("code.copy")} title={t("code.copy")}>
          {copied ? <Check size={14} /> : <CopyIcon size={14} />}
        </button>
        <span className="md-sr" aria-live="polite">
          {copied ? t("common.copied") : ""}
        </span>
      </div>
      <pre className="md-codebody">
        <code>
          {lines.map((line, index) => (
            <span key={index} className={lineClass(line, isDiff)}>
              {tokens?.[index]
                ? tokens[index].map((token, i) => (
                    <span
                      key={i}
                      style={{
                        color: token.color,
                        fontStyle: token.italic ? "italic" : undefined,
                        fontWeight: token.bold ? "var(--fw-strong)" : undefined,
                      }}
                    >
                      {token.text}
                    </span>
                  ))
                : line}
              {"\n"}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
});
