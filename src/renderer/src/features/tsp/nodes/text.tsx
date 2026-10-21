// 文字类节点：text、md、code、diff、ansi、rows、math、media（规范 Text and Code）。
import {
  Fragment,
  memo,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { TspDiffHunk, TspSpan } from "../../../../../shared/tsp/tsp.generated.ts";
import { useT } from "../../../i18n/use-t.ts";
import { Markdown } from "../../../markdown/index.ts";
import { cachedHighlight, highlight, resolveLanguage, type HighlightToken } from "../../../markdown/highlight.ts";
import { openHref } from "../actions.ts";
import { parseAnsi, type AnsiRun } from "../ansi.ts";
import { Clamp } from "../Clamp.tsx";
import {
  changedRange,
  hunksFromProps,
  parseDiff,
  splitRows,
  type DiffHunkRows,
  type DiffLine,
  type WordRange,
} from "../diff-parse.ts";
import { useFoldState } from "../fold-context.ts";
import { TspIcon } from "../icons.tsx";
import { nodeDomProps } from "../node-dom.ts";
import type { NodeProps } from "../node-props.ts";
import { plainText, cleanGlyphs, TspSpans } from "../spans.tsx";
import { asArray, previewToLines } from "../props-util.ts";
import { isRecord } from "../../../../../shared/type-guards.ts";
import { TurnCostCtx } from "../turn-cost-context.ts";
import { withExactCost } from "../turn-cost.ts";

// ───────── text ─────────

function textSpans(p: Readonly<Record<string, unknown>>): readonly TspSpan[] | string {
  if (Array.isArray(p.spans)) return p.spans as TspSpan[];
  return typeof p.text === "string" ? p.text : "";
}

export function Text(props: NodeProps) {
  const p = props.node.p;
  const turnCost = useContext(TurnCostCtx);
  const raw = textSpans(p);
  const content =
    turnCost === undefined
      ? raw
      : typeof raw === "string"
        ? withExactCost(raw, turnCost)
        : raw.map((span) => ({ ...span, t: withExactCost(span.t, turnCost) }));
  const lines = typeof p.lines === "number" && p.lines > 0 ? Math.floor(p.lines) : null;
  const truncate = p.truncate === "start" || p.truncate === "middle" || p.truncate === "end" ? p.truncate : null;
  const oneLine = p.wrap === "none" || lines === 1 || (truncate !== null && lines === null && p.wrap === undefined);
  const classes = [
    oneLine && "tsp-nowrap",
    oneLine && truncate !== null && `tsp-trunc-${truncate}`,
    p.wrap === "char" && "tsp-char",
    p.measure === "prose" && "tsp-prose",
  ].filter((c): c is string => typeof c === "string");
  const clamp = lines !== null && lines > 1;
  const dom = nodeDomProps(props, "tsp-text", {
    className: classes.join(" "),
    style: clamp
      ? { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: lines, overflow: "hidden" }
      : undefined,
  });
  if ((truncate !== null || lines !== null) && dom.title === undefined) dom.title = plainText(content);
  if (oneLine && truncate === "middle") {
    const parts: TspSpan[] = typeof content === "string" ? [{ t: content }] : [...content];
    let head: readonly TspSpan[];
    let rest: readonly TspSpan[];
    if (parts.length >= 2) {
      head = parts.slice(0, -1);
      rest = parts.slice(-1);
    } else {
      const only = parts[0]?.t ?? "";
      const keep = Math.min(12, Math.floor(only.length / 3));
      head = [{ ...parts[0], t: only.slice(0, only.length - keep) }];
      rest = [{ ...parts[0], t: only.slice(only.length - keep) }];
    }
    return (
      <div {...dom}>
        <span className="tsp-mid-a">
          <TspSpans text={head} />
        </span>
        <span className="tsp-mid-b">
          <TspSpans text={rest} />
        </span>
      </div>
    );
  }
  if (oneLine && truncate === "start") {
    return (
      <div {...dom}>
        <span className="tsp-start-inner">
          <TspSpans text={content} />
        </span>
      </div>
    );
  }
  return (
    <div {...dom}>
      <TspSpans text={content} />
    </div>
  );
}

// ───────── md / math ─────────

export function Md(props: NodeProps) {
  const p = props.node.p;
  const text = typeof p.text === "string" ? cleanGlyphs(p.text) : "";
  return (
    <div {...nodeDomProps(props, "tsp-md")}>
      <Markdown source={text} streaming={p.stream === true} />
    </div>
  );
}

/** 公式走 Markdown 同一条 KaTeX 路径（不另开 innerHTML）：块级 `$$`，行内 `\( \)`。 */
export function MathBlock(props: NodeProps) {
  const p = props.node.p;
  const tex = typeof p.text === "string" ? p.text : "";
  const display = p.display === true;
  const source = display ? `$$\n${tex.replace(/\n\s*\n/g, "\n")}\n$$` : `\\(${tex.replace(/\s*\n\s*/g, " ")}\\)`;
  return (
    <div {...nodeDomProps(props, "tsp-math", { className: display ? "display" : undefined })}>
      <Markdown source={source} />
    </div>
  );
}

// ───────── code ─────────

const EXTENSION_LANG = /\.([A-Za-z0-9+]+)$/;

function codeLanguage(p: Readonly<Record<string, unknown>>): string | null {
  if (typeof p.lang === "string") return resolveLanguage(p.lang);
  if (typeof p.path === "string") {
    const ext = EXTENSION_LANG.exec(p.path)?.[1];
    if (ext) return resolveLanguage(ext);
    return resolveLanguage(p.path.split(/[\\/]/).pop() ?? "");
  }
  return null;
}

function useHighlighted(code: string, lang: string | null): HighlightToken[][] | null {
  const [tokens, setTokens] = useState<HighlightToken[][] | null>(() => (lang ? cachedHighlight(code, lang) : null));
  useEffect(() => {
    if (!lang) {
      setTokens(null);
      return;
    }
    const cached = cachedHighlight(code, lang);
    if (cached) {
      setTokens(cached);
      return;
    }
    let alive = true;
    highlight(code, lang).then(
      (result) => alive && setTokens(result),
      () => alive && setTokens(null),
    );
    return () => {
      alive = false;
    };
  }, [code, lang]);
  return lang ? tokens : null;
}

function Tokens({ tokens, fallback }: { tokens: readonly HighlightToken[] | undefined; fallback: string }) {
  if (!tokens) return <>{fallback}</>;
  return (
    <>
      {tokens.map((token, index) => (
        <span
          key={index}
          style={{
            color: token.color,
            fontStyle: token.italic ? "italic" : undefined,
            fontWeight: token.bold ? "var(--fw-strong)" : undefined,
          }}
        >
          {token.text}
        </span>
      ))}
    </>
  );
}

/** preview 只在折叠时生效（开着的折叠里让位）：返回要夹到几行，null = 全部显示。 */
function usePreviewLines(preview: unknown): number | null {
  const fold = useFoldState();
  if (fold.collapsed === false) return null;
  return previewToLines(preview);
}

export function Code(props: NodeProps) {
  const p = props.node.p;
  const fold = useFoldState();
  const code = typeof p.text === "string" ? p.text : "";
  const lang = codeLanguage(p);
  const tokens = useHighlighted(code, lang);
  const lines = useMemo(() => code.split("\n"), [code]);
  const start = typeof p.start === "number" ? p.start : 1;
  const numbers = p.numbers === true;
  const marks = asArray(p.marks).filter(isRecord);
  const preview = usePreviewLines(p.preview);
  const path = typeof p.path === "string" ? p.path : null;
  const gutter = String(start + lines.length - 1).length;
  const body = (
    <div className="tsp-code-lines">
      {lines.map((line, index) => {
        const mark = marks.find((m) => m.line === start + index);
        const markTone = typeof mark?.tone === "string" ? mark.tone : "accent";
        return (
          <div key={index} className="tsp-ln" data-mark={mark ? markTone : undefined}>
            {numbers && <span className="tsp-gut">{start + index}</span>}
            <span className="tsp-lt">
              <Tokens tokens={tokens?.[index]} fallback={line} />
              {line === "" && tokens?.[index] === undefined ? "\u200b" : null}
            </span>
          </div>
        );
      })}
    </div>
  );
  const dir = path ? path.slice(0, path.lastIndexOf("/") + 1) : "";
  return (
    <div
      {...nodeDomProps(props, "tsp-code", {
        className: [numbers && "numbers", p.wrap === true && "wrap"]
          .filter((c): c is string => typeof c === "string")
          .join(" "),
        style: { "--tsp-gw": `${gutter}ch` } as CSSProperties,
      })}
    >
      {path !== null && (
        <div className="tsp-code-head" title={path}>
          <TspIcon name="file" size={12} />
          <span className="tsp-code-path">
            <span className="tsp-dir">{dir}</span>
            <span className="tsp-name">{path.slice(dir.length)}</span>
          </span>
        </div>
      )}
      <div className="tsp-code-body">
        <Clamp lines={preview} onExpand={fold.collapsed === true ? fold.expand : undefined}>
          {body}
        </Clamp>
      </div>
    </div>
  );
}

// ───────── diff ─────────

function WordMarked({ text, range }: { text: string; range: WordRange | null }) {
  if (!range || range.from >= range.to) return <>{text}</>;
  return (
    <>
      {text.slice(0, range.from)}
      <span className="tsp-em">{text.slice(range.from, range.to)}</span>
      {text.slice(range.to)}
    </>
  );
}

/** 一个 hunk 里每条改动行的"改动词"范围：成对的删/增行按顺序配对。 */
function wordRanges(lines: readonly DiffLine[]): Map<DiffLine, WordRange | null> {
  const out = new Map<DiffLine, WordRange | null>();
  let i = 0;
  while (i < lines.length) {
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i]!.kind === "del") dels.push(lines[i++]!);
    while (i < lines.length && lines[i]!.kind === "add") adds.push(lines[i++]!);
    if (dels.length === 0 && adds.length === 0) i += 1;
    for (let k = 0; k < Math.min(dels.length, adds.length); k += 1) {
      const pair = changedRange(dels[k]!.text, adds[k]!.text);
      out.set(dels[k]!, pair ? pair[0] : null);
      out.set(adds[k]!, pair ? pair[1] : null);
    }
  }
  return out;
}

const MARKS = { add: "+", del: "-", ctx: " " } as const;

function UnifiedLine({ line, range }: { line: DiffLine; range: WordRange | null }) {
  return (
    // 行的种类放 data-kind，不当类名：`ctx` 和输入框上下文浮层的全局 `.ctx` 撞名，上下文行会被排成竖列。
    <div className="tsp-dl" data-kind={line.kind}>
      <span className="tsp-dg">{line.old ?? ""}</span>
      <span className="tsp-dg">{line.new ?? ""}</span>
      <span className="tsp-dm">{MARKS[line.kind]}</span>
      <span className="tsp-dt">
        <WordMarked text={line.text} range={range} />
      </span>
    </div>
  );
}

function SplitHalf({ line, range, side }: { line: DiffLine | null; range: WordRange | null; side: "old" | "new" }) {
  if (!line) return <div className="tsp-dl half" data-kind="nil" />;
  return (
    <div className="tsp-dl half" data-kind={line.kind}>
      <span className="tsp-dg">{(side === "old" ? line.old : line.new) ?? ""}</span>
      <span className="tsp-dt">
        <WordMarked text={line.text} range={range} />
      </span>
    </div>
  );
}

export function Diff(props: NodeProps) {
  const t = useT();
  const p = props.node.p;
  const hunks: DiffHunkRows[] = useMemo(() => {
    if (Array.isArray(p.hunks)) return hunksFromProps(p.hunks as TspDiffHunk[]);
    return typeof p.text === "string" ? parseDiff(p.text) : [];
  }, [p.hunks, p.text]);
  const split = p.mode === "split";
  const empty = hunks.length === 0;
  return (
    <div {...nodeDomProps(props, "tsp-diff", { className: split ? "split" : undefined })}>
      {empty ? (
        <div className="tsp-diff-empty">{t("tsp.noChanges")}</div>
      ) : (
        <div className="tsp-diff-body">
          {hunks.map((hunk, index) => {
            const previous = hunks[index - 1];
            const gap = previous ? hunk.oldStart - (previous.oldStart + previous.oldCount) : 0;
            const ranges = wordRanges(hunk.lines);
            return (
              <Fragment key={index}>
                {previous && (
                  <div className="tsp-dsep">
                    {gap > 0 ? `⋯ ${t("tsp.unchangedLines", { count: gap })}` : "⋯"}
                    {hunk.fn !== "" && <span className="fn">{hunk.fn}</span>}
                  </div>
                )}
                {split
                  ? splitRows(hunk.lines).map((row, i) => (
                      <div key={i} className="tsp-dr">
                        <SplitHalf
                          line={row.left}
                          range={row.left ? (ranges.get(row.left) ?? null) : null}
                          side="old"
                        />
                        <SplitHalf
                          line={row.right}
                          range={row.right ? (ranges.get(row.right) ?? null) : null}
                          side="new"
                        />
                      </div>
                    ))
                  : hunk.lines.map((line, i) => <UnifiedLine key={i} line={line} range={ranges.get(line) ?? null} />)}
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ───────── ansi / rows ─────────

function runStyle(run: AnsiRun): CSSProperties | undefined {
  let fg = run.fg;
  let bg = run.bg;
  if (run.inverse) {
    [fg, bg] = [bg ?? "var(--bg-app)", fg ?? "var(--text)"];
  }
  if (!fg && !bg) return undefined;
  return { color: fg, backgroundColor: bg };
}

const AnsiLine = memo(function AnsiLine({
  runs,
  taskId,
}: {
  runs: readonly AnsiRun[];
  taskId: NodeProps["ctx"]["taskId"];
}) {
  return (
    <div className="tsp-ansi-line">
      {runs.length === 0
        ? "\u200b"
        : runs.map((run, index) => {
            const className = [
              run.bold && "b",
              run.dim && "d",
              run.italic && "i",
              run.underline && "u",
              run.strike && "s",
            ]
              .filter((c): c is string => typeof c === "string")
              .join(" ");
            const style = runStyle(run);
            if (run.href !== undefined) {
              const href = run.href;
              return (
                <a
                  key={index}
                  className={`tsp-link ${className}`}
                  style={style}
                  href={href}
                  title={href}
                  onClick={(event) => {
                    event.preventDefault();
                    openHref(href, { taskId });
                  }}
                >
                  {run.text}
                </a>
              );
            }
            return className || style ? (
              <span key={index} className={className || undefined} style={style}>
                {run.text}
              </span>
            ) : (
              <Fragment key={index}>{run.text}</Fragment>
            );
          })}
    </div>
  );
});

function AnsiBody({ lines, taskId }: { lines: readonly AnsiRun[][]; taskId: NodeProps["ctx"]["taskId"] }) {
  return (
    <div className="tsp-ansi-lines">
      {lines.map((runs, index) => (
        <AnsiLine key={index} runs={runs} taskId={taskId} />
      ))}
    </div>
  );
}

export function Ansi(props: NodeProps) {
  const p = props.node.p;
  const fold = useFoldState();
  const text = typeof p.text === "string" ? p.text : "";
  const lines = useMemo(() => parseAnsi(text), [text]);
  const follow = p.follow === true;
  const preview = usePreviewLines(p.preview);
  const maxH = isRecord(p.max) ? p.max.h : undefined;
  const scroller = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);

  // 有高度上限的 ansi 自己滚动；follow 时贴着底，用户往上滚就不跟了，滚回底再跟。
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && follow && stuck.current) el.scrollTop = el.scrollHeight;
  }, [text, follow]);

  return (
    <div {...nodeDomProps(props, "tsp-ansi", { className: maxH !== undefined ? "scroll" : undefined })}>
      <div
        ref={scroller}
        className="tsp-ansi-scroll"
        onScroll={(event) => {
          const el = event.currentTarget;
          stuck.current = el.scrollHeight - el.clientHeight - el.scrollTop < 4;
        }}
      >
        <Clamp lines={preview} tail={follow} onExpand={fold.collapsed === true ? fold.expand : undefined}>
          <AnsiBody lines={lines} taskId={props.ctx.taskId} />
        </Clamp>
      </div>
    </div>
  );
}

export function Rows(props: NodeProps) {
  const p = props.node.p;
  const joined = asArray(p.lines)
    .filter((l): l is string => typeof l === "string")
    .join("\n");
  const lines = useMemo(() => parseAnsi(joined), [joined]);
  return (
    <div {...nodeDomProps(props, "tsp-rows")}>
      <AnsiBody lines={lines} taskId={props.ctx.taskId} />
    </div>
  );
}

// ───────── media ─────────

export function Media(props: NodeProps) {
  const t = useT();
  const path = typeof props.node.p.path === "string" ? props.node.p.path : "";
  const name = path.split(/[\\/]/).pop() ?? path;
  const dir = path.slice(0, path.length - name.length);
  const body: ReactNode = (
    <>
      <TspIcon name="file-image" />
      <span className="tsp-path">
        <span className="tsp-dir">{dir}</span>
        <span className="tsp-name">{name}</span>
      </span>
    </>
  );
  return (
    <button
      type="button"
      {...nodeDomProps(props, "tsp-media")}
      title={t("tsp.mediaOpen", { path })}
      onClick={() => openHref(path, props.ctx)}
    >
      {body}
    </button>
  );
}
