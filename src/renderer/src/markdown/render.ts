// markdown-it 的 token → React 元素。不用 dangerouslySetInnerHTML：所有文本都经 React 转义，
// 链接只放行 http/https，图片只放行 markdown-it 已校验的 data:image。无 JSX，方便在 Node 里测试。
import { createElement as h, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import type { MarkdownBlock, Token } from "./parse.ts";

export interface RenderContext {
  /** 用户点了一个已放行的链接。 */
  openLink(href: string): void;
  /** 代码块的渲染由调用方决定（高亮、复制按钮）；缺省是纯文本 <pre>。 */
  renderCode?(props: { code: string; lang: string; closed: boolean }): ReactNode;
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
      return token.content;
    case "softbreak":
      return "\n";
    case "hardbreak":
      return h("br", { key });
    case "code_inline":
      return h("code", { key, className: "md-code-inline" }, token.content);
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

function renderBlockNode(node: TreeNode, key: number, ctx: RenderContext, closedFence: boolean): ReactNode {
  const { token } = node;
  const kids = (): ReactNode[] => node.children.map((child, index) => renderBlockNode(child, index, ctx, closedFence));
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
      return h("ul", { key }, kids());
    case "ordered_list_open": {
      const start = Number(token.attrGet("start") ?? 1);
      return h("ol", { key, start: start === 1 ? undefined : start }, kids());
    }
    case "list_item_open": {
      const task = attr(token, "data-task");
      if (task === null) return h("li", { key }, kids());
      // 任务列表：只读复选框。
      const checkbox = h("input", {
        type: "checkbox",
        checked: task === "done",
        readOnly: true,
        tabIndex: -1,
        "aria-hidden": true,
      });
      return h("li", { key, className: "md-task" }, checkbox, kids());
    }
    case "hr":
      return h("hr", { key });
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
