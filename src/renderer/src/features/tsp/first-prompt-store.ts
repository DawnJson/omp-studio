// 新任务发出的第一句话：omp 还没建 surface、没回显用户消息之前，TspView 先把它画成用户气泡，主区不留空白。
// 同时记下草稿页当时显示的模型和思考强度（就是 omp 的默认值）：omp 的输入框卡片出现前任务页的模型胶囊先显示它，不闪"未连接模型"。
// 由 DraftComposer 在建任务后记下；omp 的 omp.user 节点出现、任务出错/退出时清掉。
import { useMemo, useSyncExternalStore } from "react";
import type { ModelOption, TaskId } from "../../../../shared/ipc.ts";
import type { ThinkingLevel } from "../../../../shared/omp-wire/rpc-wire.generated.ts";

export interface FirstPrompt {
  text: string;
  model: ModelOption | null;
  thinkingLevel: ThinkingLevel | null;
}

const prompts = new Map<TaskId, FirstPrompt>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setFirstPrompt(taskId: TaskId, prompt: FirstPrompt): void {
  prompts.set(taskId, prompt);
  emit();
}

export function clearFirstPrompt(taskId: TaskId): void {
  if (prompts.delete(taskId)) emit();
}

export function useFirstPrompt(taskId: TaskId): FirstPrompt | undefined {
  const subscribe = useMemo(
    () => (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    [],
  );
  return useSyncExternalStore(subscribe, () => prompts.get(taskId));
}
