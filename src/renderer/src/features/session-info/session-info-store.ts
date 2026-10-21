// 会话信息对话框和分享对话框的开关：哪里触发都只往这里放一条，SessionInfoHost（挂在 App 里）负责显示。
import type { TaskId } from "../../../../shared/ipc.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";

export type SessionInfoTab = "info" | "trace";

export interface SessionInfoState {
  taskId: TaskId;
  tab: SessionInfoTab;
}

const info = createStore<SessionInfoState | null>(null);
const share = createStore<TaskId | null>(null);

/** 打开会话信息对话框（`/session`、`/trace`、顶栏菜单、命令面板）；已开着就切到对应页签。 */
export function openSessionInfo(taskId: TaskId, tab: SessionInfoTab = "info"): void {
  info.set({ taskId, tab });
}

export function closeSessionInfo(): void {
  info.set(null);
}

export function useSessionInfoState(): SessionInfoState | null {
  return useStoreValue(info, (state) => state);
}

/** 打开分享确认框（会上传会话：先确认，见 ShareDialog）。 */
export function openShareDialog(taskId: TaskId): void {
  share.set(taskId);
}

export function closeShareDialog(): void {
  share.set(null);
}

export function useShareDialogTask(): TaskId | null {
  return useStoreValue(share, (state) => state);
}
