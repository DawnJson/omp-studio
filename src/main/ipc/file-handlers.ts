// `@` 文件引用补全、右侧文件面板的文件树和预览：目录由主进程按任务（或新任务草稿的项目）查出，渲染进程不传根路径；
// 补全只返回相对路径，结果条数有上限；树一次只列一层。
import { stat } from "node:fs/promises";
import type { HandlerGroup, ProjectFilesTarget } from "../../shared/ipc.ts";
import { listDirectory } from "../files/list-directory.ts";
import { ProjectFileIndex, parseFileQuery } from "../files/project-files.ts";
import { getTaskPool } from "../tasks/runtime.ts";
import { readPreviewFile } from "../files/preview-file.ts";
import { parseOneOf, parseProjectId, parseRecord, parseString, parseTaskId } from "./validate.ts";

const index = new ProjectFileIndex();

function parseFilesTarget(value: unknown): ProjectFilesTarget {
  const record = parseRecord(value, "target");
  return parseOneOf(record["kind"], "target.kind", ["task", "project"]) === "task"
    ? { kind: "task", taskId: parseTaskId(record["taskId"]) }
    : { kind: "project", projectId: parseProjectId(record["projectId"]) };
}

async function targetCwd(target: ProjectFilesTarget): Promise<string> {
  const pool = await getTaskPool();
  if (target.kind === "task") return pool.taskCwd(target.taskId);
  const project = pool.listProjects().find((candidate) => candidate.id === target.projectId);
  if (!project) throw new Error("unknown project");
  return project.path;
}

export const fileHandlers: HandlerGroup<"listProjectFiles" | "readPreviewFile" | "listDirectory"> = {
  async readPreviewFile(target, relPath) {
    const cwd = await targetCwd(parseFilesTarget(target));
    return readPreviewFile(cwd, parseString(relPath, "relPath", 1024));
  },
  async listDirectory(target, relDir) {
    const cwd = await targetCwd(parseFilesTarget(target));
    return listDirectory(cwd, parseString(relDir, "relDir", 1024, { allowEmpty: true }));
  },
  async listProjectFiles(target, query) {
    const parsed = parseFilesTarget(target);
    const q = parseFileQuery(query);
    const cwd = await targetCwd(parsed);
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
