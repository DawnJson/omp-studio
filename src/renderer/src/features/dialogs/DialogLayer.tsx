// 占位：对应切片整体替换本文件的内容；导出名和 props 是 App.tsx 的约定，不要改。
// taskId 是当前选中的任务（可能为 null）；对话框数据从 useTask(taskId).dialogs 取。
import type { TaskId } from "../../../../shared/ipc.ts";

export function DialogLayer({ taskId }: { taskId: TaskId | null }) {
  return <div data-feature="dialogs" data-task-id={taskId ?? undefined} />;
}
