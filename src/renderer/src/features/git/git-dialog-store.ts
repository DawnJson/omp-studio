// git 操作的对话框：哪里触发都只往这里放一条，GitDialogHost（挂在 App 里）负责显示。
import type { WorktreeCleanupResult, WorktreeSetupInfo } from "../../../../shared/git.ts";
import type { ProjectId, TaskId } from "../../../../shared/ipc.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";

export type GitDialogState =
  | { kind: "commit"; taskId: TaskId }
  | { kind: "pr"; taskId: TaskId; defaultTitle: string }
  | { kind: "discard"; taskId: TaskId; branch: string }
  | { kind: "conflict"; files: string[] }
  | { kind: "cleanup"; result: WorktreeCleanupResult }
  /** 项目的 setup 脚本首次（或内容变了）要运行：settle(true) = 用户同意并已记下。 */
  | { kind: "setup"; projectId: ProjectId; script: WorktreeSetupInfo; settle(approved: boolean): void };

const dialog = createStore<GitDialogState | null>(null);

export function openGitDialog(state: GitDialogState): void {
  dialog.set(state);
}

export function closeGitDialog(): void {
  dialog.set(null);
}

export function useGitDialog(): GitDialogState | null {
  return useStoreValue(dialog, (state) => state);
}
