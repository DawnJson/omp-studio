// 子代理详情：打开时读一次完整记录（get_subagent_messages），运行中每 3 秒刷新，结束时再读一次定稿。
import { useEffect, useState } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import type { SubagentDetail, SubagentLane } from "../../../../shared/subagents.ts";

const REFRESH_MS = 3000;

export interface DetailState {
  detail: SubagentDetail | null;
  /** 第一次读取还没回来。 */
  loading: boolean;
  /** IPC 本身失败（不是 omp 读不到记录；那种情况在 detail.unavailable 里）。 */
  error: string | null;
}

export function useSubagentDetail(taskId: TaskId, lane: SubagentLane): DetailState {
  const [state, setState] = useState<DetailState>({ detail: null, loading: true, error: null });
  const id = lane.id;
  const running = lane.status === "running";

  useEffect(() => {
    let live = true;
    let inflight = false;
    setState((current) => (current.detail?.lane.id === id ? current : { detail: null, loading: true, error: null }));
    const load = () => {
      if (inflight) return;
      inflight = true;
      window.studio
        .getSubagentDetail(taskId, id)
        .then(
          (detail) => live && setState({ detail, loading: false, error: null }),
          (error: unknown) =>
            live &&
            setState((current) => ({
              ...current,
              loading: false,
              error: error instanceof Error ? error.message : String(error),
            })),
        )
        .finally(() => {
          inflight = false;
        });
    };
    load();
    const timer = running ? setInterval(load, REFRESH_MS) : undefined;
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [taskId, id, running]);

  return state;
}
