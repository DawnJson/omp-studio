// 对话区的 main：omp 发来的子节点，加上 omp 终端里有、TSP 文档里留不住的状态行（切模型的 "Session-only model: …" 等）：
// 文档里记下来的（shared/tsp/status-notes.ts），停在它出现时前面的那个节点后面。
import type { TaskId } from "../../../../shared/ipc.ts";
import type { StatusNote } from "../../../../shared/tsp/status-notes.ts";
import type { TspContext } from "./node-props.ts";
import type { ReactNode } from "react";
import { TspNode } from "./TspChildren.tsx";
import { useTspNode, useTspStatusNotes } from "./tsp-store.ts";

function StatusLine({ note }: { note: StatusNote }) {
  return (
    <div className="tsp-status-note" data-testid="tsp-status-note">
      {note.text}
    </div>
  );
}

export function MainFlow({ taskId, sf, ctx }: { taskId: TaskId; sf: string; ctx: TspContext }) {
  const main = useTspNode(taskId, sf, "main");
  const notes = useTspStatusNotes(taskId, sf);
  if (main === null) return null;

  const atStart: StatusNote[] = [];
  const after = new Map<string, StatusNote[]>();
  const orphans: StatusNote[] = [];
  for (const note of notes) {
    if (note.anchor === null) atStart.push(note);
    else if (main.c.includes(note.anchor)) after.set(note.anchor, [...(after.get(note.anchor) ?? []), note]);
    else orphans.push(note);
  }

  const out: ReactNode[] = atStart.map((note, i) => <StatusLine key={`s-start-${i}`} note={note} />);
  for (const id of main.c) {
    out.push(<TspNode key={id} id={id} ctx={ctx} />);
    (after.get(id) ?? []).forEach((note, i) => out.push(<StatusLine key={`s-${id}-${i}`} note={note} />));
  }
  orphans.forEach((note, i) => out.push(<StatusLine key={`s-orphan-${i}`} note={note} />));
  return <>{out}</>;
}
