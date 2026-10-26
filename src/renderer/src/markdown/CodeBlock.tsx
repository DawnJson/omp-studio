// 代码块（spec 4.10）：头部语言名 + 复制；围栏闭合后才高亮（只改颜色）；全文显示（omp 的 md 节点不限行数）。
// ```svg 围栏闭合后画成图，头部多一个切回源码的按钮。
import { memo, useEffect, useMemo, useState } from "react";
import { useT } from "../i18n/use-t.ts";
import { Check, Code, CopyIcon } from "../icons.tsx";
import { onThemeChange } from "../ui/theme-change.ts";
import { cachedHighlight, highlight, type HighlightToken } from "./highlight.ts";
import { resolveLanguage } from "./highlight-languages.ts";
import { FIGURE_TOKENS, prepareSvg, svgDataUrl } from "./svg-figure.ts";

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
  // ```svg 围栏闭合后画成图（svg-figure.ts）；头部的 <> 切回源码，画不出来时也退回源码。
  const figure = closed && lang.toLowerCase() === "svg";
  const [showSource, setShowSource] = useState(false);
  const [failed, setFailed] = useState(false);
  const drawing = figure && !showSource && !failed;
  const tokens = useHighlighted(code, lang, closed && !drawing);
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
    <div className="md-codeblock" data-anchor data-testid="codeblock" data-figure={drawing || undefined}>
      <div className="md-codehead">
        <span className="md-codelang">{lang === "" ? "text" : lang}</span>
        <span className="md-codeactions">
          {figure && !failed && (
            <button
              type="button"
              className="md-codebtn"
              aria-pressed={showSource}
              aria-label={t("code.source")}
              title={t("code.source")}
              data-testid="codeblock-source"
              onClick={() => setShowSource((value) => !value)}
            >
              <Code size={14} />
            </button>
          )}
          <button
            type="button"
            className="md-codebtn"
            onClick={copy}
            aria-label={t("code.copy")}
            title={t("code.copy")}
          >
            {copied ? <Check size={14} /> : <CopyIcon size={14} />}
          </button>
        </span>
        <span className="md-sr" aria-live="polite">
          {copied ? t("common.copied") : ""}
        </span>
      </div>
      {drawing ? (
        <SvgImage code={code} alt={t("code.figure")} onFail={() => setFailed(true)} />
      ) : (
        <>
          {failed && <p className="md-figure-note">{t("code.figureFailed")}</p>}
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
        </>
      )}
    </div>
  );
});

/** 当前主题下每个图色名的实际颜色（tokens.css）。 */
function readPalette(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    Object.entries(FIGURE_TOKENS).map(([name, token]) => [name, style.getPropertyValue(token).trim()]),
  );
}

/** 图本身：<img> 显示（不执行脚本、不加载外部资源）；切换主题时按新颜色重画。 */
function SvgImage({ code, alt, onFail }: { code: string; alt: string; onFail: () => void }) {
  const [theme, setTheme] = useState(0);
  useEffect(() => onThemeChange(() => setTheme((value) => value + 1)), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const src = useMemo(() => svgDataUrl(prepareSvg(code, readPalette())), [code, theme]);
  return (
    <div className="md-figure">
      <img src={src} alt={alt} data-testid="codeblock-figure" onError={onFail} />
    </div>
  );
}
