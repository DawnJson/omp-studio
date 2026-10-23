// 助手消息的 Markdown：按顶层块渲染，已闭合的块按原文 memo，流式时只有最后一个块在变（spec 5.4）。
import { memo, useMemo, type ReactNode } from "react";
import type { TFunction } from "../../../shared/i18n/index.ts";
import { useT } from "../i18n/use-t.ts";
import { reportError } from "../ui/errors.ts";
import { CodeBlock } from "./CodeBlock.tsx";
import { splitMarks, type TextMark } from "./marks.ts";
import { parseBlocks, stabilizeStreaming, type MarkdownBlock } from "./parse.ts";
import { renderBlock, type RenderContext } from "./render.ts";
import "katex/dist/katex.min.css";
import "./markdown.css";

function createContext(t: TFunction, marks: readonly TextMark[] | undefined): RenderContext {
  return {
    openLink: (href) => {
      window.studio.openExternal(href).catch((error: unknown) => reportError(t, error));
    },
    renderCode: ({ code, lang, closed }): ReactNode => <CodeBlock code={code} lang={lang} closed={closed} />,
    renderText:
      marks === undefined || marks.length === 0
        ? undefined
        : (text) =>
            splitMarks(text, marks).map((piece, index) =>
              piece.className === undefined ? (
                piece.text
              ) : (
                <span key={index} className={piece.className}>
                  {piece.text}
                </span>
              ),
            ),
  };
}

const Block = memo(
  function Block({ block, t, marks }: { block: MarkdownBlock; t: TFunction; marks: readonly TextMark[] | undefined }) {
    const context = useMemo(() => createContext(t, marks), [t, marks]);
    return (
      <div className="md-block" data-anchor>
        {renderBlock(block, context)}
      </div>
    );
  },
  (prev, next) =>
    prev.t === next.t &&
    prev.marks === next.marks &&
    prev.block.src === next.block.src &&
    prev.block.closed === next.block.closed,
);

/** `marks`：文字里的字面标记（要传稳定引用，变了所有块重画）。 */
export function Markdown({
  source,
  streaming = false,
  marks,
}: {
  source: string;
  streaming?: boolean;
  marks?: readonly TextMark[] | undefined;
}) {
  const t = useT();
  const blocks = useMemo(() => parseBlocks(streaming ? stabilizeStreaming(source) : source), [source, streaming]);
  return (
    <div className="md" data-streaming={streaming || undefined}>
      {blocks.map((block, index) => (
        <Block key={index} block={block} t={t} marks={marks} />
      ))}
    </div>
  );
}
