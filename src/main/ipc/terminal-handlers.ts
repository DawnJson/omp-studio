// 内置终端的 IPC handler：校验参数，委托终端管理器。cwd 不由渲染进程传，管理器按键取（任务的有效目录，或草稿的项目目录）。
import type { DraftKey, HandlerGroup, TerminalKey } from "../../shared/ipc.ts";
import { parseDraftKey } from "../../shared/ipc.ts";
import { parseTerminalInput, parseTerminalSize } from "../terminal/input.ts";
import { getTerminalManager } from "../terminal/runtime.ts";
import { IpcValidationError, parseString, parseTaskId } from "./validate.ts";

// 键是任务 id 或草稿的键；是否真的存在由管理器取目录时确认。
function parseTerminalKey(value: unknown): TerminalKey {
  return parseString(value, "terminal key", 200) as TerminalKey;
}

function parseDraftTerminalKey(value: unknown): DraftKey {
  const key = parseString(value, "draft key", 200);
  if (parseDraftKey(key) === undefined) throw new IpcValidationError("draft key 必须以 new: 开头");
  return key as DraftKey;
}

export const terminalHandlers: HandlerGroup<
  "openTerminal" | "writeTerminal" | "resizeTerminal" | "unsubscribeTerminal" | "closeTerminal" | "rekeyTerminal"
> = {
  async openTerminal(key, cols, rows) {
    const id = parseTerminalKey(key);
    const size = parseTerminalSize(cols, rows);
    // 任务必须存在：管理器取目录时找不到会抛错；归档的任务不在池里，也就开不了终端。
    return (await getTerminalManager()).open(id, size.cols, size.rows);
  },
  async writeTerminal(key, data) {
    (await getTerminalManager()).write(parseTerminalKey(key), parseTerminalInput(data));
  },
  async resizeTerminal(key, cols, rows) {
    const size = parseTerminalSize(cols, rows);
    (await getTerminalManager()).resize(parseTerminalKey(key), size.cols, size.rows);
  },
  async unsubscribeTerminal(key) {
    (await getTerminalManager()).unsubscribe(parseTerminalKey(key));
  },
  async closeTerminal(key) {
    await (await getTerminalManager()).close(parseTerminalKey(key));
  },
  async rekeyTerminal(from, to) {
    return (await getTerminalManager()).rekey(parseDraftTerminalKey(from), parseTaskId(to));
  },
};
