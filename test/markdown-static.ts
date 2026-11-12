// 不依赖 DOM 的整篇渲染入口：只有 test/markdown.test.ts 用。界面里用 src/renderer/src/markdown/Markdown.tsx（按块 memo）。
import { createElement as h, Fragment, type ReactNode } from "react";
import { parseBlocks } from "../src/renderer/src/markdown/parse.ts";
import { renderBlock, type RenderContext } from "../src/renderer/src/markdown/render.ts";

export function renderMarkdown(source: string, ctx: RenderContext): ReactNode {
  return h(
    Fragment,
    null,
    parseBlocks(source).map((block, index) => h("div", { key: index, className: "md-block" }, renderBlock(block, ctx))),
  );
}
