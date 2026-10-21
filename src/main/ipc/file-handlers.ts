// `@` 文件引用补全、右侧文件面板的文件树和预览：目录由主进程按任务（或新任务草稿的项目、默认文件夹）查出，渲染进程不传根路径；
// 任务可以多选一个根：`root` 下标（0 / 缺省 = 任务 cwd，n = 第 n 个 `/add-dir` 额外工作区目录，路径取自主进程记的 omp 输出，见 task-roots.ts）。
// `@` 补全只在任务 cwd 里找（目前不扫额外目录）。补全只返回相对路径，结果条数有上限；树一次只列一层。
import { stat } from "node:fs/promises";
import type { HandlerGroup, ProjectFilesTarget } from "../../shared/ipc.ts";
import { listDirectory } from "../files/list-directory.ts";
import { ProjectFileIndex, parseFileQuery } from "../files/project-files.ts";
import { getTaskPool } from "../tasks/runtime.ts";
import { chatsDir } from "../tasks/chats-dir.ts";
import { readPreviewFile } from "../files/preview-file.ts";
import { parseOneOf, parseProjectId, parseRecord, parseString, parseTaskId } from "./validate.ts";
import { parseRootIndex, rootDir } from "../files/task-roots.ts";

const index = new ProjectFileIndex();

export function parseFilesTarget(value: unknown): ProjectFilesTarget {
  const record = parseRecord(value, "target");
  const kind = parseOneOf(record["kind"], "target.kind", ["task", "project", "defaultFolder"]);
  if (kind === "task") {
    const root = parseRootIndex(record["root"]);
    return root === 0
      ? { kind, taskId: parseTaskId(record["taskId"]) }
      : { kind, taskId: parseTaskId(record["taskId"]), root };
  }
  if (kind === "project") return { kind, projectId: parseProjectId(record["projectId"]) };
  return { kind };
}

/** 默认文件夹只读浏览，不为浏览建目录（终端和第一次发送才建）；还没建时列表为空、`@` 补全无候选。 */
export async function targetCwd(target: ProjectFilesTarget): Promise<string> {
  if (target.kind === "defaultFolder") return chatsDir();
  const pool = await getTaskPool();
  if (target.kind === "task")
    return rootDir(pool.taskCwd(target.taskId), pool.taskWorkspaceDirs(target.taskId), target.root ?? 0);
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
