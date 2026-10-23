// TSP 任务子代理面板的 IPC（S1，spec §4.28）：校验参数，委托任务池。名字来自渲染进程，不可信：这里限字符集和长度，
// 任务运行时再确认它是文档里确有的子代理（见 tasks/tsp-hub-driver.ts）；渲染进程不传路径，记录路径由主进程用会话文件拼。
import type { HandlerGroup } from "../../shared/ipc.ts";
import { subagentLimits } from "../../shared/subagents.ts";
import { isAgentName } from "../../shared/tsp/agent-hub.ts";
import { getTaskPool } from "../tasks/runtime.ts";
import { IpcValidationError, parseString, parseTaskId } from "./validate.ts";

function parseAgentName(value: unknown): string {
  const name = parseString(value, "name", 128);
  if (!isAgentName(name)) throw new IpcValidationError("name 不是合法的子代理名");
  return name;
}

export const agentsHandlers: HandlerGroup<
  "getTspSubagentRecord" | "focusTspSubagent" | "steerTspSubagent" | "killTspSubagent" | "reviveTspSubagent"
> = {
  async getTspSubagentRecord(taskId, name) {
    return (await getTaskPool()).getTspSubagentRecord(parseTaskId(taskId), parseAgentName(name));
  },
  async focusTspSubagent(taskId, name) {
    await (await getTaskPool()).focusTspSubagent(parseTaskId(taskId), parseAgentName(name));
  },
  async steerTspSubagent(taskId, name, text) {
    const message = parseString(text, "text", subagentLimits.steerChars);
    if (message.trim() === "") throw new IpcValidationError("text 不能为空");
    await (await getTaskPool()).steerTspSubagent(parseTaskId(taskId), parseAgentName(name), message);
  },
  async killTspSubagent(taskId, name) {
    await (await getTaskPool()).killTspSubagent(parseTaskId(taskId), parseAgentName(name));
  },
  async reviveTspSubagent(taskId, name) {
    await (await getTaskPool()).reviveTspSubagent(parseTaskId(taskId), parseAgentName(name));
  },
};
