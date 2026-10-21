// 任务的额外工作区目录（`/add-dir`，spec §4.27）：文件夹选择框在主进程里弹，渲染进程不传路径；
// 移除按下标（和文件面板的根下标一致），路径由主进程从它记的列表（omp 的输出）里取。
import { dialog } from "electron";
import type { HandlerGroup } from "../../shared/ipc.ts";
import { MAX_ROOT_INDEX } from "../files/task-roots.ts";
import { getTaskPool } from "../tasks/runtime.ts";
import { getMainWindow } from "../window/main-window.ts";
import { parseInteger, parseTaskId } from "./validate.ts";

export const workspaceDirsHandlers: HandlerGroup<"addWorkspaceDir" | "removeWorkspaceDir" | "refreshWorkspaceDirs"> = {
  async addWorkspaceDir(taskId) {
    const pool = await getTaskPool();
    const id = parseTaskId(taskId);
    pool.taskCwd(id); // 任务不存在时先报错，不弹框
    const window = getMainWindow();
    const options = { properties: ["openDirectory" as const] };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    const dir = result.filePaths[0];
    if (result.canceled || dir === undefined) return null;
    return { text: await pool.runWorkspaceDirsCommand(id, { kind: "addDir", path: dir }) };
  },
  async removeWorkspaceDir(taskId, root) {
    const pool = await getTaskPool();
    return {
      text: await pool.removeWorkspaceDirAt(parseTaskId(taskId), parseInteger(root, "root", 1, MAX_ROOT_INDEX)),
    };
  },
  async refreshWorkspaceDirs(taskId) {
    await (await getTaskPool()).refreshWorkspaceDirs(parseTaskId(taskId));
  },
};
