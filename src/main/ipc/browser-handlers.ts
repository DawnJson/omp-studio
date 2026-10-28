// 浏览器面板的 IPC handler：任务必须存在（归档的不在池里），位置是有限的非负整数，地址栏文字限长；协议由管理器只放行 http/https。
import { browserActions, limits, type BrowserBounds, type HandlerGroup, type TaskId } from "../../shared/ipc.ts";
import { getBrowserManager } from "../browser/runtime.ts";
import { getTaskPool } from "../tasks/runtime.ts";
import { parseInteger, parseOneOf, parseRecord, parseString, parseTaskId } from "./validate.ts";

const MAX_PIXELS = 100_000;

async function existingTask(value: unknown): Promise<TaskId> {
  const id = parseTaskId(value);
  if (!(await getTaskPool()).listTasks().some((task) => task.id === id)) throw new Error("任务不存在");
  return id;
}

function parseBounds(value: unknown): BrowserBounds | null {
  if (value === null) return null;
  const record = parseRecord(value, "bounds");
  return {
    x: parseInteger(record["x"], "bounds.x", 0, MAX_PIXELS),
    y: parseInteger(record["y"], "bounds.y", 0, MAX_PIXELS),
    width: parseInteger(record["width"], "bounds.width", 1, MAX_PIXELS),
    height: parseInteger(record["height"], "bounds.height", 1, MAX_PIXELS),
  };
}

export const browserHandlers: HandlerGroup<"placeBrowser" | "navigateBrowser" | "browserAction"> = {
  async placeBrowser(taskId, bounds) {
    const id = await existingTask(taskId);
    return getBrowserManager().place(id, parseBounds(bounds));
  },
  async navigateBrowser(taskId, text) {
    const id = await existingTask(taskId);
    getBrowserManager().navigate(id, parseString(text, "address", limits.urlMaxChars));
  },
  async browserAction(taskId, action) {
    const id = await existingTask(taskId);
    getBrowserManager().action(id, parseOneOf(action, "action", browserActions));
  },
};
