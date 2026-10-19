// agent 的改动说明：这个文件在本任务里被哪些 edit / write 工具改过（每次调用的 intent）、那一轮的结论。
// 全部来自对话流里已有的工具事件（explain.ts），不请求 agent 另写说明。
import { useLayoutEffect, useRef, useState } from "react";
import { useT } from "../../i18n/use-t.ts";
import { Markdown } from "../../markdown/index.ts";
import type { TurnNote } from "./explain.ts";

function Note({ note, n }: { note: TurnNote; n: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const conclusion = note.conclusion;
  const bodyRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  // 折叠态用 CSS 限高裁剪已渲染的块（不切原文，不会切到代码围栏中间）；是否溢出靠量高度判断。
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body === null || open) return;
    const measure = () => setOverflows(body.scrollHeight > body.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [conclusion, open]);
  const long = overflows || open;
  return (
    <li className="rv-note-turn" data-testid="explain-turn">
      <div className="rv-note-request">{note.request ?? t("review.explainTurn", { n })}</div>
      <ul className="rv-note-edits">
        {note.edits.map((edit) => (
          <li key={edit.toolCallId} className="rv-note-edit" data-testid="explain-edit">
            <span className="rv-note-intent">{edit.intent ?? edit.tool}</span>
            {edit.added !== null && (
              <span className="rv-counts">
                <span className="rv-add">+{edit.added}</span> <span className="rv-del">−{edit.removed ?? 0}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      {conclusion !== null && (
        <div className="rv-note-conclusion" data-testid="explain-conclusion" data-open={open || undefined}>
          <div ref={bodyRef} className="rv-note-body">
            <Markdown source={conclusion} />
          </div>
          {long && (
            <button type="button" className="rv-btn rv-btn-text" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? t("review.collapse") : t("review.expand")}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function ExplainPanel({ notes }: { notes: readonly TurnNote[] }) {
  const t = useT();
  if (notes.length === 0) return <p className="rv-empty">{t("review.explainNone")}</p>;
  return (
    <ol className="rv-notes" data-testid="explain-panel">
      {notes.map((note) => (
        <Note key={note.turnKey} note={note} n={note.order + 1} />
      ))}
    </ol>
  );
}
