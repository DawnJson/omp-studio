// 任务的可用斜杠命令（服务进程的 get_available_commands）。命令面板和输入框的 "/" 补全共用。
// 有人用到某个任务（或草稿页）时向主进程取，拿到非空列表之前每次任务状态变化都会再取（规则见 slash-cache.ts）。
import { useEffect } from "react";
import type { AvailableSlashCommand } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";
import { useTask } from "../../store/index.ts";
import { createSlashLoader } from "./slash-cache.ts";

/** 草稿页（还没有任务）在列表里的键；任务 id 是 UUID，不会撞。 */
const DRAFT_KEY = "draft";

const byKey = createStore<Readonly<Record<string, readonly AvailableSlashCommand[]>>>({});
const none: readonly AvailableSlashCommand[] = [];

const loader = createSlashLoader(
  (key) => window.studio.listSlashCommands(key === DRAFT_KEY ? null : (key as TaskId)),
  (key, commands) => byKey.set({ ...byKey.get(), [key]: commands }),
  // 失败时界面退回"把输入当消息发送"；下次 request 会再取。
  (error) => console.error("listSlashCommands 失败", error),
);

function useCommandsFor(key: string | null, refetchOn: unknown): readonly AvailableSlashCommand[] {
  useEffect(() => {
    if (key === null) return;
    void loader.request(key);
  }, [key, refetchOn]);
  return useStoreValue(byKey, (state) => (key === null ? none : (state[key] ?? none)));
}

/** 当前任务的斜杠命令；没有任务或还没载入时是空数组（稳定引用）。任务状态变化时（如起进程完成）没取到的会再取。 */
export function useSlashCommands(taskId: TaskId | null): readonly AvailableSlashCommand[] {
  const status = useTask(taskId)?.status;
  return useCommandsFor(taskId, status);
}

/** 草稿页的斜杠命令（服务进程的列表）。 */
export function useDraftSlashCommands(): readonly AvailableSlashCommand[] {
  return useCommandsFor(DRAFT_KEY, null);
}
