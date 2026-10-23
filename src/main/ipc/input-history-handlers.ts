// 输入历史的两个 IPC（userData/input-history.json，按项目分开；上限和落盘见 tasks/input-history-store.ts）。
// 渲染进程传来的都当不可信：项目 id 必须是已加入的项目，文字限长。
import path from "node:path";
import { app } from "electron";
import { MAX_HISTORY_CHARS } from "../../shared/input-history.ts";
import type { HandlerGroup } from "../../shared/ipc.ts";
import { InputHistoryStore } from "../tasks/input-history-store.ts";
import { getTaskPool } from "../tasks/runtime.ts";
import { parseProjectId, parseString } from "./validate.ts";

let store: InputHistoryStore | null = null;
const historyStore = () => (store ??= new InputHistoryStore(path.join(app.getPath("userData"), "input-history.json")));

// projectPath 对未知项目会抛错：只记已加入的项目。
async function knownProject(projectId: unknown): Promise<string> {
  const id = parseProjectId(projectId);
  (await getTaskPool()).projectPath(id);
  return id;
}

export const inputHistoryHandlers: HandlerGroup<"getInputHistory" | "recordInputHistory"> = {
  async getInputHistory(projectId) {
    return historyStore().get(await knownProject(projectId));
  },

  async recordInputHistory(projectId, text) {
    const value = parseString(text, "text", MAX_HISTORY_CHARS);
    await historyStore().record(await knownProject(projectId), value);
  },
};
