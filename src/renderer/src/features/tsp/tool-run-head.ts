// 连续工具调用组头上画什么（ToolRun.tsx；docs/architecture/conversation.md「连续工具调用合成一组」，2026-11-10 仓库所有者选的写法）：
// 每种工具（按 omp 的工具名，第一次出现的顺序）一个图标 + 这种工具调用了几次，后面是整组用时 = 各张卡 omp 报的 `took` 之和
// （还在跑时只加已经完成的；没有一张卡有 took 时不写）。悬停每张卡一行 `<标题> <目标> · <用时>`，缺的部分不写。
import type { ToolRun } from "../../../../shared/tsp/tool-runs.ts";
import { formatDuration } from "./turn-footer.ts";

/** 组头最多画这么多种工具；再多的几种合起来写成 `+N`（N = 它们的调用次数）。 */
export const MAX_RUN_KINDS = 6;

export interface RunHeadKind {
  /** omp 的工具名。 */
  readonly name: string;
  readonly count: number;
}

export interface RunHead {
  /** 画出来的几种工具，按第一次出现的顺序，最多 MAX_RUN_KINDS 种。 */
  readonly kinds: readonly RunHeadKind[];
  /** 没画出来的那几种工具一共调用了几次；0 = 都画了。 */
  readonly more: number;
  /** 整组用时（formatDuration），没有一张卡报了 took 时为 null。 */
  readonly took: string | null;
  /** 悬停提示：每张卡一行。 */
  readonly title: string;
}

export function toolRunHead(run: ToolRun): RunHead {
  const counts = new Map<string, number>();
  let took = 0;
  let timed = false;
  const lines: string[] = [];
  for (const tool of run.tools) {
    counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
    if (tool.took !== null) {
      took += tool.took;
      timed = true;
    }
    const label = [tool.title || tool.name, tool.target].filter((part) => part !== "").join(" ");
    const time = tool.took === null ? "" : formatDuration(tool.took);
    lines.push([label, time].filter((part) => part !== "").join(" · "));
  }
  const all = [...counts].map(([name, count]) => ({ name, count }));
  const kinds = all.slice(0, MAX_RUN_KINDS);
  const more = all.slice(MAX_RUN_KINDS).reduce((sum, kind) => sum + kind.count, 0);
  return { kinds, more, took: timed ? formatDuration(took) : null, title: lines.join("\n") };
}
