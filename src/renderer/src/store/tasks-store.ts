// 任务表：主进程是权威，这里只是 taskState / taskRemoved 事件的投影。
import { useMemo } from "react";
import type { TaskId, TaskState } from "../../../shared/ipc.ts";
import { createStore, useStoreValue } from "./create-store.ts";

export interface TasksState {
  loaded: boolean;
  /** listTasks 失败时的信息；界面据此显示出错，而不是空列表。 */
  error: string | null;
  byId: Readonly<Record<string, TaskState>>;
  /** 按到达顺序；排序和分组由侧栏自己做。 */
  list: readonly TaskState[];
}

const tasksStore = createStore<TasksState>({ loaded: false, error: null, byId: {}, list: [] });

function withTasks(byId: Record<string, TaskState>, extra: Partial<TasksState> = {}): TasksState {
  return { ...tasksStore.get(), byId, list: Object.values(byId), ...extra };
}

export function startTasksStore(): void {
  window.studio.onTaskState((task) => {
    tasksStore.set(withTasks({ ...tasksStore.get().byId, [task.id]: task }));
  });
  window.studio.onTaskRemoved((taskId) => {
    const { [taskId]: _removed, ...rest } = tasksStore.get().byId;
    tasksStore.set(withTasks(rest));
  });
  window.studio.listTasks().then(
    (tasks) => {
      // 加载期间到达的事件比列表新，保留它们。
      const byId = { ...Object.fromEntries(tasks.map((task) => [task.id, task])), ...tasksStore.get().byId };
      tasksStore.set(withTasks(byId, { loaded: true, error: null }));
    },
    (error: unknown) => {
      console.error("listTasks 失败", error);
      tasksStore.set({ ...tasksStore.get(), error: error instanceof Error ? error.message : String(error) });
    },
  );
}

export function useTasksState(): TasksState {
  return useStoreValue(tasksStore, (state) => state);
}

export function useTasks(): readonly TaskState[] {
  return useStoreValue(tasksStore, (state) => state.list);
}

export function useTask(taskId: TaskId | null): TaskState | null {
  return useStoreValue(tasksStore, (state) => (taskId === null ? null : (state.byId[taskId] ?? null)));
}

/**
 * 任务的一个字段（只在它变了时重渲染，任务状态事件很密）。`select` 要返回原始值或稳定引用：
 * TaskState 经 IPC 来，里面的对象每个事件都是新的，选对象等于每次都重渲染。
 */
export function useTaskValue<S>(taskId: TaskId, select: (task: TaskState | null) => S): S {
  return useStoreValue(tasksStore, (state) => select(state.byId[taskId] ?? null));
}

/** ids 里还存在的任务，顺序不变；只在这个结果变了时重渲染（任务状态事件很密）。 */
export function useExistingTaskIds(ids: readonly TaskId[]): readonly TaskId[] {
  const key = useStoreValue(tasksStore, (state) => ids.filter((id) => state.byId[id] !== undefined).join("\n"));
  return useMemo(() => (key === "" ? [] : (key.split("\n") as TaskId[])), [key]);
}

/** 当前的任务状态（给斜杠命令这类不在渲染里的动作用）；任务不存在时 null。 */
export function getTask(taskId: TaskId): TaskState | null {
  return tasksStore.get().byId[taskId] ?? null;
}

/** 任务是否空闲（只在这个布尔值变化时重渲染，对话流里每条用户消息都订阅它）。 */
export function useTaskIdle(taskId: TaskId): boolean {
  return useStoreValue(tasksStore, (state) => state.byId[taskId]?.status === "idle");
}
