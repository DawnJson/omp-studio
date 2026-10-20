// 每个节点元素共有的 DOM 属性（规范 Elements "Props every node takes"）：
// data-id / data-role / data-tone / data-mark / data-href、title、aria-label、hidden、flex 和 min/max 尺寸、指针动作。
import type { CSSProperties, HTMLAttributes } from "react";
import { nodeActionHandlers, type OwnActions } from "./actions.ts";
import { extentToCss } from "./fmt.ts";
import type { NodeProps } from "./node-props.ts";
import { isRecord } from "../../../../shared/type-guards.ts";

const TONES = new Set(["neutral", "accent", "info", "success", "warning", "error", "pending", "muted", "user"]);

export interface NodeDomProps extends HTMLAttributes<HTMLElement> {
  "data-id": string;
  "data-role"?: string;
  "data-tone"?: string;
  "data-mark"?: string;
  "data-href"?: string;
  "data-grow"?: "";
  "data-anchor"?: "";
}

interface Options {
  /** 内置动作（toggle / zoom）由节点自己实现。 */
  own?: OwnActions | undefined;
  /** 不把 `title` 当 tooltip（tool 的 title 是动词，picker 的 title 是标题）。 */
  noTitle?: boolean | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}

function flexStyle(p: Readonly<Record<string, unknown>>): CSSProperties {
  const style: CSSProperties = {};
  if (typeof p.grow === "number" && p.grow > 0) style.flexGrow = p.grow;
  if (typeof p.shrink === "number") style.flexShrink = p.shrink;
  if (p.basis === "content") {
    style.flexBasis = "auto";
    style.flexShrink = 0;
  } else if (typeof p.basis === "number") style.flexBasis = `${p.basis * 100}%`;
  const min = isRecord(p.min) ? p.min : undefined;
  const max = isRecord(p.max) ? p.max : undefined;
  const minW = extentToCss(min?.w);
  const minH = extentToCss(min?.h);
  const maxW = extentToCss(max?.w);
  const maxH = extentToCss(max?.h);
  if (minW) style.minWidth = minW;
  if (minH) style.minHeight = minH;
  if (maxW) style.maxWidth = maxW;
  if (maxH) {
    style.maxHeight = maxH;
    style.overflow = "hidden";
  }
  return style;
}

/** `base` 是节点的类名（如 "tsp-col"）；返回值直接展开到元素上。 */
export function nodeDomProps({ node, ctx }: NodeProps, base: string, options: Options = {}): NodeDomProps {
  const { p } = node;
  const handlers = nodeActionHandlers(node, ctx, options.own);
  const classes = [base];
  if (options.className) classes.push(options.className);
  if (handlers.className) classes.push(handlers.className);
  if (p.hidden === true) classes.push("tsp-hidden");
  const props: NodeDomProps = {
    className: classes.join(" "),
    "data-id": node.id,
    style: { ...flexStyle(p), ...options.style },
  };
  if (handlers.onClick) props.onClick = handlers.onClick;
  if (handlers.onDoubleClick) props.onDoubleClick = handlers.onDoubleClick;
  if (handlers.onContextMenu) props.onContextMenu = handlers.onContextMenu;
  if (handlers.title !== undefined && !options.noTitle) props.title = handlers.title;
  if (typeof p.role === "string") props["data-role"] = p.role;
  if (typeof p.tone === "string" && TONES.has(p.tone)) props["data-tone"] = p.tone;
  if (typeof p.mark === "string") props["data-mark"] = p.mark;
  if (typeof p.href === "string") props["data-href"] = p.href;
  if (typeof p.aria === "string") props["aria-label"] = p.aria;
  if (typeof p.grow === "number" && p.grow > 0) props["data-grow"] = "";
  if (node.parent === "main") props["data-anchor"] = "";
  return props;
}
