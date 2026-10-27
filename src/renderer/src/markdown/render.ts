// markdown-it 的 token → React 元素。用户文本不进 dangerouslySetInnerHTML：所有文本都经 React 转义（唯一例外是 KaTeX 的输出，见 renderMath），
// 链接只放行 http/https，图片只放行 markdown-it 已校验的 data:image。无 JSX，方便在 Node 里测试。
import type Katex from "katex";
import { createElement as h, Fragment, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import type { MarkdownBlock, Token } from "./parse.ts";

export interface RenderContext {
  /** 用户点了一个已放行的链接。 */
  openLink(href: string): void;
  /** 代码块的渲染由调用方决定（高亮、复制按钮）；缺省是纯文本 <pre>。 */
  renderCode?(props: { code: string; lang: string; closed: boolean }): ReactNode;
  /** 文字片段的渲染（TSP md.marks 在这里把字面标记包成 span）；缺省是原文。 */
  renderText?: ((text: string) => ReactNode) | undefined;
  /** KaTeX 按需加载（Markdown.tsx 的 useKatex）；还没加载完时公式先按原文显示在 code 里。 */
  katex?: typeof Katex | null | undefined;
}

interface TreeNode {
  token: Token;
  children: TreeNode[];
}

function buildTree(tokens: readonly Token[]): TreeNode[] {
  const root: TreeNode = { token: tokens[0] as Token, children: [] };
  const stack: TreeNode[] = [root];
  for (const token of tokens) {
    const top = stack[stack.length - 1] as TreeNode;
    if (token.nesting === -1) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node: TreeNode = { token, children: [] };
    top.children.push(node);
    if (token.nesting === 1) stack.push(node);
  }
  return root.children;
}

/** markdown-it 的 attrGet 返回 string | number | null；这里的属性都是字符串。 */
function attr(token: Token, name: string): string | null {
  const value = token.attrGet(name);
  return value === null ? null : String(value);
}

/** 与主进程 openExternal（parseExternalUrl）一致：只有 http/https 可点；mailto 等不渲染成链接。 */
const openableLink = /^https?:/i;
const dataImage = /^data:image\/(gif|png|jpe?g|webp);/i;

/** 只有这些协议的链接才交给系统去打开；markdown-it 的 validateLink 已经挡掉了 javascript:/vbscript:/file:/data:。 */
function isOpenableHref(href: string): boolean {
  return openableLink.test(href);
}

function alignStyle(token: Token): CSSProperties | undefined {
  const style = attr(token, "style");
  const match = style ? /text-align:\s*(left|center|right)/.exec(style) : null;
  return match ? { textAlign: match[1] as CSSProperties["textAlign"] } : undefined;
}

function renderInlineChildren(nodes: TreeNode[], ctx: RenderContext): ReactNode[] {
  return nodes.map((node, index) => renderInline(node, index, ctx));
}

function renderInline(node: TreeNode, key: number, ctx: RenderContext): ReactNode {
  const { token } = node;
  const children = renderInlineChildren(node.children, ctx);
  switch (token.type) {
    case "text":
    case "html_inline":
      return ctx.renderText ? h(Fragment, { key }, ctx.renderText(token.content)) : token.content;
    case "softbreak":
      return "\n";
    case "hardbreak":
      return h("br", { key });
    case "code_inline":
      return h("code", { key, className: "md-code-inline" }, token.content);
    case "math_inline":
      return renderMath(token, key, false, ctx);
    case "em_open":
      return h("em", { key }, children);
    case "strong_open":
      return h("strong", { key }, children);
    case "s_open":
      return h("s", { key }, children);
    case "link_open": {
      const href = attr(token, "href") ?? "";
      if (!isOpenableHref(href)) return h("span", { key, title: href }, children);
      const onClick = (event: MouseEvent) => {
        event.preventDefault();
        ctx.openLink(href);
      };
      return h("a", { key, href, title: href, className: "md-link", onClick, rel: "noreferrer noopener" }, children);
    }
    case "image": {
      const src = attr(token, "src") ?? "";
      const alt = token.content;
      if (dataImage.test(src)) return h("img", { key, src, alt, className: "md-image" });
      // 远程图片不加载：显示成链接（或纯文本）。
      if (isOpenableHref(src)) {
        const onClick = (event: MouseEvent) => {
          event.preventDefault();
          ctx.openLink(src);
        };
        return h(
          "a",
          { key, href: src, title: src, className: "md-link", onClick, rel: "noreferrer noopener" },
          alt || src,
        );
      }
      return alt;
    }
    default:
      return token.content === "" ? children : token.content;
  }
}

function renderInlineToken(token: Token, ctx: RenderContext): ReactNode[] {
  return renderInlineChildren(buildTree(token.children ?? []), ctx);
}

/** 与 math.ts 的分隔符对应；公式出错时按原文显示要把分隔符带上。 */
const mathClose: Record<string, string> = { $: "$", "\\(": "\\)", $$: "$$", "\\[": "\\]" };

/**
 * 公式交给 KaTeX。这是本文件唯一使用 dangerouslySetInnerHTML 的地方，且只放 KaTeX 的输出：
 * trust:false 禁掉 \href / \url / \includegraphics 等，strict:"ignore" 不让宏警告打断，
 * KaTeX 自己转义公式里的文字；用户文本不会直接进入 innerHTML。
 * 用 throwOnError:true 再自己 catch，是为了坏公式按原文（--st-error 色）显示，而不是 KaTeX 的红色报错样式。
 */
function renderMath(token: Token, key: number, display: boolean, ctx: RenderContext): ReactNode {
  const className = display ? "md-math-block" : "md-math";
  const raw = `${token.markup}${display ? "\n" : ""}${token.content}${display ? "\n" : ""}${mathClose[token.markup] ?? ""}`;
  const tag = display ? "div" : "span";
  if (!ctx.katex) return h(tag, { key, className }, h("code", null, raw));
  try {
    const html = ctx.katex.renderToString(token.content, {
      displayMode: display,
      throwOnError: true,
      trust: false,
      strict: "ignore",
      output: "htmlAndMathml",
    });
    return h(tag, { key, className, dangerouslySetInnerHTML: { __html: html } });
  } catch {
    return h(tag, { key, className: `${className} md-math-error` }, raw);
  }
}

function renderBlockNode(
  node: TreeNode,
  key: number,
  ctx: RenderContext,
  closedFence: boolean,
  lastItem = false,
  ordinal: number | null = null,
): ReactNode {
  const { token } = node;
  const kids = (): ReactNode[] => node.children.map((child, index) => renderBlockNode(child, index, ctx, closedFence));
  const listItems = (list: TreeNode, start: number | null = null): ReactNode[] =>
    list.children.map((child, index) =>
      renderBlockNode(
        child,
        index,
        ctx,
        closedFence,
        index === list.children.length - 1,
        start === null ? null : start + index,
      ),
    );
  switch (token.type) {
    case "inline":
      return renderInlineToken(token, ctx);
    case "paragraph_open":
      return token.hidden ? kids() : h("p", { key }, kids());
    case "heading_open":
      return h(token.tag, { key }, kids());
    case "blockquote_open":
      return h("blockquote", { key }, kids());
    case "bullet_list_open":
      return h("ul", { key }, listItems(node));
    case "ordered_list_open": {
      const start = Number(token.attrGet("start") ?? 1);
      return h("ol", { key, start: start === 1 ? undefined : start }, listItems(node, start));
    }
    case "list_item_open": {
      const task = attr(token, "data-task");
      // 流式光标挂在"自己是列表最后一项、且直接子节点里没有嵌套列表"的 li 上（markdown.css 的 data-caret），不用 :has()。
      const nested = node.children.some(
        (child) => child.token.type === "bullet_list_open" || child.token.type === "ordered_list_open",
      );
      const caret = lastItem && !nested ? "" : undefined;
      if (task === null) {
        // 有序列表的序号写成真文字（不用 ::marker）：Chromium 复制选中文字时不带 ::marker，"1. 2. " 会丢（2026-10-27 实测）。
        const number = ordinal === null ? null : h("span", { className: "md-ol-n" }, `${ordinal}. `);
        return h("li", { key, "data-caret": caret }, number, kids());
      }
      // 任务列表：只读复选框。
      const checkbox = h("input", {
        type: "checkbox",
        checked: task === "done",
        readOnly: true,
        tabIndex: -1,
        "aria-hidden": true,
      });
      return h("li", { key, className: "md-task", "data-caret": caret }, checkbox, kids());
    }
    case "hr":
      return h("hr", { key });
    case "math_block":
      return renderMath(token, key, true, ctx);
    case "fence":
    case "code_block": {
      const lang = token.type === "fence" ? (token.info.trim().split(/\s+/)[0] ?? "") : "";
      const code = token.content.replace(/\n$/, "");
      const closed = token.type === "fence" ? closedFence : true;
      if (ctx.renderCode) return h("div", { key }, ctx.renderCode({ code, lang, closed }));
      return h("pre", { key }, h("code", null, code));
    }
    case "table_open":
      return h("div", { key, className: "md-table" }, h("table", null, kids()));
    case "thead_open":
      return h("thead", { key }, kids());
    case "tbody_open":
      return h("tbody", { key }, kids());
    case "tr_open":
      return h("tr", { key }, kids());
    case "th_open":
      return h("th", { key, style: alignStyle(token) }, kids());
    case "td_open":
      return h("td", { key, style: alignStyle(token) }, kids());
    case "html_block":
      return h("p", { key }, token.content);
    default:
      return null;
  }
}

/** 渲染一个顶层块。已闭合块的 src 不变，调用方用 React.memo 按 src 跳过重渲染。 */
export function renderBlock(block: MarkdownBlock, ctx: RenderContext): ReactNode {
  return buildTree(block.tokens).map((node, index) => renderBlockNode(node, index, ctx, block.closed));
}
