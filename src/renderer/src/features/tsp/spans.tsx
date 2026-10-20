// 样式片段的渲染（规范 Text and Code / Spans）：token 解析在 span-tokens.ts，颜色在 tsp.css 里映射到 tokens.css。
import { Fragment, type ReactNode } from "react";
import type { TspSpan, TspText } from "../../../../shared/tsp/tsp.generated.ts";
import { openHref } from "./actions.ts";
import { keycapLabel } from "./fmt.ts";
import { spanTokens, cleanGlyphs } from "./span-tokens.ts";
import { useTspContext } from "./tsp-context.ts";

export { semanticOf, spanClass, spanTokens, cleanGlyphs } from "./span-tokens.ts";

/** `ctrl+r` 这种不含空格的键 id → 键帽符号（⌃R）；不是键 id 返回 null。 */
function keyId(text: string): string | null {
  if (/\s/.test(text) || text === "") return null;
  return text.split("+").map(keycapLabel).join("");
}

function SpanView({ span }: { span: TspSpan }) {
  const ctx = useTspContext();
  const tokens = spanTokens(span.s);
  if (tokens.includes("hide")) return null;
  const text = cleanGlyphs(span.t);
  if (text === "") return null;
  const classes = tokens.map((token) => `tsp-t-${token}`);
  if (span.fx === "shimmer" || span.fx === "pulse") classes.push(`tsp-fx-${span.fx}`);
  let content: ReactNode = text;
  let title: string | undefined;
  if (tokens.includes("path") && text.includes("/")) {
    const cut = text.lastIndexOf("/") + 1;
    content = (
      <>
        <span className="tsp-dir">{text.slice(0, cut)}</span>
        {text.slice(cut)}
      </>
    );
  } else if (tokens.includes("key")) {
    const id = keyId(text);
    if (id !== null) {
      content = id;
      title = text;
    }
  }
  if (span.href !== undefined) {
    const href = span.href;
    classes.push("tsp-link");
    return (
      <a
        className={classes.join(" ")}
        data-href={href}
        title={title ?? href}
        role="link"
        tabIndex={0}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (ctx) openHref(href, ctx);
          else if (/^https?:/i.test(href)) void window.studio.openExternal(href);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && ctx) openHref(href, ctx);
        }}
      >
        {content}
      </a>
    );
  }
  if (classes.length === 0) return <>{content}</>;
  return (
    <span className={classes.join(" ")} title={title}>
      {content}
    </span>
  );
}

/** 一段文字：纯字符串，或一串带样式的片段。 */
export function TspSpans({ text }: { text: TspText | undefined }) {
  if (text === undefined) return null;
  if (typeof text === "string") return <>{cleanGlyphs(text)}</>;
  return (
    <>
      {text.map((span, index) => (
        <Fragment key={index}>{typeof span === "string" ? cleanGlyphs(span) : <SpanView span={span} />}</Fragment>
      ))}
    </>
  );
}

/** TspText 的纯文字（tooltip、aria 用）。 */
export function plainText(text: TspText | undefined): string {
  if (text === undefined) return "";
  if (typeof text === "string") return cleanGlyphs(text);
  return text.map((span) => (typeof span === "string" ? span : cleanGlyphs(span.t))).join("");
}
