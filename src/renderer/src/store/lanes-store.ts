// 子代理泳道镜像：每个任务一份 SubagentLane[]。主进程是权威（subagents 事件推整份快照），这里只做投影。
// IPC 每次反序列化出新对象；按 rev 复用没变的泳道，这样只有真的变了的子代理所在的轮会重渲染。
import { useEffect } from "react";
import type { TaskId } from "../../../shared/ipc.ts";
import type { SubagentLane } from "../../../shared/subagents.ts";
import { createStore, useStoreValue } from "./create-store.ts";

const lanesStore = createStore<Readonly<Record<string, readonly SubagentLane[]>>>({});
const noLanes: readonly SubagentLane[] = [];

/** 新快照里 rev 没变的泳道沿用旧对象；整份都没变时返回旧数组。 */
function mergeLanes(
  previous: readonly SubagentLane[] | undefined,
  next: readonly SubagentLane[],
): readonly SubagentLane[] {
  if (!previous) return next;
  const byId = new Map(previous.map((lane) => [lane.id, lane]));
  const merged = next.map((lane) => {
    const old = byId.get(lane.id);
    return old && old.rev === lane.rev && old.startedAt === lane.startedAt ? old : lane;
  });
  return merged.length === previous.length && merged.every((lane, index) => lane === previous[index])
    ? previous
    : merged;
}

function applyLanes(taskId: TaskId, lanes: readonly SubagentLane[]): void {
  const state = lanesStore.get();
  lanesStore.set({ ...state, [taskId]: mergeLanes(state[taskId], lanes) });
}

export function startLanesStore(): void {
  window.studio.onSubagents(({ taskId, lanes }) => applyLanes(taskId, lanes));
  window.studio.onTaskRemoved((taskId) => {
    const { [taskId]: _removed, ...rest } = lanesStore.get();
    lanesStore.set(rest);
  });
}

/** 任务的泳道；第一次用到时向主进程要一份快照（渲染进程重载、任务刚被打开时事件可能已经错过了）。 */
export function useLanes(taskId: TaskId): readonly SubagentLane[] {
  useEffect(() => {
    let live = true;
    window.studio.getSubagents(taskId).then(
      (lanes) => {
        if (live) applyLanes(taskId, lanes);
      },
      (error: unknown) => console.error("getSubagents 失败", error),
    );
    return () => {
      live = false;
    };
  }, [taskId]);
  return useStoreValue(lanesStore, (state) => state[taskId] ?? noLanes);
}
