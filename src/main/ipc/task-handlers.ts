// 任务和项目的 IPC handler：校验参数，委托任务池。参数一律是 unknown，先校验再用（AGENTS.md "Electron 安全"）。
// "id 是否存在"由任务池查表确认。
import { app, dialog, shell } from "electron";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chatsDir } from "../tasks/chats-dir.ts";
import { exportFileName } from "../tasks/export-name.ts";
import { exportedFile, exportTarget, recordExport } from "../tasks/export-record.ts";
import { limits, TERMINAL_LOGIN_ID } from "../../shared/ipc.ts";
import type { HandlerGroup } from "../../shared/ipc.ts";
import { canOpenDirectly, resolveInsideReal } from "./task-file-path.ts";
import { parseRootIndex, rootDir } from "../files/task-roots.ts";
import { terminalLogin } from "../login/terminal-login-instance.ts";
import { getTaskPool } from "../tasks/runtime.ts";
import { getMainWindow } from "../window/main-window.ts";
import {
  IpcValidationError,
  parseBlobId,
  parseBoolean,
  parseModelKey,
  parseOneOf,
  parseInteger,
  parsePromptInput,
  parseProjectId,
  parseRecord,
  parseString,
  parseTspEvent,
  parseTaskId,
  parseThinkingLevel,
  parseTitle,
} from "./validate.ts";

function parseCreateTaskInput(value: unknown) {
  const record = parseRecord(value, "input");
  return {
    projectId: parseProjectId(record["projectId"]),
    ...(record["worktree"] !== undefined && { worktree: parseBoolean(record["worktree"], "input.worktree") }),
    ...(record["model"] !== undefined && { model: parseModelKey(record["model"]) }),
    ...(record["thinkingLevel"] !== undefined && { thinkingLevel: parseThinkingLevel(record["thinkingLevel"]) }),
  };
}

export const taskHandlers: HandlerGroup<
  | "listProjects"
  | "addProject"
  | "ensureChatsProject"
  | "removeProject"
  | "listTasks"
  | "createTask"
  | "openTask"
  | "sendPrompt"
  | "stopTask"
  | "renameTask"
  | "setTaskKeepAlive"
  | "archiveTask"
  | "listTaskModels"
  | "setTaskModel"
  | "setTaskThinkingLevel"
  | "setTaskFastMode"
  | "setTaskSlowMode"
  | "compactTask"
  | "restartTask"
  | "exportTaskHtml"
  | "revealTaskExport"
  | "getSessionTree"
  | "forkTask"
  | "branchTask"
  | "labelTreeEntry"
  | "taskGoal"
  | "openTaskFile"
  | "revealTaskFile"
  | "openTaskFolder"
  | "getTspSnapshot"
  | "getTspBlob"
  | "getTspSeq"
  | "getTspSessionExtras"
  | "readTspContext"
  | "sendTspEvent"
  | "sendTspKeys"
  | "resizeTsp"
> = {
  compactTask: async (taskId) => (await getTaskPool()).compactTask(parseTaskId(taskId)),
  restartTask: async (taskId) => (await getTaskPool()).restartTask(parseTaskId(taskId)),
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
  getSessionTree: async (taskId) => (await getTaskPool()).getSessionTree(parseTaskId(taskId)),
  // entryId 是会话树面板里的会话条目 id，null = 当前分支最后一条用户消息；主进程在会话文件里查，查不到就拒绝。
  forkTask: async (taskId, entryId) =>
    (await getTaskPool()).forkTask(parseTaskId(taskId), entryId === null ? null : parseString(entryId, "entryId", 200)),
  branchTask: async (taskId, entryId, summarize) =>
    (await getTaskPool()).branchTask(
      parseTaskId(taskId),
      parseString(entryId, "entryId", 200),
      summarize === undefined ? false : parseBoolean(summarize, "summarize"),
    ),
  labelTreeEntry: async (taskId, entryId, label) =>
    (await getTaskPool()).labelTreeEntry(
      parseTaskId(taskId),
      parseString(entryId, "entryId", 200),
      label === null ? null : parseString(label, "label", 200, { allowEmpty: true }),
    ),
  taskGoal: async (taskId, op, objective) => {
    const pool = await getTaskPool();
    const id = parseTaskId(taskId);
    const goalOp = parseOneOf(op, "op", ["get", "create", "pause", "resume", "drop"]);
    if (goalOp !== "create") return pool.taskGoal(id, goalOp);
    const text = parseString(objective, "objective", limits.goalObjectiveMaxChars, { allowEmpty: true }).trim();
    if (text === "") throw new IpcValidationError("objective 不能为空");
    return pool.taskGoal(id, goalOp, text);
  },

  openTaskFile: async (taskId, relPath, root) => {
    const pool = await getTaskPool();
    const id = parseTaskId(taskId);
    const file = await resolveInsideReal(
      rootDir(pool.taskCwd(id), pool.taskWorkspaceDirs(id), parseRootIndex(root)),
      parseString(relPath, "relPath", 1024),
    );
    if (!canOpenDirectly(file))
      throw new Error(
        "only plain text, code, image and document files are opened directly; reveal them in the folder instead",
      );
    // shell.openPath 返回错误文本（空串 = 成功）。
    const error = await shell.openPath(file);
    if (error !== "") throw new Error(error);
  },

  revealTaskFile: async (taskId, relPath, root) => {
    const pool = await getTaskPool();
    const id = parseTaskId(taskId);
    shell.showItemInFolder(
      await resolveInsideReal(
        rootDir(pool.taskCwd(id), pool.taskWorkspaceDirs(id), parseRootIndex(root)),
        parseString(relPath, "relPath", 1024),
      ),
    );
  },

  openTaskFolder: async (taskId) => {
    const error = await shell.openPath((await getTaskPool()).taskCwd(parseTaskId(taskId)));
    if (error !== "") throw new Error(error);
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

  ensureChatsProject: async () => {
    const dir = chatsDir();
    await mkdir(dir, { recursive: true });
    return (await getTaskPool()).ensureProject(dir);
  },

  removeProject: async (projectId) => (await getTaskPool()).removeProject(parseProjectId(projectId)),

  listTasks: async () => (await getTaskPool()).listTasks(),

  createTask: async (input) => (await getTaskPool()).createTask(parseCreateTaskInput(input)),

  openTask: async (taskId) => (await getTaskPool()).openTask(parseTaskId(taskId)),

  // 节点树快照、用户操作 → TSP 事件、按键字节、面板宽度。
  // 应用内终端登录的临时 omp 没有任务记录：用同一条 TSP 通道，主进程按固定 id 路由（任务池不认识它）。
  getTspSnapshot: async (taskId) => {
    const id = parseTaskId(taskId);
    return id === TERMINAL_LOGIN_ID ? terminalLogin().snapshot() : (await getTaskPool()).getTspSnapshot(id);
  },
  getTspBlob: async (taskId, blobId) => {
    const id = parseTaskId(taskId);
    const blob = parseBlobId(blobId);
    return id === TERMINAL_LOGIN_ID ? terminalLogin().blob(blob) : (await getTaskPool()).getTspBlob(id, blob);
  },
  getTspSeq: async (taskId) => (await getTaskPool()).getTspSeq(parseTaskId(taskId)),
  getTspSessionExtras: async (taskId) => (await getTaskPool()).getTspSessionExtras(parseTaskId(taskId)),
  readTspContext: async (taskId) => (await getTaskPool()).readTspContext(parseTaskId(taskId)),

  sendTspEvent: async (taskId, event) => {
    const id = parseTaskId(taskId);
    const parsed = parseTspEvent(event);
    if (id === TERMINAL_LOGIN_ID) terminalLogin().sendEvent(parsed);
    else (await getTaskPool()).sendTspEvent(id, parsed);
  },

  sendTspKeys: async (taskId, data) => {
    const id = parseTaskId(taskId);
    const keys = parseString(data, "data", 1_000_000);
    if (id === TERMINAL_LOGIN_ID) terminalLogin().sendKeys(keys);
    else (await getTaskPool()).sendTspKeys(id, keys);
  },

  resizeTsp: async (taskId, cols) =>
    (await getTaskPool()).resizeTsp(parseTaskId(taskId), parseInteger(cols, "cols", 20, 1000)),

  sendPrompt: async (taskId, input) => (await getTaskPool()).sendPrompt(parseTaskId(taskId), parsePromptInput(input)),

  stopTask: async (taskId) => (await getTaskPool()).stopTask(parseTaskId(taskId)),

  renameTask: async (taskId, title) => (await getTaskPool()).renameTask(parseTaskId(taskId), parseTitle(title)),

  setTaskKeepAlive: async (taskId, on) =>
    (await getTaskPool()).setTaskKeepAlive(parseTaskId(taskId), parseBoolean(on, "on")),

  archiveTask: async (taskId) => (await getTaskPool()).archiveTask(parseTaskId(taskId)),

  listTaskModels: async (taskId) => (await getTaskPool()).listTaskModels(parseTaskId(taskId)),

  setTaskModel: async (taskId, model) => (await getTaskPool()).setTaskModel(parseTaskId(taskId), parseModelKey(model)),

  setTaskThinkingLevel: async (taskId, level) =>
    (await getTaskPool()).setTaskThinkingLevel(parseTaskId(taskId), parseThinkingLevel(level)),

  setTaskFastMode: async (taskId, enabled) =>
    (await getTaskPool()).setTaskFastMode(parseTaskId(taskId), parseBoolean(enabled, "enabled")),

  setTaskSlowMode: async (taskId, enabled) =>
    (await getTaskPool()).setTaskSlowMode(parseTaskId(taskId), parseBoolean(enabled, "enabled")),
};
