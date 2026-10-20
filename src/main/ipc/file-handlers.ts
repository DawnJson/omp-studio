// `@` 文件引用补全：列出任务目录（或新任务草稿的项目目录）里匹配查询词的相对路径。
// 目录由主进程按任务/项目 id 查出，渲染进程不传路径；只返回相对路径，结果条数有上限。
import { stat } from "node:fs/promises";
import type { HandlerGroup, ProjectFilesTarget } from "../../shared/ipc.ts";
import { ProjectFileIndex, parseFileQuery } from "../files/project-files.ts";
import { getTaskPool } from "../tasks/runtime.ts";
import { readPreviewFile } from "../files/preview-file.ts";
import { parseOneOf, parseProjectId, parseRecord, parseString, parseTaskId } from "./validate.ts";

const index = new ProjectFileIndex();

export function parseFilesTarget(value: unknown): ProjectFilesTarget {
  const record = parseRecord(value, "target");
  return parseOneOf(record["kind"], "target.kind", ["task", "project"]) === "task"
    ? { kind: "task", taskId: parseTaskId(record["taskId"]) }
    : { kind: "project", projectId: parseProjectId(record["projectId"]) };
}

export const fileHandlers: HandlerGroup<"listProjectFiles" | "readPreviewFile"> = {
  async readPreviewFile(taskId, relPath) {
    const id = parseTaskId(taskId);
    const pool = await getTaskPool();
    return readPreviewFile(pool.taskCwd(id), parseString(relPath, "relPath", 1024));
  },
  async listProjectFiles(target, query) {
    const parsed = parseFilesTarget(target);
    const q = parseFileQuery(query);
    const pool = await getTaskPool();
    let cwd: string;
    if (parsed.kind === "task") cwd = pool.taskCwd(parsed.taskId);
    else {
      const project = pool.listProjects().find((candidate) => candidate.id === parsed.projectId);
      if (!project) throw new Error("unknown project");
      cwd = project.path;
    }
    if (
      !(await stat(cwd).then(
        (info) => info.isDirectory(),
        () => false,
      ))
    )
      return [];
    return index.search(cwd, q);
  },
};
