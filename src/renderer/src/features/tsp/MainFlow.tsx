// 对话区的 main：omp 发来的子节点，加上 omp 终端里有、TSP 文档里留不住的状态行（切模型的 "Session-only model: …" 等）：
// 文档里记下来的（shared/tsp/status-notes.ts），停在它出现时前面的那个节点后面。那个节点没了（压缩、/tree、恢复会话
// 这类整段重建对话，omp 删掉旧节点重画）就不再画：终端里重建也会清掉状态行（omp 18.12.5 实录 session-tree-compacted.jsonl）。
// 状态行最多露两行：MCP 工具多时启动的 `xdev: xd://: mounted …` 会列出全部工具名，占满一屏（2026-11-06 仓库所有者），
// 多出的收进和工具输出一样的"N more lines"。
// 连续的工具调用合成一组（设置 groupToolCalls，默认开；shared/tsp/tool-runs.ts、ToolRun.tsx）：组的第一张卡前插组头，
// 收起时组员不画（组头和卡片都是 main 下的兄弟：不另包一层 DOM，卡片不换父元素、不重挂载）；挂在组员后面的状态行照常画。
import { memo, type ReactNode } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import type { StatusNote } from "../../../../shared/tsp/status-notes.ts";
import {
  sameToolRunsBySurface,
  TOOL_RUN_NODES,
  toolRunsBySurface,
  type ToolRun,
} from "../../../../shared/tsp/tool-runs.ts";
import { useSettings } from "../../store/settings-store.ts";
import { Clamp } from "./Clamp.tsx";
import type { TspContext } from "./node-props.ts";
import { cleanGlyphs } from "./span-tokens.ts";
import { ToolRunHead, useToolRunStates } from "./ToolRun.tsx";
import { TspNode } from "./TspChildren.tsx";
import { useTspDerived, useTspNode, useTspStatusNotes } from "./tsp-store.ts";

const STATUS_NOTE_LINES = 2;
const NO_RUNS: readonly ToolRun[] = [];

function StatusLine({ note }: { note: StatusNote }) {
  return (
    <div className="tsp-status-note" data-testid="tsp-status-note">
      <Clamp lines={STATUS_NOTE_LINES}>{cleanGlyphs(note.text)}</Clamp>
    </div>
  );
}

// memo：外层（SurfaceBody）每次重渲染都新建 header / tail 等元素，这里的 props（任务、surface、memo 过的 ctx）不变就不重建整条对话。
export const MainFlow = memo(function MainFlow({ taskId, sf, ctx }: { taskId: TaskId; sf: string; ctx: TspContext }) {
  const main = useTspNode(taskId, sf, "main");
  const notes = useTspStatusNotes(taskId, sf);
  const grouping = useSettings()?.groupToolCalls ?? true;
  const bySurface = useTspDerived(taskId, toolRunsBySurface, sameToolRunsBySurface, TOOL_RUN_NODES);
  const runs = grouping ? (bySurface?.get(sf) ?? NO_RUNS) : NO_RUNS;
  const states = useToolRunStates(taskId, sf, runs);
  if (main === null) return null;

  // 锚点节点没了的状态行不画：下面只按 main.c 里的 id 取。
  const atStart: StatusNote[] = [];
  const after = new Map<string, StatusNote[]>();
  for (const note of notes) {
    if (note.anchor === null) atStart.push(note);
    else after.set(note.anchor, [...(after.get(note.anchor) ?? []), note]);
  }

  // 收起的组：组员不画（组员后面挂着的状态行照常画）。组员在 main.c 里连着；文档比推导新时（同一批里刚删了组员）照常画。
  const folded = new Set<string>();
  const heads = new Map<string, { run: ToolRun; open: boolean; toggle(): void }>();
  for (const run of runs) {
    const state = states.get(run.members[0]!);
    if (state === undefined) continue;
    heads.set(run.members[0]!, { run, ...state });
    if (!state.open) for (const id of run.members) folded.add(id);
  }

  const out: ReactNode[] = atStart.map((note, i) => <StatusLine key={`s-start-${i}`} note={note} />);
  for (const id of main.c) {
    const head = heads.get(id);
    if (head !== undefined)
      out.push(<ToolRunHead key={`run-${id}`} run={head.run} open={head.open} onToggle={head.toggle} />);
    if (!folded.has(id)) out.push(<TspNode key={id} id={id} ctx={ctx} />);
    (after.get(id) ?? []).forEach((note, i) => out.push(<StatusLine key={`s-${id}-${i}`} note={note} />));
  }
  return <>{out}</>;
});
