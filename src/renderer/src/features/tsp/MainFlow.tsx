// 对话区的 main：omp 发来的子节点，加上两样 omp 终端里有、TSP 文档里留不住的东西——
//   · omp 的状态行（切模型的 "Session-only model: …" 等）：文档里记下来的（shared/tsp/status-notes.ts），停在它出现时前面的那个节点后面；
//   · 恢复会话时补回的最新一条空闲回顾：放在它生成时的位置（第几轮之后），见 main/tsp/session-extras.ts。
import type { ReactNode } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { RECAP_AT_END } from "../../../../shared/tsp/recap-slot.ts";
import type { StatusNote } from "../../../../shared/tsp/status-notes.ts";
import { labels } from "./labels.ts";
import type { TspContext } from "./node-props.ts";
import { useSessionExtras } from "./session-extras-store.ts";
import { TspNode } from "./TspChildren.tsx";
import { useRecapBefore, useTspHasRecap, useTspNode, useTspStatusNotes } from "./tsp-store.ts";

function StatusLine({ note }: { note: StatusNote }) {
  return (
    <div className="tsp-status-note" data-testid="tsp-status-note">
      {note.text}
    </div>
  );
}

/**
 * 恢复会话后补回的最新一条回顾。实时收到过 omp.recap（omp 自己发的、只显示最新一条）就不补；
 * 回顾之后有没有新消息不影响，它留在自己的位置上。
 */
function RestoredRecap({ text }: { text: string }) {
  return (
    <div className="tsp-row" data-role="omp.recap" data-restored="" title={labels.recapTitle}>
      <div className="tsp-text">{text}</div>
    </div>
  );
}

export function MainFlow({
  taskId,
  sf,
  ctx,
  restoreRecap,
}: {
  taskId: TaskId;
  sf: string;
  ctx: TspContext;
  /** 恢复会话的回顾只补在会话本体（inline surface）。 */
  restoreRecap: boolean;
}) {
  const main = useTspNode(taskId, sf, "main");
  const notes = useTspStatusNotes(taskId, sf);
  const { turns, recap } = useSessionExtras(taskId);
  const live = useTspHasRecap(taskId, sf);
  const before = useRecapBefore(taskId, sf, recap?.afterTurn ?? 0, turns.length);
  if (main === null) return null;

  const restored = restoreRecap && recap !== null && !live && before !== null ? recap.text : null;
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
    if (restored !== null && before === id) out.push(<RestoredRecap key="restored-recap" text={restored} />);
    out.push(<TspNode key={id} id={id} ctx={ctx} />);
    (after.get(id) ?? []).forEach((note, i) => out.push(<StatusLine key={`s-${id}-${i}`} note={note} />));
  }
  if (restored !== null && before === RECAP_AT_END) out.push(<RestoredRecap key="restored-recap" text={restored} />);
  orphans.forEach((note, i) => out.push(<StatusLine key={`s-orphan-${i}`} note={note} />));
  return <>{out}</>;
}
