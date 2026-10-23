// 草稿里"用于此任务"选的模型 / 思考强度（按草稿键，只在内存里）：发第一条时随 createTask 交给主进程，任务以
// `--model` / `--thinking` 起进程，只对这个会话生效（omp 不写配置）；没选的项跟 omp 的默认值走。发送成功后清掉。
import type { ModelKey, TaskId } from "../../../../shared/ipc.ts";
import type { ThinkingLevel } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";

export interface DraftModelChoice {
  model: ModelKey | null;
  thinkingLevel: ThinkingLevel | null;
}

const none: DraftModelChoice = { model: null, thinkingLevel: null };

const choices = createStore<Readonly<Record<string, DraftModelChoice>>>({});

export function useDraftModelChoice(key: TaskId): DraftModelChoice {
  return useStoreValue(choices, (state) => state[key] ?? none);
}

export function chooseDraftModel(key: TaskId, patch: Partial<DraftModelChoice>): void {
  const state = choices.get();
  choices.set({ ...state, [key]: { ...(state[key] ?? none), ...patch } });
}

export function clearDraftModelChoice(key: TaskId): void {
  const next = { ...choices.get() };
  delete next[key];
  choices.set(next);
}
