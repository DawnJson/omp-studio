// 连续工具调用的组头（shared/tsp/tool-runs.ts 切组、算展开状态，MainFlow 在组的第一张卡前插它；docs/architecture/conversation.md
// 「连续工具调用合成一组」）。还在往里加卡时展开，跑完收成这一行；omp 的工具输出展开着（Ctrl+O，按 omp 报的状态行，
// DocSurface.toolsExpanded）时全部展开——跟着 omp 走，从终端面板、审批门的"详情"按的 Ctrl+O 也算，不会和卡片的展开状态错开。
// 用户点过组头以本地为准，直到默认值变了才作废。记录按组里每张卡的 omp 调用 id 存：待办卡会被 omp 删了再加到后面，组的第一张卡会变。
import { useEffect, type KeyboardEvent } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { LIVE_TOOL_STATUSES, runOpen, type RunFold, type ToolRun } from "../../../../shared/tsp/tool-runs.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";
import { useTaskValue } from "../../store/index.ts";
import { ChevronDown } from "../../icons.tsx";
import { toolIconName } from "./icon-names.ts";
import { TspIcon } from "./icons.tsx";
import { labels } from "./labels.ts";
import { useTspEnded } from "./tsp-context.ts";
import { onTspDocumentDropped, useTspToolsExpanded } from "./tsp-store.ts";

const folds = createStore<Readonly<Record<string, RunFold>>>({});

const foldKey = (taskId: TaskId, sf: string, toolKey: string) => `${taskId}\u0000${sf}\u0000${toolKey}`;

onTspDocumentDropped((taskId) => {
  const prefix = `${taskId}\u0000`;
  const current = folds.get();
  const kept = Object.entries(current).filter(([key]) => !key.startsWith(prefix));
  if (kept.length !== Object.keys(current).length) folds.set(Object.fromEntries(kept));
});

const BUSY_TASK: ReadonlySet<string> = new Set(["running", "needs_you"]);

export interface RunState {
  open: boolean;
  toggle(): void;
}

/** 这个 surface 的每一组展开着没有，和点组头的切换（按组的第一个成员 id）。 */
export function useToolRunStates(taskId: TaskId, sf: string, runs: readonly ToolRun[]): ReadonlyMap<string, RunState> {
  const ended = useTspEnded();
  const busy = useTaskValue(taskId, (task) => task !== null && BUSY_TASK.has(task.status));
  const expanded = useTspToolsExpanded(taskId, sf);
  const state = useStoreValue(folds, (value) => value);
  const states = new Map<string, RunState>();
  const stale: string[] = [];
  for (const run of runs) {
    const keys = run.tools.map((tool) => foldKey(taskId, sf, tool.key));
    const fold = keys.map((key) => state[key]).find((entry) => entry !== undefined);
    const { open, basis, stale: outdated } = runOpen(run, { ended, busy, expanded }, fold);
    if (outdated) stale.push(...keys);
    states.set(run.members[0]!, {
      open,
      toggle: () => {
        const next = { ...folds.get() };
        for (const key of keys) next[key] = { basis, open: !open };
        folds.set(next);
      },
    });
  }
  // 默认值变了（跑完了、Ctrl+O）：用户点的记录作废，删掉（留着的话默认值变回去时它又生效）。
  const staleKeys = stale.join("\u0001");
  useEffect(() => {
    if (staleKeys === "") return;
    const gone = new Set(staleKeys.split("\u0001"));
    folds.set(Object.fromEntries(Object.entries(folds.get()).filter(([key]) => !gone.has(key))));
  }, [staleKeys]);
  return states;
}

/** 组头里的小图标：每种工具一个，按第一次出现的顺序，最多这么多个。 */
const MAX_ICONS = 6;

export function ToolRunHead({ run, open, onToggle }: { run: ToolRun; open: boolean; onToggle(): void }) {
  const failed = run.tools.filter((tool) => tool.status === "error").length;
  const running = run.tools.some((tool) => LIVE_TOOL_STATUSES.has(tool.status));
  const allDone = run.tools.every((tool) => tool.status === "done");
  const icons = [...new Set(run.tools.map((tool) => toolIconName(tool.name)))].slice(0, MAX_ICONS);
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onToggle();
  };
  return (
    <div
      className="tsp-run-head"
      data-anchor=""
      data-testid="tsp-tool-run"
      data-count={run.tools.length}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={onToggle}
      onKeyDown={onKeyDown}
    >
      <span className="tsp-run-ics" aria-hidden="true">
        {icons.map((name) => (
          <TspIcon key={name} name={name} />
        ))}
      </span>
      <span className="tsp-run-title">{labels.agentTools(run.tools.length)}</span>
      {failed > 0 && <span className="tsp-run-failed">{labels.toolsFailed(failed)}</span>}
      <span className="tsp-tool-sp" />
      <span className="tsp-tool-st">
        {running ? (
          <i className="tsp-tool-spin" />
        ) : allDone ? (
          <span className="tsp-check">
            <TspIcon name="check" />
          </span>
        ) : null}
      </span>
      <span className="tsp-chev" data-collapsed={!open || undefined}>
        <ChevronDown size={12} />
      </span>
    </div>
  );
}
