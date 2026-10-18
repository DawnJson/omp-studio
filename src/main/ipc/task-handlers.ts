// 任务和项目的 IPC handler：校验参数，委托任务池。参数一律是 unknown，先校验再用（AGENTS.md "Electron 安全"）。
// "id 是否存在""对话框是否还在 pending 表里""select 的值是否在 options 里"由任务池/运行时查表确认。
import { dialog, shell } from "electron";
import type { HandlerGroup } from "../../shared/ipc.ts";
import { canOpenDirectly, resolveInsideReal } from "./task-file-path.ts";
import { getTaskPool } from "../tasks/runtime.ts";
import { getMainWindow } from "../window/main-window.ts";
import {
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
  return { projectId: parseProjectId(record["projectId"]) };
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
  | "compactTask"
  | "openTaskFile"
  | "revealTaskFile"
> = {
  compactTask: async (taskId) => (await getTaskPool()).compactTask(parseTaskId(taskId)),

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
};
