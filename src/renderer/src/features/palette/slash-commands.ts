// 任务的可用斜杠命令（omp get_available_commands / available_commands_update）。命令面板和输入框的 "/" 补全共用。
// 第一次有人用到某个任务时向主进程取一次，之后靠 slashCommands 事件更新。
import { useEffect } from "react";
import type { AvailableSlashCommand } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";

const byTask = createStore<Readonly<Record<string, readonly AvailableSlashCommand[]>>>({});
const requested = new Set<TaskId>();
let subscribed = false;
const none: readonly AvailableSlashCommand[] = [];

function subscribe(): void {
  if (subscribed) return;
  subscribed = true;
  window.studio.onSlashCommands(({ taskId, commands }) => {
    byTask.set({ ...byTask.get(), [taskId]: commands });
  });
}

/** 当前任务的斜杠命令；没有任务或还没载入时是空数组（稳定引用）。 */
export function useSlashCommands(taskId: TaskId | null): readonly AvailableSlashCommand[] {
  useEffect(() => {
    if (taskId === null) return;
    subscribe();
    if (requested.has(taskId)) return;
    requested.add(taskId);
    window.studio.listSlashCommands(taskId).then(
      (commands) => byTask.set({ ...byTask.get(), [taskId]: commands }),
      (error: unknown) => {
        // 失败时允许下次再取；界面退回"把输入当消息发送"。
        requested.delete(taskId);
        console.error("listSlashCommands 失败", error);
      },
    );
  }, [taskId]);
  return useStoreValue(byTask, (state) => (taskId === null ? none : (state[taskId] ?? none)));
}
