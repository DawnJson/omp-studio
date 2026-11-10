// `shell`（omp 18.17 起 bash 卡片的命令区，role omp.tool.bash.command）：按行画 omp 算好的 Pseudo / Raw 表示（shell-view.ts），
// 不自己解析 shell。第一行右端常显 Pseudo | Raw 分段（omp 规范：切换开关留在第一行），点了发
// `{ev:"action", act:"shell-viz", value:"view:raw"|"view:pseudo"}`，当前态以 omp 回来的 preferences.view 为准（同 Tabs）。
// 折叠块（片段带 expanded）点了发 `expand:<node>`；图层菜单、split、回放不做（docs/architecture/tsp-migration.md §7）。
// 折叠时按 preview 夹紧、露出头几行，下面"N more lines"（同 code）；presentation.output 不画（输出另有 ansi 节点）。
import { memo, useCallback, useMemo, type ReactNode } from "react";
import { Clamp } from "../Clamp.tsx";
import { useFoldState } from "../fold-context.ts";
import { nodeDomProps } from "../node-dom.ts";
import type { NodeProps } from "../node-props.ts";
import { shellView, type ShellLine } from "../shell-view.ts";
import { usePreviewLines } from "./text.tsx";

const GUTTER: Record<NonNullable<ShellLine["gutter"]>, string> = { fail: "×", active: "▶", selected: "›" };
const VIEWS = ["pseudo", "raw"] as const;
const VIEW_LABEL: Record<(typeof VIEWS)[number], string> = { pseudo: "Pseudo", raw: "Raw" };

interface RowProps {
  line: ShellLine;
  /** line 的序列化：omp 每个 trace 事件都整份重发 presentation，没变的行不重画。 */
  sig: string;
  fold(node: string): void;
  /** 第一行右端的视图切换。 */
  tail?: ReactNode;
}

const ShellRow = memo(
  function ShellRow({ line, fold, tail }: RowProps) {
    return (
      <div
        className="tsp-sh-ln"
        data-depth={line.depth}
        data-kind={line.role ?? undefined}
        data-active={line.gutter === "active" || undefined}
        data-muted={line.muted || undefined}
      >
        <span className="tsp-sh-gut" data-mark={line.gutter ?? undefined} aria-hidden="true">
          {line.gutter === null ? " " : GUTTER[line.gutter]}
        </span>
        <span className="tsp-sh-text" style={line.depth > 0 ? { paddingLeft: `${line.depth * 2}ch` } : undefined}>
          {line.effects.map((effect, index) => (
            <span key={index} className="tsp-sh-fx" title={effect.tip}>
              {effect.glyph}
            </span>
          ))}
          {line.pieces.map((piece, index) => {
            const attrs = {
              className: piece.expand === null ? "tsp-sh-seg" : "tsp-sh-seg tsp-sh-fold",
              "data-tone": piece.tone ?? undefined,
              "data-pill": piece.pill || undefined,
              "data-dim": piece.dim || undefined,
              "data-strong": piece.strong || undefined,
              title: piece.tip ?? undefined,
            };
            const node = piece.expand;
            // 药丸 / 折叠块两头的空格放在外面：omp 的 badge 片段带着前导空格（" >count.txt"），包进底色里折行时会多出一截空药丸。
            const boxed = piece.pill || node !== null;
            const [, lead = "", core = piece.text, trail = ""] = boxed
              ? (/^(\s*)([\s\S]*?)(\s*)$/.exec(piece.text) ?? [])
              : [];
            return (
              <span key={index} className="tsp-sh-piece">
                {piece.fail && (
                  <span className="tsp-sh-fail" aria-hidden="true">
                    ×{" "}
                  </span>
                )}
                {lead}
                {node === null ? (
                  <span {...attrs}>{core}</span>
                ) : (
                  <button type="button" {...attrs} onClick={() => fold(node)}>
                    {core}
                  </button>
                )}
                {trail}
              </span>
            );
          })}
          {line.meta && (
            <span className="tsp-sh-meta" data-fail={line.meta.fail || undefined}>
              {line.meta.text}
            </span>
          )}
          {line.annotations.length > 0 && (
            <span className="tsp-sh-note">
              {"‹ "}
              {line.annotations.map((note, index) => (
                <span key={note.name}>
                  {index > 0 && " · "}
                  <span data-tone="var">{note.name}</span>
                  {" = "}
                  <span data-tone="str">{note.value}</span>
                </span>
              ))}
              {" ›"}
            </span>
          )}
        </span>
        {tail}
      </div>
    );
  },
  (a, b) => a.sig === b.sig && a.fold === b.fold && a.tail === undefined && b.tail === undefined,
);

export function Shell(props: NodeProps) {
  const { node, ctx } = props;
  const p = node.p;
  const fold = useFoldState();
  const preview = usePreviewLines(p.preview);
  const view = useMemo(() => shellView(p.presentation), [p.presentation]);
  const { send, sf } = ctx;
  const id = node.id;
  const act = useCallback((value: string) => send({ ev: "action", sf, id, act: "shell-viz", value }), [send, sf, id]);
  const expand = useCallback((target: string) => act(`expand:${target}`), [act]);
  if (view === null) return null;
  const cwd = typeof p.cwd === "string" && p.cwd !== "" ? p.cwd : null;
  const toggle = (
    <div className="ui-seg tsp-sh-view" data-size="sm" role="radiogroup">
      {VIEWS.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={view.view === value}
          data-view={value}
          onClick={() => {
            if (view.view !== value) act(`view:${value}`);
          }}
        >
          {VIEW_LABEL[value]}
        </button>
      ))}
    </div>
  );
  return (
    <div {...nodeDomProps(props, "tsp-shell")} data-view={view.view}>
      <div className="tsp-shell-body">
        {cwd !== null && <div className="tsp-sh-cwd">{cwd}</div>}
        {view.message !== null && <div className="tsp-sh-msg">{view.message}</div>}
        <Clamp
          lines={preview}
          lineCount={view.lines.length}
          onExpand={fold.collapsed === true ? fold.expand : undefined}
        >
          {(shown) =>
            (shown === null ? view.lines : view.lines.slice(0, shown)).map((line, index) => (
              <ShellRow
                key={line.id}
                line={line}
                sig={JSON.stringify(line)}
                fold={expand}
                tail={index === 0 ? toggle : undefined}
              />
            ))
          }
        </Clamp>
      </div>
    </div>
  );
}
