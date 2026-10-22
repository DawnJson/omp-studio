// 助手消息的 Markdown：按顶层块渲染，已闭合的块按原文 memo，流式时只有最后一个块在变（spec 5.4）。
import { memo, useMemo, type ReactNode } from "react";
import type { TFunction } from "../../../shared/i18n/index.ts";
import { useT } from "../i18n/use-t.ts";
import { reportError } from "../ui/errors.ts";
import { CodeBlock } from "./CodeBlock.tsx";
import { parseBlocks, stabilizeStreaming, type MarkdownBlock } from "./parse.ts";
import { renderBlock, type RenderContext } from "./render.ts";
import "katex/dist/katex.min.css";
import "./markdown.css";

function createContext(t: TFunction): RenderContext {
  return {
    openLink: (href) => {
      window.studio.openExternal(href).catch((error: unknown) => reportError(t, error));
    },
    renderCode: ({ code, lang, closed }): ReactNode => <CodeBlock code={code} lang={lang} closed={closed} />,
  };
}

const Block = memo(
  function Block({ block, t }: { block: MarkdownBlock; t: TFunction }) {
    const context = useMemo(() => createContext(t), [t]);
    return (
      <div className="md-block" data-anchor>
        {renderBlock(block, context)}
      </div>
    );
  },
  (prev, next) => prev.t === next.t && prev.block.src === next.block.src && prev.block.closed === next.block.closed,
);

export function Markdown({ source, streaming = false }: { source: string; streaming?: boolean }) {
  const t = useT();
  const blocks = useMemo(() => parseBlocks(streaming ? stabilizeStreaming(source) : source), [source, streaming]);
  return (
    <div className="md" data-streaming={streaming || undefined}>
      {blocks.map((block, index) => (
        <Block key={index} block={block} t={t} />
      ))}
    </div>
  );
}
