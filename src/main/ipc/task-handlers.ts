// 占位：切片 B 任务运行时整体替换本文件。类型已完整（HandlerGroup 要求每个函数都在），实现抛 not implemented。
// 参数一律是 unknown：用 ./validate.ts 的 parse* 校验后再用。
import type { HandlerGroup } from "../../shared/ipc.ts";
import { notImplemented } from "./not-implemented.ts";

export const taskHandlers: HandlerGroup<"listProjects" | "addProject" | "removeProject" | "listTasks" | "createTask" | "openTask" | "getTranscript" | "markTaskRead" | "sendPrompt" | "removeQueuedMessage" | "promoteQueuedMessage" | "stopTask" | "respondDialog" | "renameTask" | "archiveTask" | "restartTask" | "listTaskModels" | "setTaskModel" | "setTaskThinkingLevel" | "setTaskApprovalMode"> = {
  listProjects: () => notImplemented("listProjects"),
  addProject: () => notImplemented("addProject"),
  removeProject: () => notImplemented("removeProject"),
  listTasks: () => notImplemented("listTasks"),
  createTask: () => notImplemented("createTask"),
  openTask: () => notImplemented("openTask"),
  getTranscript: () => notImplemented("getTranscript"),
  markTaskRead: () => notImplemented("markTaskRead"),
  sendPrompt: () => notImplemented("sendPrompt"),
  removeQueuedMessage: () => notImplemented("removeQueuedMessage"),
  promoteQueuedMessage: () => notImplemented("promoteQueuedMessage"),
  stopTask: () => notImplemented("stopTask"),
  respondDialog: () => notImplemented("respondDialog"),
  renameTask: () => notImplemented("renameTask"),
  archiveTask: () => notImplemented("archiveTask"),
  restartTask: () => notImplemented("restartTask"),
  listTaskModels: () => notImplemented("listTaskModels"),
  setTaskModel: () => notImplemented("setTaskModel"),
  setTaskThinkingLevel: () => notImplemented("setTaskThinkingLevel"),
  setTaskApprovalMode: () => notImplemented("setTaskApprovalMode"),
};
