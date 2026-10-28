// 代码块（spec 4.10）：头部语言名 + 复制；围栏闭合后才高亮（只改颜色）；全文显示（omp 的 md 节点不限行数）。
// ```svg 和 ```mermaid 围栏闭合后画成图，头部多一个切回源码的按钮。
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "../i18n/use-t.ts";
import { Check, Code, CopyIcon } from "../icons.tsx";
import { onThemeChange } from "../ui/theme-change.ts";
import { useHighlighted } from "./highlight.ts";
import { resolveLanguage } from "./highlight-languages.ts";
import { tokenProps } from "./highlight-tokens.ts";
import { useMermaid } from "./mermaid.ts";
import { FIGURE_TOKENS, prepareMermaidSvg, prepareSvg, svgDataUrl } from "./svg-figure.ts";

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
  // ```svg 围栏闭合后画成图（svg-figure.ts）；```mermaid 先在 worker 里画成 SVG（mermaid.ts），画好之前照常显示源码。
  // 头部的 <> 切回源码，画不出来时也退回源码。
  const kind = closed ? lang.toLowerCase() : "";
  const figure = kind === "svg" || kind === "mermaid";
  const mermaid = useMermaid(kind === "mermaid" ? code : null);
  const [showSource, setShowSource] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const failed = imageFailed || (mermaid !== null && "error" in mermaid);
  const mermaidSvg = mermaid !== null && "svg" in mermaid ? mermaid.svg : null;
  const prepare = useCallback(
    (style: CSSStyleDeclaration) =>
      mermaidSvg === null
        ? prepareSvg(code, readPalette(style))
        : prepareMermaidSvg(mermaidSvg, { bg: token(style, "--bg-tool"), fg: token(style, "--text") }),
    [code, mermaidSvg],
  );
  const ready = figure && !failed && (kind === "svg" || mermaidSvg !== null);
  const drawing = ready && !showSource;
  const tokens = useHighlighted(code, closed && !drawing ? lang : null);
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
          {ready && (
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
        <FigureImage prepare={prepare} alt={t("code.figure")} onFail={() => setImageFailed(true)} />
      ) : (
        <>
          {failed && <p className="md-figure-note">{t("code.figureFailed")}</p>}
          <pre className="md-codebody">
            <code>
              {lines.map((line, index) => (
                <span key={index} className={lineClass(line, isDiff)}>
                  {tokens?.[index]
                    ? tokens[index].map((token, i) => (
                        <span key={i} {...tokenProps(token)}>
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

function token(style: CSSStyleDeclaration, name: string): string {
  return style.getPropertyValue(name).trim();
}

/** 当前主题下每个图色名的实际颜色（tokens.css）。 */
function readPalette(style: CSSStyleDeclaration): Record<string, string> {
  return Object.fromEntries(Object.entries(FIGURE_TOKENS).map(([name, value]) => [name, token(style, value)]));
}

/** 图本身：<img> 显示（不执行脚本、不加载外部资源）；切换主题时按新颜色重画。 */
function FigureImage({
  prepare,
  alt,
  onFail,
}: {
  prepare: (style: CSSStyleDeclaration) => string;
  alt: string;
  onFail: () => void;
}) {
  const [theme, setTheme] = useState(0);
  useEffect(() => onThemeChange(() => setTheme((value) => value + 1)), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const src = useMemo(() => svgDataUrl(prepare(getComputedStyle(document.documentElement))), [prepare, theme]);
  return (
    <div className="md-figure">
      <img src={src} alt={alt} data-testid="codeblock-figure" onError={onFail} />
    </div>
  );
}
