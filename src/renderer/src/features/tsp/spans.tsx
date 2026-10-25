// 样式片段的渲染（规范 Text and Code / Spans）：token 解析在 span-tokens.ts，颜色在 tsp.css 里映射到 tokens.css。
import { Fragment, type ReactNode } from "react";
import type { TspSpan, TspText } from "../../../../shared/tsp/tsp.generated.ts";
import { splitUrls } from "../../../../shared/tsp/linkify.ts";
import { openHref } from "./actions.ts";
import { keycapLabel } from "./fmt.ts";
import { spanTokens, cleanGlyphs } from "./span-tokens.ts";
import { useTspContext } from "./tsp-context.ts";

export { semanticOf, spanClass, cleanGlyphs } from "./span-tokens.ts";

/** `ctrl+r` 这种不含空格的键 id → 键帽符号（⌃R）；不是键 id 返回 null。 */
function keyId(text: string): string | null {
  if (/\s/.test(text) || text === "") return null;
  return text.split("+").map(keycapLabel).join("");
}

/** 纯文字里的 http(s) 网址画成链接（omp 的 text 节点不带 href，如 `/trace` 的地址）；没有网址就是原文。 */
function Linkified({ text }: { text: string }) {
  const ctx = useTspContext();
  const pieces = splitUrls(text);
  if (pieces === null) return <>{text}</>;
  return (
    <>
      {pieces.map((piece, index) => {
        const url = piece.url;
        if (url === undefined) return <Fragment key={index}>{piece.text}</Fragment>;
        const open = () => (ctx ? openHref(url, ctx) : void window.studio.openExternal(url));
        return (
          <a
            key={index}
            className="tsp-link"
            data-href={url}
            title={url}
            role="link"
            tabIndex={0}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              open();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") open();
            }}
          >
            {piece.text}
          </a>
        );
      })}
    </>
  );
}

function SpanView({ span }: { span: TspSpan }) {
  const ctx = useTspContext();
  const tokens = spanTokens(span.s);
  if (tokens.includes("hide")) return null;
  const text = cleanGlyphs(span.t);
  if (text === "") return null;
  const classes = tokens.map((token) => `tsp-t-${token}`);
  if (span.fx === "shimmer" || span.fx === "pulse") classes.push(`tsp-fx-${span.fx}`);
  const plain = tokens.includes("path") || tokens.includes("key") || span.href !== undefined;
  let content: ReactNode = plain ? text : <Linkified text={text} />;
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
  if (typeof text === "string") return <Linkified text={cleanGlyphs(text)} />;
  return (
    <>
      {text.map((span, index) => (
        <Fragment key={index}>
          {typeof span === "string" ? <Linkified text={cleanGlyphs(span)} /> : <SpanView span={span} />}
        </Fragment>
      ))}
    </>
  );
}

/** TspSpans 会不会画出 `.tsp-link`（带 href 的片段，或纯文字里的网址）；判断和 SpanView / Linkified 一致。 */
export function spansHaveLink(text: TspText | undefined): boolean {
  if (text === undefined) return false;
  const hasUrl = (value: string): boolean =>
    splitUrls(cleanGlyphs(value))?.some((piece) => piece.url !== undefined) === true;
  if (typeof text === "string") return hasUrl(text);
  return text.some((span) => {
    if (typeof span === "string") return hasUrl(span);
    const tokens = spanTokens(span.s);
    if (tokens.includes("hide") || cleanGlyphs(span.t) === "") return false;
    if (span.href !== undefined) return true;
    return !tokens.includes("path") && !tokens.includes("key") && hasUrl(span.t);
  });
}

/** TspText 的纯文字（tooltip、aria 用）。 */
export function plainText(text: TspText | undefined): string {
  if (text === undefined) return "";
  if (typeof text === "string") return cleanGlyphs(text);
  return text.map((span) => (typeof span === "string" ? span : cleanGlyphs(span.t))).join("");
}
