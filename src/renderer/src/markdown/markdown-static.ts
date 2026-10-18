// 不依赖 DOM 的整篇渲染入口：测试和"复制纯文本"之类场景用。界面里用 Markdown.tsx（按块 memo）。
import { createElement as h, Fragment, type ReactNode } from "react";
import { parseBlocks } from "./parse.ts";
import { renderBlock, type RenderContext } from "./render.ts";

export function renderMarkdown(source: string, ctx: RenderContext): ReactNode {
  return h(
    Fragment,
    null,
    parseBlocks(source).map((block, index) => h("div", { key: index, className: "md-block" }, renderBlock(block, ctx))),
  );
}
