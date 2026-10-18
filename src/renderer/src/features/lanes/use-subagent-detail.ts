// 子代理详情：打开时读一次记录（get_subagent_messages），运行中每 3 秒刷新，结束时再读一次定稿。
// 主进程按字节增量读并缓存，渲染进程带上已有条数（since）只取新增的，这里按绝对序号追加。
import { useEffect, useRef, useState } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import type { SubagentDetail, SubagentLane } from "../../../../shared/subagents.ts";
import { mergeRecord, type RecordSpan } from "./lane-model.ts";
import type { AgentMessage } from "../../../../shared/omp-wire/rpc-wire.generated.ts";

const REFRESH_MS = 3000;

export interface DetailState {
  /** messages 是合并后的完整记录（主进程只保留最近的一部分，见 SubagentDetail.truncated）。 */
  detail: SubagentDetail | null;
  /** 第一次读取还没回来。 */
  loading: boolean;
  /** IPC 本身失败（不是 omp 读不到记录；那种情况在 detail.unavailable 里）。 */
  error: string | null;
}

interface Held extends RecordSpan<AgentMessage> {
  id: string;
}

export function useSubagentDetail(taskId: TaskId, lane: SubagentLane): DetailState {
  const [state, setState] = useState<DetailState>({ detail: null, loading: true, error: null });
  const held = useRef<Held | null>(null);
  const id = lane.id;
  const running = lane.status === "running";

  useEffect(() => {
    let live = true;
    let inflight = false;
    if (held.current?.id !== id) {
      held.current = null;
      setState({ detail: null, loading: true, error: null });
    }
    const load = () => {
      if (inflight) return;
      inflight = true;
      const current = held.current;
      window.studio
        .getSubagentDetail(taskId, id, current ? current.from + current.messages.length : undefined)
        .then(
          (detail) => {
            if (!live) return;
            if (detail.messages === null) {
              held.current = null;
              setState({ detail, loading: false, error: null });
              return;
            }
            const merged = mergeRecord<AgentMessage>(held.current, { from: detail.from, messages: detail.messages });
            if (merged !== held.current) held.current = { id, from: merged.from, messages: merged.messages };
            setState({ detail: { ...detail, messages: held.current!.messages }, loading: false, error: null });
          },
          (error: unknown) =>
            live &&
            setState((previous) => ({
              ...previous,
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
