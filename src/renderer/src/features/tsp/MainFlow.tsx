// 对话区的 main：omp 发来的子节点，加上 omp 终端里有、TSP 文档里留不住的状态行（切模型的 "Session-only model: …" 等）：
// 文档里记下来的（shared/tsp/status-notes.ts），停在它出现时前面的那个节点后面。那个节点没了（压缩、/tree、恢复会话
// 这类整段重建对话，omp 删掉旧节点重画）就不再画：终端里重建也会清掉状态行（omp 18.12.5 实录 session-tree-compacted.jsonl）。
import { memo, type ReactNode } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import type { StatusNote } from "../../../../shared/tsp/status-notes.ts";
import type { TspContext } from "./node-props.ts";
import { cleanGlyphs } from "./span-tokens.ts";
import { TspNode } from "./TspChildren.tsx";
import { useTspNode, useTspStatusNotes } from "./tsp-store.ts";

function StatusLine({ note }: { note: StatusNote }) {
  return (
    <div className="tsp-status-note" data-testid="tsp-status-note">
      {cleanGlyphs(note.text)}
    </div>
  );
}

// memo：外层（SurfaceBody）每次重渲染都新建 header / tail 等元素，这里的 props（任务、surface、memo 过的 ctx）不变就不重建整条对话。
export const MainFlow = memo(function MainFlow({ taskId, sf, ctx }: { taskId: TaskId; sf: string; ctx: TspContext }) {
  const main = useTspNode(taskId, sf, "main");
  const notes = useTspStatusNotes(taskId, sf);
  if (main === null) return null;

  // 锚点节点没了的状态行不画：下面只按 main.c 里的 id 取。
  const atStart: StatusNote[] = [];
  const after = new Map<string, StatusNote[]>();
  for (const note of notes) {
    if (note.anchor === null) atStart.push(note);
    else after.set(note.anchor, [...(after.get(note.anchor) ?? []), note]);
  }

  const out: ReactNode[] = atStart.map((note, i) => <StatusLine key={`s-start-${i}`} note={note} />);
  for (const id of main.c) {
    out.push(<TspNode key={id} id={id} ctx={ctx} />);
    (after.get(id) ?? []).forEach((note, i) => out.push(<StatusLine key={`s-${id}-${i}`} note={note} />));
  }
  return <>{out}</>;
});
