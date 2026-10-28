// 任务的可用斜杠命令：主进程按任务目录向项目 rpc-ui 取的 get_available_commands（含项目 skill、自定义命令、扩展命令），
// 加上 TSP 任务里 TUI 才有的命令（shared/omp-tui-commands.ts）。命令面板和输入框的 "/" 补全共用。
// 有人用到某个任务（或草稿页）时向主进程取，拿到非空列表之前每次任务状态变化都会再取（规则见 slash-cache.ts）；
// 之后 omp 主动推来新列表（`available_commands_update`，如重新加载插件）由 slashCommands 事件整份替换。
import { useEffect } from "react";
import type { AvailableSlashCommand } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { mergeTuiCommands } from "../../../../shared/omp-tui-commands.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";
import { useTask } from "../../store/index.ts";
import { createSlashLoader } from "./slash-cache.ts";

/** 草稿页（还没有任务）在列表里的键；任务 id 是 UUID，不会撞。 */
const DRAFT_KEY = "draft";

const byKey = createStore<Readonly<Record<string, readonly AvailableSlashCommand[]>>>({});
const none: readonly AvailableSlashCommand[] = [];

const publish = (key: string, commands: readonly AvailableSlashCommand[]) =>
  byKey.set({ ...byKey.get(), [key]: mergeTuiCommands(commands) });

const loader = createSlashLoader(
  (key) => window.studio.listSlashCommands(key === DRAFT_KEY ? null : (key as TaskId)),
  publish,
  // 失败时界面退回"把输入当消息发送"；下次 request 会再取。
  (error) => console.error("listSlashCommands 失败", error),
);

let subscribed = false;

function useCommandsFor(key: string | null, refetchOn: unknown): readonly AvailableSlashCommand[] {
  useEffect(() => {
    if (subscribed) return;
    subscribed = true;
    // 事件只在 omp 列表非空时才有意义；空列表（omp 还没就绪）不覆盖已有的。
    window.studio.onSlashCommands(({ taskId, commands }) => {
      if (commands.length > 0) publish(taskId, commands);
    });
    // 任务删除：丢掉它的列表和"已载入"记录（"draft" 键按项目共用，不随任务走）。
    window.studio.onTaskRemoved((taskId) => {
      loader.forget(taskId);
      const { [taskId]: _removed, ...rest } = byKey.get();
      byKey.set(rest);
    });
  }, []);
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

/** 用户开始敲 `/`：重新向主进程取一次这个任务的列表（项目里刚建的 skill / 自定义命令；主进程按目录缓存，输入没变时不起 omp）。 */
export function refreshSlashCommands(taskId: TaskId): void {
  void loader.refresh(taskId);
}
