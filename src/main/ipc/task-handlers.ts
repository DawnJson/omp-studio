// 任务和项目的 IPC handler：校验参数，委托任务池。参数一律是 unknown，先校验再用（AGENTS.md "Electron 安全"）。
// "id 是否存在""对话框是否还在 pending 表里""select 的值是否在 options 里"由任务池/运行时查表确认。
import { app, dialog, shell } from "electron";
import path from "node:path";
import { exportFileName } from "../tasks/export-name.ts";
import { exportedFile, exportTarget, recordExport } from "../tasks/export-record.ts";
import { limits } from "../../shared/ipc.ts";
import type { HandlerGroup } from "../../shared/ipc.ts";
import { canOpenDirectly, resolveInsideReal } from "./task-file-path.ts";
import { getTaskPool } from "../tasks/runtime.ts";
import { getMainWindow } from "../window/main-window.ts";
import {
  IpcValidationError,
  parseBoolean,
  parseDialogResponse,
  parseModelKey,
  parseOneOf,
  parsePromptInput,
  parseProjectId,
  parseRecord,
  parseString,
  parseTaskId,
  parseThinkingLevel,
  parseTitle,
} from "./validate.ts";

/** 排队消息的文本是 omp 给的 chip 文本，上限和 prompt 一致（不限长度，帧大小由运行时检查）。 */
const queuedTextMaxChars = Number.MAX_SAFE_INTEGER;

function parseCreateTaskInput(value: unknown) {
  const record = parseRecord(value, "input");
  return {
    projectId: parseProjectId(record["projectId"]),
    ...(record["worktree"] !== undefined && { worktree: parseBoolean(record["worktree"], "input.worktree") }),
  };
}

export const taskHandlers: HandlerGroup<
  | "listProjects"
  | "addProject"
  | "removeProject"
  | "listTasks"
  | "createTask"
  | "openTask"
  | "getTranscript"
  | "markTaskRead"
  | "sendPrompt"
  | "removeQueuedMessage"
  | "promoteQueuedMessage"
  | "stopTask"
  | "respondDialog"
  | "renameTask"
  | "archiveTask"
  | "restartTask"
  | "listTaskModels"
  | "setTaskModel"
  | "setTaskThinkingLevel"
  | "setTaskFastMode"
  | "setTaskSlowMode"
  | "compactTask"
  | "exportTaskHtml"
  | "revealTaskExport"
  | "runBash"
  | "abortBash"
  | "getSessionTree"
  | "forkTask"
  | "branchTask"
  | "taskGoal"
  | "openTaskFile"
  | "revealTaskFile"
> = {
  compactTask: async (taskId) => (await getTaskPool()).compactTask(parseTaskId(taskId)),
  exportTaskHtml: async (taskId) => {
    const pool = await getTaskPool();
    const id = parseTaskId(taskId);
    const window = getMainWindow();
    const options = {
      defaultPath: path.join(app.getPath("desktop"), exportFileName(pool.taskTitle(id), new Date())),
      filters: [{ name: "HTML", extensions: ["html"] }],
    };
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    // 对话框在某些平台不补扩展名；omp 也不补（实测），所以这里保证是 .html。
    const target = exportTarget(result.filePath);
    const written = await pool.exportTaskHtml(id, target);
    // omp 写到的必须就是我们给的路径；不一致时不记录（“在文件夹中显示”只认主进程自己选的路径）。
    if (!recordExport(id, target, written)) throw new Error("omp wrote the export to an unexpected path");
    return { fileName: path.basename(target) };
  },
  revealTaskExport: async (taskId) => {
    const file = exportedFile(parseTaskId(taskId));
    if (file === undefined) throw new Error("this task has no exported file yet");
    shell.showItemInFolder(file);
  },
  runBash: async (taskId, command) =>
    (await getTaskPool()).runBash(parseTaskId(taskId), parseString(command, "command", limits.bashCommandMaxChars)),
  abortBash: async (taskId) => (await getTaskPool()).abortBash(parseTaskId(taskId)),
  getSessionTree: async (taskId) => (await getTaskPool()).getSessionTree(parseTaskId(taskId)),
  // key 是对话流里用户消息的 key（`h:<序号>` 或 `<gen>:<messageId>`），null = 最后一条；主进程只拿它在自己的快照里查，查不到就拒绝。
  forkTask: async (taskId, userMessageKey) =>
    (await getTaskPool()).forkTask(
      parseTaskId(taskId),
      userMessageKey === null ? null : parseString(userMessageKey, "userMessageKey", 200),
    ),
  branchTask: async (taskId, entryId) =>
    (await getTaskPool()).branchTask(parseTaskId(taskId), parseString(entryId, "entryId", 200)),
  taskGoal: async (taskId, op, objective) => {
    const pool = await getTaskPool();
    const id = parseTaskId(taskId);
    const goalOp = parseOneOf(op, "op", ["get", "create", "pause", "resume", "drop"]);
    if (goalOp !== "create") return pool.taskGoal(id, goalOp);
    const text = parseString(objective, "objective", limits.goalObjectiveMaxChars, { allowEmpty: true }).trim();
    if (text === "") throw new IpcValidationError("objective 不能为空");
    return pool.taskGoal(id, goalOp, text);
  },

  openTaskFile: async (taskId, relPath) => {
    const pool = await getTaskPool();
    const id = parseTaskId(taskId);
    const file = await resolveInsideReal(pool.taskCwd(id), parseString(relPath, "relPath", 1024));
    if (!canOpenDirectly(file))
      throw new Error(
        "only plain text, code, image and document files are opened directly; reveal them in the folder instead",
      );
    // shell.openPath 返回错误文本（空串 = 成功）。
    const error = await shell.openPath(file);
    if (error !== "") throw new Error(error);
  },

  revealTaskFile: async (taskId, relPath) => {
    const pool = await getTaskPool();
    shell.showItemInFolder(
      await resolveInsideReal(pool.taskCwd(parseTaskId(taskId)), parseString(relPath, "relPath", 1024)),
    );
  },

  listProjects: async () => (await getTaskPool()).listProjects(),

  addProject: async () => {
    const window = getMainWindow();
    const options = { properties: ["openDirectory" as const] };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    const dir = result.filePaths[0];
    if (result.canceled || dir === undefined) return null;
    return (await getTaskPool()).ensureProject(dir);
  },

  removeProject: async (projectId) => (await getTaskPool()).removeProject(parseProjectId(projectId)),

  listTasks: async () => (await getTaskPool()).listTasks(),

  createTask: async (input) => (await getTaskPool()).createTask(parseCreateTaskInput(input)),

  openTask: async (taskId) => (await getTaskPool()).openTask(parseTaskId(taskId)),

  getTranscript: async (taskId) => (await getTaskPool()).getTranscript(parseTaskId(taskId)),

  markTaskRead: async (taskId) => (await getTaskPool()).markTaskRead(parseTaskId(taskId)),

  sendPrompt: async (taskId, input) => (await getTaskPool()).sendPrompt(parseTaskId(taskId), parsePromptInput(input)),

  removeQueuedMessage: async (taskId, text, queue) =>
    (await getTaskPool()).removeQueuedMessage(
      parseTaskId(taskId),
      parseString(text, "text", queuedTextMaxChars),
      parseOneOf(queue, "queue", ["steering", "followUp"]),
    ),

  promoteQueuedMessage: async (taskId, text) =>
    (await getTaskPool()).promoteQueuedMessage(parseTaskId(taskId), parseString(text, "text", queuedTextMaxChars)),

  stopTask: async (taskId) => (await getTaskPool()).stopTask(parseTaskId(taskId)),

  respondDialog: async (taskId, dialogId, response) =>
    (await getTaskPool()).respondDialog(
      parseTaskId(taskId),
      parseString(dialogId, "dialogId", 200),
      parseDialogResponse(response),
    ),

  renameTask: async (taskId, title) => (await getTaskPool()).renameTask(parseTaskId(taskId), parseTitle(title)),

  archiveTask: async (taskId) => (await getTaskPool()).archiveTask(parseTaskId(taskId)),

  restartTask: async (taskId) => (await getTaskPool()).restartTask(parseTaskId(taskId)),

  listTaskModels: async (taskId) => (await getTaskPool()).listTaskModels(parseTaskId(taskId)),

  setTaskModel: async (taskId, model) => (await getTaskPool()).setTaskModel(parseTaskId(taskId), parseModelKey(model)),

  setTaskThinkingLevel: async (taskId, level) =>
    (await getTaskPool()).setTaskThinkingLevel(parseTaskId(taskId), parseThinkingLevel(level)),

  setTaskFastMode: async (taskId, enabled) =>
    (await getTaskPool()).setTaskFastMode(parseTaskId(taskId), parseBoolean(enabled, "enabled")),

  setTaskSlowMode: async (taskId, enabled) =>
    (await getTaskPool()).setTaskSlowMode(parseTaskId(taskId), parseBoolean(enabled, "enabled")),
};
