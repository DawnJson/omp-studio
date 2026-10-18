// agent 的改动说明：这个文件在本任务里被哪些 edit / write 工具改过（每次调用的 intent）、那一轮的结论。
// 全部来自对话流里已有的工具事件（explain.ts），不请求 agent 另写说明。
import { useState } from "react";
import { useT } from "../../i18n/use-t.ts";
import type { TurnNote } from "./explain.ts";

function Note({ note, n }: { note: TurnNote; n: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const conclusion = note.conclusion;
  const long = conclusion !== null && (conclusion.length > 160 || conclusion.includes("\n"));
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
          <p>{conclusion}</p>
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
