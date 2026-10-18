// 代码块（spec 4.10）：头部语言名 + 复制；围栏闭合后才高亮（只改颜色）；>24 行在流式结束后折叠到 20 行。
import { memo, useEffect, useState } from "react";
import { useT } from "../i18n/use-t.ts";
import { Check, CopyIcon } from "../icons.tsx";
import { cachedHighlight, highlight, resolveLanguage, type HighlightToken } from "./highlight.ts";

const COLLAPSE_OVER = 24;
const COLLAPSED_LINES = 20;

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
  /** 整条消息是否已经流完；折叠要等它。 */
  streaming: boolean;
}

export const CodeBlock = memo(function CodeBlock({ code, lang, closed, streaming }: CodeBlockProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const tokens = useHighlighted(code, lang, closed);
  const plainLines = code.split("\n");
  const isDiff = resolveLanguage(lang) === "diff";
  const collapsible = !streaming && closed && plainLines.length > COLLAPSE_OVER;
  const collapsed = collapsible && !expanded;
  const shown = collapsed ? plainLines.slice(0, COLLAPSED_LINES) : plainLines;

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
      <pre className="md-codebody" data-collapsed={collapsed || undefined}>
        <code>
          {shown.map((line, index) => (
            <span key={index} className={lineClass(line, isDiff)}>
              {tokens?.[index]
                ? tokens[index].map((token, i) => (
                    <span
                      key={i}
                      style={{ color: token.color, fontStyle: token.italic ? "italic" : undefined, fontWeight: token.bold ? "var(--fw-strong)" : undefined }}
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
      {collapsed && (
        <button type="button" className="md-codeexpand" onClick={() => setExpanded(true)}>
          {t("code.expand", { n: plainLines.length })}
        </button>
      )}
    </div>
  );
});
