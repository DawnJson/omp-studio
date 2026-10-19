// 导出 HTML 的落盘记录：toast 的"在文件夹中显示"只能显示主进程自己选的路径，渲染进程不传路径。
// 纯逻辑（不依赖 electron），handler 和任务池的 taskRemoved 回调共用同一份表。
import { pathKey } from "./task-registry.ts";
import type { TaskId } from "../../shared/ipc.ts";

/** 保存对话框在某些平台不补扩展名，omp 也不补（实测）：这里保证目标是 .html（`.htm` 不算）。 */
export function exportTarget(filePath: string): string {
  return /\.html$/i.test(filePath) ? filePath : `${filePath}.html`;
}

const exported = new Map<TaskId, string>();

/**
 * 记下导出写到的文件。omp 返回的路径必须就是主进程给它的 target（解析后比较），否则不记录并返回 false：
 * 不把 omp 回传的任意路径交给 shell.showItemInFolder。
 */
export function recordExport(taskId: TaskId, target: string, written: string): boolean {
  if (pathKey(written) !== pathKey(target)) return false;
  exported.set(taskId, target);
  return true;
}

export function exportedFile(taskId: TaskId): string | undefined {
  return exported.get(taskId);
}

/** 任务被归档/移除时清掉它的记录。 */
export function forgetExport(taskId: TaskId): void {
  exported.delete(taskId);
}
