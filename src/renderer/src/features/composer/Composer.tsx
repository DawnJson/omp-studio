// 占位：对应切片整体替换本文件的内容；导出名和 props 是 App.tsx 的约定，不要改。
import type { TaskId } from "../../../../shared/ipc.ts";

export function Composer({ taskId }: { taskId: TaskId }) {
  return <div data-feature="composer" data-task-id={taskId} />;
}
