// 内置终端的 IPC handler：校验参数，委托终端管理器。cwd 不由渲染进程传，管理器按任务取（worktree 根或项目目录）。
import type { HandlerGroup } from "../../shared/ipc.ts";
import { parseTerminalInput, parseTerminalSize } from "../terminal/input.ts";
import { getTerminalManager } from "../terminal/runtime.ts";
import { parseTaskId } from "./validate.ts";

export const terminalHandlers: HandlerGroup<"openTerminal" | "writeTerminal" | "resizeTerminal" | "closeTerminal"> = {
  async openTerminal(taskId, cols, rows) {
    const id = parseTaskId(taskId);
    const size = parseTerminalSize(cols, rows);
    // 任务必须存在：管理器取任务目录时找不到会抛错；归档的任务不在池里，也就开不了终端。
    return (await getTerminalManager()).open(id, size.cols, size.rows);
  },
  async writeTerminal(taskId, data) {
    (await getTerminalManager()).write(parseTaskId(taskId), parseTerminalInput(data));
  },
  async resizeTerminal(taskId, cols, rows) {
    const size = parseTerminalSize(cols, rows);
    (await getTerminalManager()).resize(parseTaskId(taskId), size.cols, size.rows);
  },
  async closeTerminal(taskId) {
    await (await getTerminalManager()).close(parseTaskId(taskId));
  },
};
