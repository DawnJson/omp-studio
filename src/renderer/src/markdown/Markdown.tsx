// 助手消息的 Markdown：按顶层块渲染，已闭合的块按原文 memo，流式时只有最后一个块在变（spec 5.4）。
// 流式时增量解析（parse.ts 的 parseStreaming）：前面不会再变的块直接复用，只重解析尾巴；结束（streaming=false）时整篇重解析一次。
import { memo, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import type Katex from "katex";
import type { TFunction } from "../../../shared/i18n/index.ts";
import { useT } from "../i18n/use-t.ts";
import { reportError } from "../ui/errors.ts";
import { CodeBlock } from "./CodeBlock.tsx";
import { splitMarks, type TextMark } from "./marks.ts";
import { parseBlocks, parseStreaming, stabilizeStreaming, type BlockParse, type MarkdownBlock } from "./parse.ts";
import { renderBlock, type RenderContext } from "./render.ts";
import "./markdown.css";

// ───────── KaTeX 按需加载 ─────────
// KaTeX 的 JS 和 CSS 不进首屏包：第一次遇到公式 token 才 import()（同源分包，CSP 允许）；加载完前公式按原文显示（render.ts）。

type KatexApi = typeof Katex;

let katex: KatexApi | null = null;
let loading: Promise<void> | null = null;
const katexListeners = new Set<() => void>();

function loadKatex(): Promise<void> {
  loading ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(
    ([module]) => {
      katex = module.default;
      for (const listener of katexListeners) listener();
    },
    (error: unknown) => {
      // 下一次遇到公式再试。
      loading = null;
      throw error;
    },
  );
  return loading;
}

function subscribeKatex(listener: () => void): () => void {
  katexListeners.add(listener);
  return () => katexListeners.delete(listener);
}

/** 有公式时触发加载；返回已加载的 KaTeX，没加载完是 null。 */
function useKatex(needed: boolean, t: TFunction): KatexApi | null {
  const loaded = useSyncExternalStore(subscribeKatex, () => katex);
  useEffect(() => {
    if (needed && katex === null) loadKatex().catch((error: unknown) => reportError(t, error));
  }, [needed, t]);
  return loaded;
}

// ───────── 渲染 ─────────

function createContext(
  t: TFunction,
  marks: readonly TextMark[] | undefined,
  katex: KatexApi | null,
  openFile: ((href: string) => void) | undefined,
): RenderContext {
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
    katex,
    openFile,
  };
}

const Block = memo(
  function Block({
    block,
    t,
    marks,
    katex,
    openFile,
  }: {
    block: MarkdownBlock;
    t: TFunction;
    marks: readonly TextMark[] | undefined;
    katex: KatexApi | null;
    openFile: ((href: string) => void) | undefined;
  }) {
    const context = useMemo(() => createContext(t, marks, katex, openFile), [t, marks, katex, openFile]);
    return (
      <div className="md-block" data-anchor>
        {renderBlock(block, context)}
      </div>
    );
  },
  // KaTeX 加载完只重画含公式的块。
  (prev, next) =>
    prev.t === next.t &&
    prev.marks === next.marks &&
    prev.openFile === next.openFile &&
    prev.block.src === next.block.src &&
    prev.block.closed === next.block.closed &&
    (prev.katex === next.katex || !next.block.math),
);

/**
 * `marks`：文字里的字面标记（要传稳定引用，变了所有块重画）。
 * `openFile`：本地文件链接（`file:` 或相对路径）点了交给它（同样要稳定引用）；不给时这类链接按纯文字显示。
 */
export function Markdown({
  source,
  streaming = false,
  marks,
  openFile,
}: {
  source: string;
  streaming?: boolean;
  marks?: readonly TextMark[] | undefined;
  openFile?: ((href: string) => void) | undefined;
}) {
  const t = useT();
  // 上一次流式解析的结果，给下一次增量解析复用；不在流式时清掉。
  const stream = useRef<BlockParse | null>(null);
  const blocks = useMemo(() => {
    if (!streaming) {
      stream.current = null;
      return parseBlocks(source);
    }
    stream.current = parseStreaming(stream.current, stabilizeStreaming(source));
    return stream.current.blocks;
  }, [source, streaming, stream]);
  // 画完就放掉 token（约是原文的 5–10 倍，对话里每条回答都留着）：memo 跳过的块不再用它，少数重画的块按原文重解析（parse.ts 的 blockTokens）。
  // 流式时下一次增量解析只看块的原文和块首位置，不看 token。
  useEffect(() => {
    for (const block of blocks) block.tokens = null;
  }, [blocks]);
  const katex = useKatex(
    blocks.some((block) => block.math),
    t,
  );
  return (
    <div className="md" data-streaming={streaming || undefined}>
      {blocks.map((block, index) => (
        <Block key={index} block={block} t={t} marks={marks} katex={katex} openFile={openFile} />
      ))}
    </div>
  );
}
