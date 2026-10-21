// 文件面板 / `@` 补全的数据来源（纯函数，单测在 test/file-handlers.test.ts）。
import { parseDraftKey, type ProjectFilesTarget, type TaskId, type TerminalKey } from "../../../../shared/ipc.ts";

/** 任务的工作目录、草稿的项目目录，或默认文件夹（没有项目的草稿）；都由主进程查出，渲染进程不传路径。 */
export function filesTarget(key: TerminalKey): ProjectFilesTarget {
  const draft = parseDraftKey(key);
  if (draft === undefined) return { kind: "task", taskId: key as TaskId };
  if (draft.projectId === null) return { kind: "defaultFolder" };
  return { kind: "project", projectId: draft.projectId };
}
